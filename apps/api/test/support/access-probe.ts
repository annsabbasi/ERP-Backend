import { Controller, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import { DatabaseService } from '../../src/modules/database/database.service';
import { RequireFeature, RequirePermission } from '../../src/modules/access/access.decorators';
import { LimitsService } from '../../src/modules/access/limits.service';
import { ScopeService, type ScopeFields } from '../../src/modules/access/scope.service';

// Test-only routes behind the real global guards, one per gate, until business modules bring
// their own (Stage 5 onwards). They read real tables through the request's tenant transaction.

const BRANCH_SCOPE: ScopeFields = { branch: 'id', legalEntity: 'legalEntityId' };
const MEMBER_SCOPE: ScopeFields = {
  membership: 'id',
  createdBy: 'createdBy',
  branch: 'primaryBranchId',
  department: 'departmentId',
};

@Controller('probe')
export class AccessProbeController {
  constructor(
    private readonly db: DatabaseService,
    private readonly scope: ScopeService,
    private readonly limits: LimitsService,
  ) {}

  @Get('branches')
  @RequirePermission('core.branches.view')
  branches() {
    const where = this.scope.where('core.branches.view', BRANCH_SCOPE);
    return this.db.tx.branch.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } });
  }

  @Get('branches/:id')
  @RequirePermission('core.branches.view')
  branch(@Param('id') id: string) {
    return this.scope.one('core.branches.view', BRANCH_SCOPE, (where) =>
      this.db.tx.branch.findFirst({ where: { AND: [{ id }, where ?? {}] }, select: { id: true } }),
    );
  }

  @Post('branches')
  @HttpCode(200)
  @RequirePermission('core.branches.create')
  addBranch() {
    return this.limits.check('branches.max');
  }

  @Get('members')
  @RequirePermission('core.members.view')
  members() {
    const where = this.scope.where('core.members.view', MEMBER_SCOPE);
    return this.db.tx.membership.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } });
  }

  @Post('orders')
  @HttpCode(200)
  @RequireFeature('restaurant.waiter_app')
  @RequirePermission('restaurant.orders.create')
  createOrder() {
    return { status: 'done' };
  }

  @Get('orders')
  @RequirePermission('restaurant.orders.view')
  orders() {
    return { status: 'done' };
  }
}

@Module({ controllers: [AccessProbeController] })
export class AccessProbeModule {}
