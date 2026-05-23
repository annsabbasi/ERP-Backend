import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import {
  CloneWorkflowDefinitionDto,
  CreateWorkflowDefinitionDto,
  UpdateWorkflowDefinitionDto,
} from './dto/workflow-definition.dto';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

@Controller('workflow-definitions')
export class WorkflowDefinitionsController {
  constructor(
    private readonly definitions: WorkflowDefinitionsService,
    private readonly tenant: TenantContextService,
  ) {}

  @RequirePermission('workflow.definition.view')
  @Get()
  list() {
    return this.definitions.list(this.tenant.requireCompanyId());
  }

  @RequirePermission('workflow.definition.view')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.definitions.findOne(id, this.tenant.requireCompanyId());
  }

  @RequirePermission('workflow.definition.manage')
  @Post()
  create(@Body() dto: CreateWorkflowDefinitionDto) {
    return this.definitions.create(dto, this.tenant.requireCompanyId());
  }

  @RequirePermission('workflow.definition.manage')
  @Post(':id/clone')
  clone(@Param('id') id: string, @Body() dto: CloneWorkflowDefinitionDto) {
    return this.definitions.clone(id, dto, this.tenant.requireCompanyId());
  }

  @RequirePermission('workflow.definition.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkflowDefinitionDto) {
    return this.definitions.update(id, dto, this.tenant.requireCompanyId());
  }

  @RequirePermission('workflow.definition.manage')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.definitions.remove(id, this.tenant.requireCompanyId());
  }
}
