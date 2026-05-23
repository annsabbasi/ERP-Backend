import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import {
  CreateWebhookEndpointDto,
  TestWebhookDto,
  UpdateWebhookEndpointDto,
} from './dto/notifications.dto';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly tenant: TenantContextService,
  ) {}

  @RequirePermission('webhooks.endpoint.view')
  @Get('endpoints')
  list() {
    return this.webhooks.listEndpoints(this.tenant.requireCompanyId());
  }

  @RequirePermission('webhooks.endpoint.view')
  @Get('endpoints/:id')
  async findOne(@Param('id') id: string) {
    const ep = await this.webhooks.findEndpoint(this.tenant.requireCompanyId(), id);
    if (!ep) throw new NotFoundException(`Endpoint ${id} not found`);
    return ep;
  }

  @RequirePermission('webhooks.endpoint.manage')
  @Post('endpoints')
  create(@Body() dto: CreateWebhookEndpointDto) {
    return this.webhooks.createEndpoint(this.tenant.requireCompanyId(), dto);
  }

  @RequirePermission('webhooks.endpoint.manage')
  @Patch('endpoints/:id')
  update(@Param('id') id: string, @Body() dto: UpdateWebhookEndpointDto) {
    return this.webhooks.updateEndpoint(this.tenant.requireCompanyId(), id, dto);
  }

  @RequirePermission('webhooks.endpoint.manage')
  @Delete('endpoints/:id')
  remove(@Param('id') id: string) {
    return this.webhooks.removeEndpoint(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('webhooks.delivery.view')
  @Get('endpoints/:id/deliveries')
  deliveries(@Param('id') id: string) {
    return this.webhooks.listDeliveries(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('webhooks.endpoint.manage')
  @Post('endpoints/:id/test')
  async test(@Param('id') id: string, @Body() dto: TestWebhookDto) {
    await this.webhooks.dispatch({
      companyId: this.tenant.requireCompanyId(),
      eventKey: dto.eventKey,
      payload: { test: true, ...(dto.payload ?? {}) },
    });
    return { ok: true };
  }
}
