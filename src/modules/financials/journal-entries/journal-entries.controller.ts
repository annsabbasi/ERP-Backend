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
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import type { ListQuery } from '../../../common/crud/tenant-crud.service';
import { JournalEntriesService } from './journal-entries.service';
import {
  CreateJournalEntryDto,
  ReverseJournalEntryDto,
  UpdateJournalEntryDto,
} from './dto/journal-entry.dto';

@ApiTags('Financials — Journal Entries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('financials')
@Controller('financials/journal-entries')
export class JournalEntriesController {
  constructor(private readonly service: JournalEntriesService) {}

  @ApiOperation({ summary: 'List journal entries' })
  @RequirePermission('financials.journal.view')
  @Get()
  findAll(@CurrentUser() user: AuthedUser, @Query() query: ListQuery) {
    return this.service.findAll(user.companyId as string, query);
  }

  @ApiOperation({ summary: 'Get one journal entry with its lines' })
  @RequirePermission('financials.journal.view')
  @Get(':id')
  findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId as string, id);
  }

  @ApiOperation({ summary: 'Create a journal entry (draft, or posted with post=true)' })
  @RequirePermission('financials.journal.create')
  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateJournalEntryDto) {
    return this.service.create(user.companyId as string, user.sub, dto);
  }

  @ApiOperation({ summary: 'Update a draft journal entry' })
  @RequirePermission('financials.journal.update')
  @Put(':id')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdateJournalEntryDto,
  ) {
    return this.service.update(user.companyId as string, id, user.sub, dto);
  }

  @ApiOperation({ summary: 'Post a draft entry to the ledger' })
  @RequirePermission('finance.journal.post')
  @Post(':id/post')
  post(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.post(user.companyId as string, id, user.sub);
  }

  @ApiOperation({ summary: 'Reverse a posted entry with a mirror entry' })
  @RequirePermission('finance.journal.post')
  @Post(':id/reverse')
  reverse(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: ReverseJournalEntryDto,
  ) {
    return this.service.reverse(user.companyId as string, id, user.sub, dto);
  }

  @ApiOperation({ summary: 'Delete a draft entry' })
  @RequirePermission('financials.journal.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.remove(user.companyId as string, id);
  }
}
