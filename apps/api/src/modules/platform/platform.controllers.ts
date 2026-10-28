import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApprovalDecisionSchema,
  ApprovalRejectSchema,
  ApprovalsSchema,
  ArchiveRequestSchema,
  AuditPageSchema,
  AuditQuerySchema,
  CatalogueModulesSchema,
  ChangeResultSchema,
  CONSOLE_MENU,
  ConsoleSearchSchema,
  consoleMenuOf,
  CountryPackDetailSchema,
  CountryPackDraftCreateSchema,
  CountryPackDraftUpdateSchema,
  CountryPacksSchema,
  DoneSchema,
  FeatureDisplayPatchSchema,
  InviteStaffRequestSchema,
  ModuleDisplayPatchSchema,
  PlanPricesRequestSchema,
  PlanSchema,
  PlansSchema,
  PlanUpsertSchema,
  PublishRequestSchema,
  StaffAccessSchema,
  StaffDeactivateRequestSchema,
  StaffListSchema,
  StaffMemberSchema,
  StaffRolesRequestSchema,
  TemplateDetailSchema,
  TemplateDiffSchema,
  TemplateDraftCreateSchema,
  TemplateDraftUpdateSchema,
  TemplatesSchema,
  type AccessTokenClaims,
  type StaffAccess,
} from '@erp/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { etagFor } from '../../common/etag';
import { ApiZodResponse } from '../../common/openapi';
import { ProblemException } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SignedIn, StaffPermission } from '../access/access.decorators';
import { Auth, ForAudience } from '../auth/auth.guard';
import { StaffAccountsService } from '../auth/staff-accounts.service';
import { PLATFORM_PREFIX } from '../auth/staff-auth.controller';
import { ApprovalsService } from './approvals.service';
import { CatalogueService } from './catalogue.service';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformDatabase } from './platform-database.service';
import { CurrentStaff, StaffAccessService, type StaffContext } from './staff-access.service';
import { StaffService } from './staff.service';
import { VersionsService } from './versions.service';

// Platform Console API (Part 11 §11.10.3), under /api/platform/v1 with the console audience.
// Every route names the staff permissions that open it (Part 03 §3.2.1); sensitive actions
// also need a fresh MFA check (§3.3.1).

const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
const SEMVER_PARAM = /^\d+\.\d+(\.\d+)?$/;
const version = (v: string) => {
  if (!SEMVER_PARAM.test(v)) throw new ProblemException('not_found');
  return v;
};

@ApiTags('platform console')
@ForAudience('console')
@Controller(PLATFORM_PREFIX)
export class ConsoleController {
  constructor(
    private readonly access: StaffAccessService,
    private readonly approvals: ApprovalsService,
    private readonly accounts: StaffAccountsService,
    private readonly platform: PlatformDatabase,
  ) {}

  /** The signed-in staff member's roles, permissions, sidebar and badges. */
  @Get('me/access')
  @SignedIn()
  @ApiZodResponse(200, StaffAccessSchema, 'Staff roles, permissions, sidebar and badges')
  async meAccess(@Auth() claims: AccessTokenClaims): Promise<StaffAccess> {
    const staff = await this.access.load(claims.sub);
    if (!staff) throw new ProblemException('unauthenticated', 'Your console access has ended');
    const verified = await this.accounts.mfaVerifiedAt(claims);
    return StaffAccessSchema.parse({
      staff_id: staff.id,
      roles: staff.roles,
      permissions: staff.permissions,
      menu: consoleMenuOf(staff.permissions),
      badges: { approvals: await this.approvals.waitingFor(staff) },
      mfa_verified_at: verified?.toISOString() ?? null,
    });
  }

