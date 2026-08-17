import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';
import { TenantCrudController } from '../../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@ApiTags('Financials — Chart of Accounts')
@RequireModule('financials')
@Controller('financials/accounts')
export class AccountsController extends TenantCrudController({
  permissionResource: 'financials.account',
  label: 'chart of accounts',
  createDto: CreateAccountDto,
  updateDto: UpdateAccountDto,
}) {
  constructor(protected readonly service: AccountsService) {
    super();
  }

  // Declared before the inherited `:id` route would be reached, so 'tree' and
  // 'balances' are never mistaken for account ids.
  @ApiOperation({ summary: 'Chart of accounts as a nested tree' })
  @RequirePermission('financials.account.view')
  @Get('tree')
  tree(
    @CurrentUser() user: AuthedUser,
    @Query('type') type?: AccountType,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.tree(user.companyId as string, {
      type,
      includeInactive: includeInactive === 'true',
    });
  }

  @ApiOperation({ summary: 'Debit/credit totals and balance per account' })
  @RequirePermission('financials.account.view')
  @Get('balances')
  balances(
    @CurrentUser() user: AuthedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includeUnposted') includeUnposted?: string,
  ) {
    return this.service.balances(user.companyId as string, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      includeUnposted: includeUnposted === 'true',
    });
  }
}
