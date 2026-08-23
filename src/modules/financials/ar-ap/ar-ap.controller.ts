import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../../common/guards/module-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { IdempotencyKey } from '../../../common/decorators/idempotency-key.decorator';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import type { ListQuery } from '../../../common/crud/tenant-crud.service';
import { APBillsService, ARInvoicesService } from './ar-ap.service';
import {
  CreateAPBillDto,
  CreateARInvoiceDto,
  RecordPaymentDto,
  UpdateAPBillDto,
  UpdateARInvoiceDto,
  VoidDocumentDto,
} from './ar-ap.dto';

@ApiTags('Financials — A/R Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('financials')
@Controller('financials/ar-invoices')
export class ARInvoicesController {
  constructor(private readonly service: ARInvoicesService) {}

  @ApiOperation({ summary: 'List A/R invoices' })
  @RequirePermission('financials.ar.view')
  @Get()
  findAll(@CurrentUser() user: AuthedUser, @Query() query: ListQuery) {
    return this.service.findAll(user.companyId as string, query);
  }

  @ApiOperation({ summary: 'Open receivables grouped by partner and age' })
  @RequirePermission('financials.ar.view')
  @Get('ageing')
  ageing(@CurrentUser() user: AuthedUser, @Query('asOf') asOf?: string) {
    return this.service.ageing(user.companyId as string, asOf);
  }

  @ApiOperation({ summary: 'Get one A/R invoice with its lines and payments' })
  @RequirePermission('financials.ar.view')
  @Get(':id')
  findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId as string, id);
  }

  @ApiOperation({ summary: 'Create a draft A/R invoice' })
  @RequirePermission('financials.ar.create')
  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateARInvoiceDto) {
    return this.service.create(user.companyId as string, dto);
  }

  @ApiOperation({ summary: 'Update a draft A/R invoice' })
  @RequirePermission('financials.ar.update')
  @Put(':id')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdateARInvoiceDto,
  ) {
    return this.service.update(user.companyId as string, id, dto);
  }

  @ApiOperation({ summary: 'Issue the invoice and post it to the ledger' })
  @RequirePermission('finance.journal.post')
  @Post(':id/post')
  post(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.post(user.companyId as string, id, user.sub);
  }

  @ApiOperation({ summary: 'Record a receipt against the invoice' })
  @RequirePermission('finance.journal.post')
  @Post(':id/payments')
  pay(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.service.recordPayment(user.companyId as string, id, user.sub, dto, idempotencyKey);
  }

  @ApiOperation({ summary: 'Void an issued invoice, reversing its journal entry' })
  @RequirePermission('finance.journal.post')
  @Post(':id/void')
  void(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.service.void(user.companyId as string, id, user.sub, dto);
  }

  @ApiOperation({ summary: 'Delete a draft A/R invoice' })
  @RequirePermission('financials.ar.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.remove(user.companyId as string, id);
  }
}

@ApiTags('Financials — A/P Bills')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('financials')
@Controller('financials/ap-bills')
export class APBillsController {
  constructor(private readonly service: APBillsService) {}

  @ApiOperation({ summary: 'List A/P bills' })
  @RequirePermission('financials.ap.view')
  @Get()
  findAll(@CurrentUser() user: AuthedUser, @Query() query: ListQuery) {
    return this.service.findAll(user.companyId as string, query);
  }

  @ApiOperation({ summary: 'Open payables grouped by partner and age' })
  @RequirePermission('financials.ap.view')
  @Get('ageing')
  ageing(@CurrentUser() user: AuthedUser, @Query('asOf') asOf?: string) {
    return this.service.ageing(user.companyId as string, asOf);
  }

  @ApiOperation({ summary: 'Get one A/P bill with its lines and payments' })
  @RequirePermission('financials.ap.view')
  @Get(':id')
  findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId as string, id);
  }

  @ApiOperation({ summary: 'Create a draft A/P bill' })
  @RequirePermission('financials.ap.create')
  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateAPBillDto) {
    return this.service.create(user.companyId as string, dto);
  }

  @ApiOperation({ summary: 'Update a draft A/P bill' })
  @RequirePermission('financials.ap.update')
  @Put(':id')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAPBillDto,
  ) {
    return this.service.update(user.companyId as string, id, dto);
  }

  @ApiOperation({ summary: 'Approve the bill and post it to the ledger' })
  @RequirePermission('finance.journal.post')
  @Post(':id/post')
  post(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.post(user.companyId as string, id, user.sub);
  }

  @ApiOperation({ summary: 'Record a payment against the bill' })
  @RequirePermission('finance.journal.post')
  @Post(':id/payments')
  pay(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.service.recordPayment(user.companyId as string, id, user.sub, dto, idempotencyKey);
  }

  @ApiOperation({ summary: 'Void an approved bill, reversing its journal entry' })
  @RequirePermission('finance.journal.post')
  @Post(':id/void')
  void(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.service.void(user.companyId as string, id, user.sub, dto);
  }

  @ApiOperation({ summary: 'Delete a draft A/P bill' })
  @RequirePermission('financials.ap.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.remove(user.companyId as string, id);
  }
}