  /** Ctrl+K: tenants by name, code or slug, and the console pages this person may open. */
  @Get('search')
  @StaffPermission('dashboard.view')
  @ApiZodResponse(200, ConsoleSearchSchema, 'Tenants and pages matching the text')
  async search(
    @CurrentStaff() staff: StaffContext,
    @Query(pipe(z.object({ q: z.string().trim().min(1).max(100) }))) query: { q: string },
  ) {
    const q = query.q.replace(/[%_\\]/g, '\\$&');
    const tenants = staff.permissions['tenants.view']
      ? await this.platform.db.tenant.findMany({
          where: {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true, code: true, slug: true, displayName: true, status: true },
          take: 8,
          orderBy: { displayName: 'asc' },
        })
      : [];
    const allowed = new Set(
      consoleMenuOf(staff.permissions).flatMap((g) => g.entries.map((e) => e.path)),
    );
    const pages = CONSOLE_MENU.flatMap((g) => g.entries)
      .filter(
        (e) =>
          allowed.has(e.path) &&
          (e.path.includes(query.q.toLowerCase()) || e.label.includes(query.q.toLowerCase())),
      )
      .map(({ path, label }) => ({ path, label }));
    return {
      tenants: tenants.map((t) => ({
        id: t.id,
        code: t.code,
        slug: t.slug,
        display_name: t.displayName,
        status: t.status,
      })),
      pages,
    };
  }
}

@ApiTags('platform staff')
@ForAudience('console')
@Controller(`${PLATFORM_PREFIX}/staff`)
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly accounts: StaffAccountsService,
  ) {}

  @Get()
  @StaffPermission('staff.view')
  @ApiZodResponse(200, StaffListSchema, 'Staff accounts and their roles')
  async list() {
    return { data: await this.staff.list() };
  }

  @Post()
  @StaffPermission('staff.manage')
  @ApiZodResponse(201, StaffMemberSchema, 'Invited; a one-time setup link was e-mailed')
  async invite(
    @Auth() claims: AccessTokenClaims,
    @CurrentStaff() me: StaffContext,
    @Body(pipe(InviteStaffRequestSchema)) body: z.infer<typeof InviteStaffRequestSchema>,
  ) {
    await this.accounts.assertStepUp(claims);
    return this.staff.invite(me, body);
  }

  @Put(':id/roles')
  @StaffPermission('staff.manage')
  @ApiZodResponse(200, StaffMemberSchema, 'Roles replaced')
  async roles(
    @Auth() claims: AccessTokenClaims,
    @CurrentStaff() me: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe(StaffRolesRequestSchema)) body: z.infer<typeof StaffRolesRequestSchema>,
  ) {
    await this.accounts.assertStepUp(claims);
    return this.staff.changeRoles(me, id, body.roles, body.reason);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @StaffPermission('staff.manage')
  @ApiZodResponse(200, StaffMemberSchema, 'Deactivated; their sessions ended')
  async deactivate(
    @Auth() claims: AccessTokenClaims,
    @CurrentStaff() me: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe(StaffDeactivateRequestSchema)) body: z.infer<typeof StaffDeactivateRequestSchema>,
  ) {
    await this.accounts.assertStepUp(claims);
    return this.staff.deactivate(me, id, body.reason);
  }

  @Post(':id/setup-link')
  @HttpCode(200)
  @StaffPermission('staff.manage')
  @ApiZodResponse(200, DoneSchema, 'A new setup link was e-mailed; older ones stop working')
  async setupLink(
    @CurrentStaff() me: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe(ArchiveRequestSchema)) body: z.infer<typeof ArchiveRequestSchema>,
  ) {
    await this.staff.resendSetupLink(me, id, body.reason);
    return { status: 'done' as const };
  }
}

