import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { BusinessPartnersService } from './business-partners/business-partners.service';
import { Customer360Service } from './customer-360/customer-360.service';
import * as S from './crm.services';
import * as C from './crm.controllers';

@Module({
  // Business partners, activities, opportunities and campaigns all allocate
  // document numbers from the shared Administration allocator.
  imports: [AdministrationModule],
  controllers: [
    C.BusinessPartnersController,
    C.TerritoriesController,
    C.CommissionGroupsController,
    C.SalesEmployeesController,
    C.BpGroupsController,
    C.OpportunityStageDefsController,
    C.CompetitorsController,
    C.CrmPartnersController,
    C.InformationSourcesController,
    C.BpRelationshipTypesController,
    C.ActivitiesController,
    C.OpportunitiesController,
    C.CampaignsController,
    C.Customer360Controller,
  ],
  providers: [
    BusinessPartnersService,
    Customer360Service,
    S.TerritoriesService,
    S.CommissionGroupsService,
    S.SalesEmployeesService,
    S.BpGroupsService,
    S.OpportunityStageDefsService,
    S.CompetitorsService,
    S.CrmPartnersService,
    S.InformationSourcesService,
    S.BpRelationshipTypesService,
    S.ActivitiesService,
    S.OpportunitiesService,
    S.CampaignsService,
  ],
  exports: [BusinessPartnersService, Customer360Service],
})
export class CrmModule {}
