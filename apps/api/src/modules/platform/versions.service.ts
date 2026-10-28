import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CountryPackDataSchema,
  countryPackProblems,
  TemplateDefinitionSchema,
  templateDiff,
  templateProblems,
  type ChangeResult,
  type CountryPackData,
  type TemplateDefinition,
  type TemplateStatus,
} from '@erp/contracts';
import { assertIfMatch } from '../../common/etag';
import { ProblemException } from '../../common/problem';
import { ApprovalsService, type ApprovalRow } from './approvals.service';
import { PlatformAuditService, type Tx } from './platform-audit.service';
import { PlatformDatabase } from './platform-database.service';
import type { StaffContext } from './staff-access.service';

// Versioned catalogue data (Part 03 §3.11): industry templates and country packs. A new version
// starts as a copy of an existing one; drafts are edited; publishing goes through a second
// approver (draft → in review → published; the previous published version is deprecated);
// rejection returns the version to draft. Published versions are never edited.

const versionKey = (key: string, version: string) => `${key}@${version}`;
const splitTarget = (target: string): [string, string] => {
  const at = target.lastIndexOf('@');
  return [target.slice(0, at), target.slice(at + 1)];
};

/** Semantic versions compared numerically: 1.10.0 is after 1.9.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const refusal = (problems: string[]) =>
  new ProblemException('validation_failed', 'This version cannot be published yet', {
    errors: problems.map((message) => ({ field: 'definition', message })),
  });

@Injectable()
export class VersionsService implements OnModuleInit {
  constructor(
    private readonly platform: PlatformDatabase,
    private readonly audit: PlatformAuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    this.approvals.register('template.publish', {
      execute: (tx, approval, approver) => this.publishTemplate(tx, approval, approver),
      release: (tx, approval) => this.backToDraft(tx, 'template', approval),
    });
    this.approvals.register('country_pack.publish', {
      execute: (tx, approval, approver) => this.publishPack(tx, approval, approver),
      release: (tx, approval) => this.backToDraft(tx, 'country_pack', approval),
    });
  }

  // ── Industry templates ──────────────────────────────────────────────────────────────────

  async templates() {
    const rows = await this.platform.db.industryTemplate.findMany({
      orderBy: [{ key: 'asc' }, { createdAt: 'asc' }],
    });
    const names = await this.staffNames(rows.map((r) => r.publishedBy));
    return rows
      .sort((a, b) => a.key.localeCompare(b.key) || compareVersions(a.version, b.version))
      .map((r) => {
        const d = r.definition as TemplateDefinition;
        return {
          key: r.key,
          version: r.version,
          status: r.status as TemplateStatus,
          name: d.name,
          industry: d.industry,
          roles: d.roles.length,
          entitlements: d.entitlements.length,
          published_at: r.publishedAt?.toISOString() ?? null,
          published_by: r.publishedBy
            ? { id: r.publishedBy, name: names.get(r.publishedBy) ?? 'Unknown' }
            : null,
          updated_at: r.updatedAt.toISOString(),
          revision: r.revision,
        };
      });
  }

  async template(key: string, version: string) {
    const summary = (await this.templates()).find((t) => t.key === key && t.version === version);
    if (!summary) throw new ProblemException('not_found');
    const row = await this.platform.db.industryTemplate.findUniqueOrThrow({
      where: { key_version: { key, version } },
    });
    const definition = row.definition as TemplateDefinition;
    return { ...summary, definition, problems: templateProblems(definition) };
  }

  async createTemplateDraft(
    staff: StaffContext,
    key: string,
    input: { version: string; from_version: string; reason: string },
  ) {
    await this.platform.db.$transaction(async (tx) => {
      const versions = await tx.industryTemplate.findMany({ where: { key } });
      const from = versions.find((v) => v.version === input.from_version);
      if (!from)
        throw new ProblemException(
          'not_found',
          `Template ${key} has no version ${input.from_version}`,
        );
      if (versions.some((v) => compareVersions(v.version, input.version) >= 0)) {
        throw new ProblemException(
          'conflict',
          'The new version must be higher than every existing version',
        );
      }
      const definition = { ...(from.definition as TemplateDefinition), version: input.version };
      await tx.industryTemplate.create({
        data: {
          key,
          version: input.version,
          status: 'draft',
          definition: definition as object,
          createdBy: staff.id,
          updatedBy: staff.id,
        },
      });
      await this.audit.write(tx, {
        actor: staff.id,
        action: 'catalogue.template_draft_created',
        targetType: 'industry_template',
        targetId: versionKey(key, input.version),
        after: { from_version: input.from_version },
        reason: input.reason,
      });
    });
    return this.template(key, input.version);
  }

  async updateTemplateDraft(
    staff: StaffContext,
    key: string,
    version: string,
    input: { definition: TemplateDefinition; reason: string },
    ifMatch?: string,
  ) {
    if (input.definition.key !== key || input.definition.version !== version) {
      throw new ProblemException(
        'validation_failed',
        'The definition’s key and version must match the address',
      );
    }
    await this.platform.db.$transaction(async (tx) => {
      const row = await tx.industryTemplate.findUnique({
        where: { key_version: { key, version } },
      });
      if (!row) throw new ProblemException('not_found');
      if (row.status !== 'draft')
        throw new ProblemException(
          'conflict',
          `Only drafts can be edited; this version is ${row.status}`,
        );
      assertIfMatch(ifMatch, row.revision);
      await tx.industryTemplate.update({
        where: { key_version: { key, version } },
        data: {
          definition: input.definition as object,
          updatedBy: staff.id,
          revision: { increment: 1 },
        },
      });
      await this.audit.write(tx, {
        actor: staff.id,
        action: 'catalogue.template_draft_updated',
        targetType: 'industry_template',
        targetId: versionKey(key, version),
        before: row.definition,
        after: input.definition,
        reason: input.reason,
      });
    });
    return this.template(key, version);
  }

  async requestTemplatePublish(
    staff: StaffContext,
    key: string,
    version: string,
    reason: string,
  ): Promise<ChangeResult> {
    return this.platform.db.$transaction(async (tx) => {
      const row = await tx.industryTemplate.findUnique({
        where: { key_version: { key, version } },
      });
      if (!row) throw new ProblemException('not_found');
      if (row.status !== 'draft')
        throw new ProblemException(
          'conflict',
          `Only a draft can be sent for publishing; this version is ${row.status}`,
        );
      const problems = templateProblems(TemplateDefinitionSchema.parse(row.definition));
      if (problems.length) throw refusal(problems);
      await tx.industryTemplate.update({
        where: { key_version: { key, version } },
        data: { status: 'in_review', updatedBy: staff.id },
      });
      const approvalId = await this.approvals.request(tx, staff, {
        action: 'template.publish',
        targetType: 'industry_template',
        targetId: versionKey(key, version),
        reason,
      });
      return { status: 'pending', approval_id: approvalId };
    });
  }

  async deprecateTemplate(
    staff: StaffContext,
    key: string,
    version: string,
    reason: string,
  ): Promise<void> {
    await this.deprecate(staff, 'template', key, version, reason);
  }

  async templateDiff(key: string, from: string, to: string) {
    const [a, b] = await Promise.all([
      this.platform.db.industryTemplate.findUnique({
        where: { key_version: { key, version: from } },
      }),
      this.platform.db.industryTemplate.findUnique({
        where: { key_version: { key, version: to } },
      }),
    ]);
    if (!a || !b) throw new ProblemException('not_found');
    return {
      from,
      to,
      ...templateDiff(a.definition as TemplateDefinition, b.definition as TemplateDefinition),
    };
  }

  private async publishTemplate(tx: Tx, approval: ApprovalRow, approver: StaffContext) {
    const [key, version] = splitTarget(approval.targetId);
    const row = await tx.industryTemplate.findUnique({ where: { key_version: { key, version } } });
    if (!row || row.status !== 'in_review')
      throw new ProblemException('conflict', 'This version is no longer waiting to be published');
    const problems = templateProblems(TemplateDefinitionSchema.parse(row.definition));
    if (problems.length) throw refusal(problems);
    const previous = await tx.industryTemplate.findFirst({ where: { key, status: 'published' } });
    if (previous) {
      await tx.industryTemplate.update({
        where: { key_version: { key, version: previous.version } },
        data: { status: 'deprecated', updatedBy: approver.id },
      });
    }
    await tx.industryTemplate.update({
      where: { key_version: { key, version } },
      data: {
        status: 'published',
        publishedAt: new Date(),
        publishedBy: approver.id,
        updatedBy: approver.id,
      },
    });
    await this.audit.write(tx, {
      actor: approver.id,
      action: 'catalogue.template_published',
      targetType: 'industry_template',
      targetId: approval.targetId,
      before: { status: 'in_review', published: previous?.version ?? null },
      after: { status: 'published', requested_by: approval.requestedBy, approved_by: approver.id },
      reason: `approved request ${approval.id}`,
    });
    return { published: version, deprecated: previous?.version ?? null };
  }

  // ── Country packs ───────────────────────────────────────────────────────────────────────

  async packs() {
    const rows = await this.platform.db.countryPack.findMany();
    const names = await this.staffNames(rows.map((r) => r.publishedBy));
    return rows
      .sort((a, b) => a.country.localeCompare(b.country) || compareVersions(a.version, b.version))
      .map((r) => ({
        country: r.country,
        version: r.version,
        status: r.status as TemplateStatus,
        name: (r.data as CountryPackData).name,
        effective_from: r.effectiveFrom.toISOString().slice(0, 10),
        published_at: r.publishedAt?.toISOString() ?? null,
        published_by: r.publishedBy
          ? { id: r.publishedBy, name: names.get(r.publishedBy) ?? 'Unknown' }
          : null,
        updated_at: r.updatedAt.toISOString(),
        revision: r.revision,
      }));
  }

  async pack(country: string, version: string) {
    const summary = (await this.packs()).find(
      (p) => p.country === country && p.version === version,
    );
    if (!summary) throw new ProblemException('not_found');
    const row = await this.platform.db.countryPack.findUniqueOrThrow({
      where: { country_version: { country, version } },
    });
    const data = row.data as CountryPackData;
    const parsed = CountryPackDataSchema.safeParse(data);
    return {
      ...summary,
      data,
      problems: parsed.success
        ? countryPackProblems(parsed.data)
        : ['the data does not match the country pack format'],
    };
  }

  async createPackDraft(
    staff: StaffContext,
    country: string,
    input: { version: string; from_version: string; reason: string },
  ) {
    await this.platform.db.$transaction(async (tx) => {
      const versions = await tx.countryPack.findMany({ where: { country } });
      const from = versions.find((v) => v.version === input.from_version);
      if (!from)
        throw new ProblemException(
          'not_found',
          `Country pack ${country} has no version ${input.from_version}`,
        );
      if (versions.some((v) => compareVersions(v.version, input.version) >= 0)) {
        throw new ProblemException(
          'conflict',
          'The new version must be higher than every existing version',
        );
      }
      await tx.countryPack.create({
        data: {
          country,
          version: input.version,
          status: 'draft',
          effectiveFrom: from.effectiveFrom,
          data: from.data as object,
          createdBy: staff.id,
          updatedBy: staff.id,
        },
      });
      await this.audit.write(tx, {
        actor: staff.id,
        action: 'catalogue.country_pack_draft_created',
        targetType: 'country_pack',
        targetId: versionKey(country, input.version),
        after: { from_version: input.from_version },
        reason: input.reason,
      });
    });
    return this.pack(country, input.version);
  }

  async updatePackDraft(
    staff: StaffContext,
    country: string,
    version: string,
    input: { effective_from: string; data: CountryPackData; reason: string },
    ifMatch?: string,
  ) {
    await this.platform.db.$transaction(async (tx) => {
      const row = await tx.countryPack.findUnique({
        where: { country_version: { country, version } },
      });
      if (!row) throw new ProblemException('not_found');
      if (row.status !== 'draft')
        throw new ProblemException(
          'conflict',
          `Only drafts can be edited; this version is ${row.status}`,
        );
      assertIfMatch(ifMatch, row.revision);
      await tx.countryPack.update({
        where: { country_version: { country, version } },
        data: {
          effectiveFrom: new Date(input.effective_from),
          data: input.data,
          updatedBy: staff.id,
          revision: { increment: 1 },
        },
      });
      await this.audit.write(tx, {
        actor: staff.id,
        action: 'catalogue.country_pack_draft_updated',
        targetType: 'country_pack',
        targetId: versionKey(country, version),
        before: { effective_from: row.effectiveFrom.toISOString().slice(0, 10), data: row.data },
        after: { effective_from: input.effective_from, data: input.data },
        reason: input.reason,
      });
    });
    return this.pack(country, version);
  }

  async requestPackPublish(
    staff: StaffContext,
    country: string,
    version: string,
    reason: string,
  ): Promise<ChangeResult> {
    return this.platform.db.$transaction(async (tx) => {
      const row = await tx.countryPack.findUnique({
        where: { country_version: { country, version } },
      });
      if (!row) throw new ProblemException('not_found');
      if (row.status !== 'draft')
        throw new ProblemException(
          'conflict',
          `Only a draft can be sent for publishing; this version is ${row.status}`,
        );
      const problems = countryPackProblems(CountryPackDataSchema.parse(row.data));
      if (problems.length) throw refusal(problems);
      await tx.countryPack.update({
        where: { country_version: { country, version } },
        data: { status: 'in_review', updatedBy: staff.id },
      });
      const approvalId = await this.approvals.request(tx, staff, {
        action: 'country_pack.publish',
        targetType: 'country_pack',
        targetId: versionKey(country, version),
        payload: { effective_from: row.effectiveFrom.toISOString().slice(0, 10) },
        reason,
      });
      return { status: 'pending', approval_id: approvalId };
    });
  }

  async deprecatePack(
    staff: StaffContext,
    country: string,
    version: string,
    reason: string,
  ): Promise<void> {
    await this.deprecate(staff, 'country_pack', country, version, reason);
  }

  private async publishPack(tx: Tx, approval: ApprovalRow, approver: StaffContext) {
    const [country, version] = splitTarget(approval.targetId);
    const row = await tx.countryPack.findUnique({
      where: { country_version: { country, version } },
    });
    if (!row || row.status !== 'in_review')
      throw new ProblemException('conflict', 'This version is no longer waiting to be published');
    const previous = await tx.countryPack.findFirst({ where: { country, status: 'published' } });
    if (previous) {
      await tx.countryPack.update({
        where: { country_version: { country, version: previous.version } },
        data: { status: 'deprecated', updatedBy: approver.id },
      });
    }
    await tx.countryPack.update({
      where: { country_version: { country, version } },
      data: {
        status: 'published',
        publishedAt: new Date(),
        publishedBy: approver.id,
        updatedBy: approver.id,
      },
    });
    await this.audit.write(tx, {
      actor: approver.id,
      action: 'catalogue.country_pack_published',
      targetType: 'country_pack',
      targetId: approval.targetId,
      before: { status: 'in_review', published: previous?.version ?? null },
      after: {
        status: 'published',
        effective_from: row.effectiveFrom.toISOString().slice(0, 10),
        requested_by: approval.requestedBy,
        approved_by: approver.id,
      },
      reason: `approved request ${approval.id}`,
    });
    return { published: version, deprecated: previous?.version ?? null };
  }

  // ── Shared ──────────────────────────────────────────────────────────────────────────────

  private async backToDraft(
    tx: Tx,
    kind: 'template' | 'country_pack',
    approval: ApprovalRow,
  ): Promise<void> {
    const [key, version] = splitTarget(approval.targetId);
    if (kind === 'template') {
      await tx.industryTemplate.updateMany({
        where: { key, version, status: 'in_review' },
        data: { status: 'draft' },
      });
    } else {
      await tx.countryPack.updateMany({
        where: { country: key, version, status: 'in_review' },
        data: { status: 'draft' },
      });
    }
  }

  private async deprecate(
    staff: StaffContext,
    kind: 'template' | 'country_pack',
    key: string,
    version: string,
    reason: string,
  ): Promise<void> {
    await this.platform.db.$transaction(async (tx) => {
      const row =
        kind === 'template'
          ? await tx.industryTemplate.findUnique({ where: { key_version: { key, version } } })
          : await tx.countryPack.findUnique({
              where: { country_version: { country: key, version } },
            });
      if (!row) throw new ProblemException('not_found');
      if (row.status === 'deprecated' || row.status === 'in_review') {
        throw new ProblemException('conflict', `This version is ${row.status}`);
      }
      if (kind === 'template') {
        await tx.industryTemplate.update({
          where: { key_version: { key, version } },
          data: { status: 'deprecated', updatedBy: staff.id },
        });
      } else {
        await tx.countryPack.update({
          where: { country_version: { country: key, version } },
          data: { status: 'deprecated', updatedBy: staff.id },
        });
      }
      await this.audit.write(tx, {
        actor: staff.id,
        action: `catalogue.${kind}_deprecated`,
        targetType: kind === 'template' ? 'industry_template' : 'country_pack',
        targetId: versionKey(key, version),
        before: { status: row.status },
        after: { status: 'deprecated' },
        reason,
      });
    });
  }

  private async staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!wanted.length) return new Map();
    const rows = await this.platform.db.staffUser.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