@ApiTags('platform catalogue')
@ForAudience('console')
@Controller(`${PLATFORM_PREFIX}/catalogue`)
export class CatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly versions: VersionsService,
    private readonly accounts: StaffAccountsService,
  ) {}

  // Modules and features (registry definitions, staff display fields).

  @Get('modules')
  @StaffPermission('catalogue.view')
  @ApiZodResponse(200, CatalogueModulesSchema, 'Modules and features with their display fields')
  async modules() {
    return { data: await this.catalogue.modules() };
  }

  @Patch('modules/:key')
  @StaffPermission('catalogue.edit')
  @ApiZodResponse(200, DoneSchema, 'Display fields changed')
  async patchModule(
    @CurrentStaff() me: StaffContext,
    @Param('key') key: string,
    @Body(pipe(ModuleDisplayPatchSchema)) body: z.infer<typeof ModuleDisplayPatchSchema>,
  ) {
    await this.catalogue.patchModule(me, key, body);
    return { status: 'done' as const };
  }

  @Patch('features/:key')
  @StaffPermission('catalogue.edit')
  @ApiZodResponse(200, DoneSchema, 'Display fields changed')
  async patchFeature(
    @CurrentStaff() me: StaffContext,
    @Param('key') key: string,
    @Body(pipe(FeatureDisplayPatchSchema)) body: z.infer<typeof FeatureDisplayPatchSchema>,
  ) {
    await this.catalogue.patchFeature(me, key, body);
    return { status: 'done' as const };
  }

  // Plans and add-ons.

  @Get('plans')
  @StaffPermission('catalogue.view', 'catalogue.prices')
  @ApiZodResponse(200, PlansSchema, 'Plans and add-ons')
  async plans() {
    return { data: await this.catalogue.plans() };
  }

  @Put('plans')
  @StaffPermission('catalogue.edit')
  @ApiZodResponse(200, PlanSchema, 'Created, or updated (If-Match its version)')
  upsertPlan(
    @CurrentStaff() me: StaffContext,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(pipe(PlanUpsertSchema)) body: z.infer<typeof PlanUpsertSchema>,
  ) {
    return this.catalogue.upsertPlan(me, body, ifMatch);
  }

  @Post(':kind/:key/prices')
  @HttpCode(200)
  @StaffPermission('catalogue.prices')
  @ApiZodResponse(200, ChangeResultSchema, 'Prices changed, or waiting for a second approver')
  prices(
    @CurrentStaff() me: StaffContext,
    @Param('kind') kind: string,
    @Param('key') key: string,
    @Body(pipe(PlanPricesRequestSchema)) body: z.infer<typeof PlanPricesRequestSchema>,
  ) {
    return this.catalogue.changePrices(me, planKind(kind), key, body.prices, body.reason);
  }

  @Post(':kind/:key/archive')
  @HttpCode(200)
  @StaffPermission('catalogue.edit')
  @ApiZodResponse(200, DoneSchema, 'Archived')
  async archive(
    @CurrentStaff() me: StaffContext,
    @Param('kind') kind: string,
    @Param('key') key: string,
    @Body(pipe(ArchiveRequestSchema)) body: z.infer<typeof ArchiveRequestSchema>,
  ) {
    await this.catalogue.archivePlan(me, planKind(kind), key, body.reason);
    return { status: 'done' as const };
  }

  // Industry templates.

  @Get('templates')
  @StaffPermission('catalogue.view', 'catalogue.draft')
  @ApiZodResponse(200, TemplatesSchema, 'Every version of every template')
  async templates() {
    return { data: await this.versions.templates() };
  }

  // Before ':key/:version', which would otherwise take 'diff' for a version.
  @Get('templates/:key/diff')
  @StaffPermission('catalogue.view', 'catalogue.draft')
  @ApiZodResponse(200, TemplateDiffSchema, 'What changed between two versions')
  diff(
    @Param('key') key: string,
    @Query(
      pipe(z.object({ from: z.string().regex(SEMVER_PARAM), to: z.string().regex(SEMVER_PARAM) })),
    )
    query: { from: string; to: string },
  ) {
    return this.versions.templateDiff(key, query.from, query.to);
  }

  @Get('templates/:key/:version')
  @StaffPermission('catalogue.view', 'catalogue.draft')
  @ApiZodResponse(
    200,
    TemplateDetailSchema,
    'One version, its definition and what stops it from being published',
  )
  async template(
    @Param('key') key: string,
    @Param('version') v: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const detail = await this.versions.template(key, version(v));
    response.setHeader('ETag', etagFor(detail.revision));
    return detail;
  }

  @Post('templates/:key/drafts')
  @StaffPermission('catalogue.draft')
  @ApiZodResponse(201, TemplateDetailSchema, 'A new draft version, copied from an existing one')
  createTemplateDraft(
    @CurrentStaff() me: StaffContext,
    @Param('key') key: string,
    @Body(pipe(TemplateDraftCreateSchema)) body: z.infer<typeof TemplateDraftCreateSchema>,
  ) {
    return this.versions.createTemplateDraft(me, key, body);
  }

  @Put('templates/:key/:version')
  @StaffPermission('catalogue.draft')
  @ApiZodResponse(200, TemplateDetailSchema, 'Draft saved (If-Match its revision)')
  updateTemplateDraft(
    @CurrentStaff() me: StaffContext,
    @Param('key') key: string,
    @Param('version') v: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(pipe(TemplateDraftUpdateSchema)) body: z.infer<typeof TemplateDraftUpdateSchema>,
  ) {
    return this.versions.updateTemplateDraft(me, key, version(v), body, ifMatch);
  }

  @Post('templates/:key/:version/publish')
  @HttpCode(202)
  @StaffPermission('catalogue.publish')
  @ApiZodResponse(202, ChangeResultSchema, 'Waiting for a second approver')
  publishTemplate(
    @CurrentStaff() me: StaffContext,
    @Param('key') key: string,
    @Param('version') v: string,
    @Body(pipe(PublishRequestSchema)) body: z.infer<typeof PublishRequestSchema>,
  ) {
    return this.versions.requestTemplatePublish(me, key, version(v), body.reason);
  }

  @Post('templates/:key/:version/deprecate')
  @HttpCode(200)
  @StaffPermission('catalogue.edit')
  @ApiZodResponse(200, DoneSchema, 'Deprecated')
  async deprecateTemplate(
    @CurrentStaff() me: StaffContext,
    @Param('key') key: string,
    @Param('version') v: string,
    @Body(pipe(ArchiveRequestSchema)) body: z.infer<typeof ArchiveRequestSchema>,
  ) {
    await this.versions.deprecateTemplate(me, key, version(v), body.reason);
    return { status: 'done' as const };
  }

  // Country packs.

  @Get('country-packs')
  @StaffPermission('country_packs.view')
  @ApiZodResponse(200, CountryPacksSchema, 'Every version of every country pack')
  async packs() {
    return { data: await this.versions.packs() };
  }

  @Get('country-packs/:country/:version')
  @StaffPermission('country_packs.view')
  @ApiZodResponse(200, CountryPackDetailSchema, 'One version and its data')
  async pack(
    @Param('country') country: string,
    @Param('version') v: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const detail = await this.versions.pack(country.toUpperCase(), version(v));
    response.setHeader('ETag', etagFor(detail.revision));
    return detail;
  }

  @Post('country-packs/:country/drafts')
  @StaffPermission('country_packs.edit')
  @ApiZodResponse(201, CountryPackDetailSchema, 'A new draft version, copied from an existing one')
  createPackDraft(
    @CurrentStaff() me: StaffContext,
    @Param('country') country: string,
    @Body(pipe(CountryPackDraftCreateSchema)) body: z.infer<typeof CountryPackDraftCreateSchema>,
  ) {
    return this.versions.createPackDraft(me, country.toUpperCase(), body);
  }

  @Put('country-packs/:country/:version')
  @StaffPermission('country_packs.edit')
  @ApiZodResponse(200, CountryPackDetailSchema, 'Draft saved (If-Match its revision)')
  updatePackDraft(
    @CurrentStaff() me: StaffContext,
    @Param('country') country: string,
    @Param('version') v: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(pipe(CountryPackDraftUpdateSchema)) body: z.infer<typeof CountryPackDraftUpdateSchema>,
  ) {
    return this.versions.updatePackDraft(me, country.toUpperCase(), version(v), body, ifMatch);
  }

  @Post('country-packs/:country/:version/publish')
  @HttpCode(202)
  @StaffPermission('country_packs.publish')
  @ApiZodResponse(202, ChangeResultSchema, 'Waiting for a second approver')
  async publishPack(
    @Auth() claims: AccessTokenClaims,
    @CurrentStaff() me: StaffContext,
    @Param('country') country: string,
    @Param('version') v: string,
    @Body(pipe(PublishRequestSchema)) body: z.infer<typeof PublishRequestSchema>,
  ) {
    await this.accounts.assertStepUp(claims);
    return this.versions.requestPackPublish(me, country.toUpperCase(), version(v), body.reason);
  }
}

