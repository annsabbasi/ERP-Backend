import { Global, Module } from '@nestjs/common';
import { WorkflowActionsRegistry } from './workflow-actions.registry';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowInstancesController } from './workflow-instances.controller';

@Global()
@Module({
  controllers: [WorkflowDefinitionsController, WorkflowInstancesController],
  providers: [WorkflowEngineService, WorkflowDefinitionsService, WorkflowActionsRegistry],
  exports: [WorkflowEngineService, WorkflowDefinitionsService, WorkflowActionsRegistry],
})
export class WorkflowsModule {}
