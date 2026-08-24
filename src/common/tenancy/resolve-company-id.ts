import { BadRequestException } from '@nestjs/common';

/**
 * Which company a request is acting on.
 *
 * A company user always acts on their own tenant, taken from the JWT — a
 * `?companyId` they supply is ignored rather than trusted, so this cannot
 * become a way to read across tenants.
 *
 * A platform operator belongs to no company, so `user.companyId` is null and
 * there is nothing to fall back to. They name the company explicitly. Asking
 * loudly is deliberate: the alternative is a query filtered on
 * `companyId: null`, which matches nothing and looks exactly like a tenant with
 * no data — the failure that hid the missing-users bug for as long as it did.
 *
 * Lives here rather than being copied into each controller because it was
 * already duplicated in two, and the third that needed it (departments) did
 * not get a copy at all: it read `user.companyId` directly and returned an
 * empty list to every platform operator who opened the screen.
 */
export function resolveCompanyId(
  user: { isSuperAdmin?: boolean; companyId?: string | null },
  queryCompanyId?: string,
): string {
  if (user.isSuperAdmin) {
    if (!queryCompanyId) {
      throw new BadRequestException(
        'This request needs a company. As a platform operator you are not inside one, ' +
          'so choose the company you are administering and retry with ?companyId=<id>.',
      );
    }
    return queryCompanyId;
  }
  return user.companyId as string;
}
