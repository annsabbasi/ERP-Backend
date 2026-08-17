import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../../common/guards/module-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import { FinancialReportsService, ReportRange } from './financial-reports.service';

@ApiTags('Financials — Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('financials')
@RequirePermission('financials.report.view')
@Controller('financials/reports')
export class FinancialReportsController {
  constructor(private readonly service: FinancialReportsService) {}

  @ApiOperation({ summary: 'Trial balance with opening, movement and closing per account' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @Get('trial-balance')
  trialBalance(@CurrentUser() user: AuthedUser, @Query() q: Record<string, string>) {
    return this.service.trialBalance(user.companyId as string, range(q));
  }

  @ApiOperation({ summary: 'Profit and loss statement' })
  @Get('profit-and-loss')
  profitAndLoss(@CurrentUser() user: AuthedUser, @Query() q: Record<string, string>) {
    return this.service.profitAndLoss(user.companyId as string, range(q));
  }

  @ApiOperation({ summary: 'Balance sheet as of a date' })
  @Get('balance-sheet')
  balanceSheet(@CurrentUser() user: AuthedUser, @Query() q: Record<string, string>) {
    return this.service.balanceSheet(
      user.companyId as string,
      q.asOf ? new Date(q.asOf) : new Date(),
      { includeUnposted: q.includeUnposted === 'true' },
    );
  }

  @ApiOperation({ summary: 'General ledger detail with running balances' })
  @ApiQuery({ name: 'accountIds', required: false, description: 'Comma-separated account ids' })
  @Get('general-ledger')
  generalLedger(@CurrentUser() user: AuthedUser, @Query() q: Record<string, string>) {
    return this.service.generalLedger(user.companyId as string, {
      ...range(q),
      accountIds: q.accountIds ? q.accountIds.split(',').filter(Boolean) : undefined,
      bpId: q.bpId || undefined,
    });
  }

  @ApiOperation({ summary: 'Customer receivables aging' })
  @Get('aging/receivables')
  agingReceivables(@CurrentUser() user: AuthedUser, @Query('asOf') asOf?: string) {
    return this.service.aging(
      user.companyId as string,
      'receivables',
      asOf ? new Date(asOf) : new Date(),
    );
  }

  @ApiOperation({ summary: 'Vendor liabilities aging' })
  @Get('aging/payables')
  agingPayables(@CurrentUser() user: AuthedUser, @Query('asOf') asOf?: string) {
    return this.service.aging(
      user.companyId as string,
      'payables',
      asOf ? new Date(asOf) : new Date(),
    );
  }

  @ApiOperation({ summary: 'Document journal — every entry with its lines' })
  @Get('document-journal')
  documentJournal(@CurrentUser() user: AuthedUser, @Query() q: Record<string, string>) {
    return this.service.documentJournal(user.companyId as string, range(q));
  }
}

function range(q: Record<string, string>): ReportRange {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    includeUnposted: q.includeUnposted === 'true',
    includeZeroBalances: q.includeZeroBalances === 'true',
  };
}