@ApiTags('platform governance')
@ForAudience('console')
@Controller(PLATFORM_PREFIX)
export class GovernanceController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly audit: PlatformAuditService,
    private readonly accounts: StaffAccountsService,
  ) {}

  @Get('approvals')
  @StaffPermission(
    'approvals.view',
    'catalogue.publish',
    'country_packs.publish',
    'catalogue.prices',
  )
  @ApiZodResponse(200, ApprovalsSchema, 'Four-eyes requests, newest first')
  async list(
    @CurrentStaff() me: StaffContext,
    @Query(
      pipe(
        z.object({
          status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired']).optional(),
        }),
      ),
    )
    query: { status?: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' },
  ) {
    return { data: await this.approvals.list(me, query.status) };
  }

  @Post('approvals/:id/approve')
  @HttpCode(200)
  @StaffPermission('catalogue.publish', 'country_packs.publish', 'catalogue.prices')
  @ApiZodResponse(200, DoneSchema, 'Approved; the change ran')
  async approve(
    @Auth() claims: AccessTokenClaims,
    @CurrentStaff() me: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe(ApprovalDecisionSchema)) body: z.infer<typeof ApprovalDecisionSchema>,
  ) {
    // Publishing a country pack is sensitive (§3.3.1): the approver confirms with MFA too.
    const [approval] = (await this.approvals.list(me)).filter((a) => a.id === id);
    if (approval?.action === 'country_pack.publish') await this.accounts.assertStepUp(claims);
    await this.approvals.approve(me, id, body.note);
    return { status: 'done' as const };
  }

  @Post('approvals/:id/reject')
  @HttpCode(200)
  @StaffPermission('catalogue.publish', 'country_packs.publish', 'catalogue.prices')
  @ApiZodResponse(200, DoneSchema, 'Rejected; the change did not run')
  async reject(
    @CurrentStaff() me: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe(ApprovalRejectSchema)) body: z.infer<typeof ApprovalRejectSchema>,
  ) {
    await this.approvals.reject(me, id, body.note);
    return { status: 'done' as const };
  }

  @Post('approvals/:id/cancel')
  @HttpCode(200)
  @StaffPermission('catalogue.publish', 'country_packs.publish', 'catalogue.prices')
  @ApiZodResponse(200, DoneSchema, 'Withdrawn by the requester')
  async cancel(@CurrentStaff() me: StaffContext, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.approvals.cancel(me, id);
    return { status: 'done' as const };
  }

  @Get('audit')
  @StaffPermission('audit.view', 'audit.view_own', 'audit.view_billing', 'audit.view_ops')
  @ApiZodResponse(
    200,
    AuditPageSchema,
    'Platform audit log, newest first, as far as this role may see',
  )
  auditLog(
    @CurrentStaff() me: StaffContext,
    @Query(pipe(AuditQuerySchema)) query: z.infer<typeof AuditQuerySchema>,
  ) {
    return this.audit.list(me, query);
  }

  @Get('audit/export')
  @StaffPermission('audit.export')
  async exportAudit(
    @CurrentStaff() me: StaffContext,
    @Query(pipe(AuditQuerySchema)) query: z.infer<typeof AuditQuerySchema>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="platform-audit.csv"');
    return this.audit.csv(me, query);
  }
}

function planKind(kind: string): 'plan' | 'addon' {
  if (kind === 'plans') return 'plan';
  if (kind === 'addons') return 'addon';
  throw new ProblemException('not_found');
}
