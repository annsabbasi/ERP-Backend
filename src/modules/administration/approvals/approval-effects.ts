import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * The document type a module grant is requested under.
 *
 * The approval engine is generic over documentType + documentId, so a new kind
 * of gated action plugs in by naming itself here and having a template that
 * lists it.
 */
export const USER_MODULE_GRANT = 'user_module_grant';

/** What a grant request carries, stored on the request's documentSnapshot. */
export interface UserModuleGrantSnapshot {
  userId: string;
  moduleId: string;
  /** Recorded for the approver's benefit; the ids above are authoritative. */
  userEmail?: string;
  moduleSlug?: string;
}

/**
 * Applies whatever a request was asking for, once it is fully approved.
 *
 * Called from inside `decide()`'s transaction, in the branch where the last
 * stage clears. That placement is the whole control: `user_modules` means
 * effective access and nothing else, so the row must not exist until the
 * approval is final, and must be written by the same commit that records the
 * approval. A row written before, or in a second transaction after, is a
 * window where pending reads as granted.
 */
export async function applyApprovedRequest(
  tx: Prisma.TransactionClient,
  request: { companyId: string; documentType: string; documentSnapshot: unknown },
) {
  if (request.documentType !== USER_MODULE_GRANT) return;

  const snapshot = request.documentSnapshot as UserModuleGrantSnapshot | null;
  if (!snapshot?.userId || !snapshot?.moduleId) {
    throw new BadRequestException(
      'This module grant request is missing the user or module it was asking for and cannot be applied.',
    );
  }

  await assertModuleEnabled(tx, request.companyId, snapshot.moduleId);

  // The user must still be in the company that approved the grant. Approvals
  // can sit for days, and a user moved or removed in between must not pick up
  // access on the strength of a decision about who they used to be.
  const user = await tx.user.findFirst({
    where: { id: snapshot.userId, companyId: request.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!user) {
    throw new BadRequestException(
      'The user this grant was requested for is no longer in this company.',
    );
  }

  // skipDuplicates rather than create: two approvers clearing the final stage
  // at the same moment must produce one grant, not a unique-violation that
  // rolls back a legitimate approval.
  await tx.userModule.createMany({
    data: [{ userId: snapshot.userId, moduleId: snapshot.moduleId }],
    skipDuplicates: true,
  });
}

/**
 * Re-checked at approval time, not only when the request was raised.
 *
 * A subscription can lapse between the two, and the approver must not be able
 * to hand out a module the company no longer pays for.
 */
export async function assertModuleEnabled(
  tx: Prisma.TransactionClient,
  companyId: string,
  moduleId: string,
) {
  const enabled = await tx.companyModule.findFirst({
    where: { companyId, moduleId, isEnabled: true },
    select: { moduleId: true },
  });
  if (!enabled) {
    throw new BadRequestException(
      'That module is not enabled for this company, so it cannot be granted.',
    );
  }
}
