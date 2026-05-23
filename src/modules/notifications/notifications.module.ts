import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ChannelRegistry } from './channels/channel.registry';
import { EmailAdapter } from './channels/email.adapter';
import { InAppAdapter } from './channels/in-app.adapter';
import {
  DesktopToastAdapter,
  PushAdapter,
  SmsAdapter,
  WhatsAppAdapter,
} from './channels/stub.adapters';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WorkflowActionsRegistry } from '../workflows/workflow-actions.registry';

@Global()
@Module({
  controllers: [NotificationsController, WebhooksController],
  providers: [
    NotificationsService,
    WebhooksService,
    ChannelRegistry,
    InAppAdapter,
    EmailAdapter,
    SmsAdapter,
    WhatsAppAdapter,
    PushAdapter,
    DesktopToastAdapter,
  ],
  exports: [NotificationsService, WebhooksService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly actions: WorkflowActionsRegistry,
  ) {}

  /**
   * Replace the placeholder `notify` handler shipped by WorkflowActionsRegistry
   * with a real fan-out, and register `_internal.notify_approvers` so the
   * workflow engine can ping assignees when an APPROVAL step is entered.
   */
  onModuleInit() {
    // Replaces the bootstrap placeholder — see WorkflowActionsRegistry.
    this.actions.register('notify', async (ctx) => {
      const target = (ctx.params.target ?? {}) as {
        userId?: string;
        userIds?: string[];
        contextPath?: string;
        roleKey?: string; // resolved later when role-by-key lookup is wired
      };
      const userIds = new Set<string>();
      if (target.userId) userIds.add(target.userId);
      if (Array.isArray(target.userIds)) target.userIds.forEach((u) => userIds.add(u));
      if (target.contextPath) {
        const val = pickPath(ctx.context, target.contextPath);
        if (typeof val === 'string') userIds.add(val);
        else if (Array.isArray(val)) {
          for (const v of val) if (typeof v === 'string') userIds.add(v);
        }
      }
      if (!userIds.size) return;

      await this.notifications.send({
        companyId: ctx.companyId,
        userIds: [...userIds],
        category: String(ctx.params.category ?? 'workflow.notification'),
        subject: ctx.params.subject as string | undefined,
        body: String(ctx.params.message ?? ''),
        refType: ctx.refType ?? 'workflow_instance',
        refId: ctx.refId ?? ctx.instanceId,
        data: { instanceId: ctx.instanceId },
      });
    });

    this.actions.register('_internal.notify_approvers', async (ctx) => {
      const { stepKey, stepName, approverIds, definitionKey } = ctx.params as {
        stepKey: string;
        stepName: string;
        approverIds: string[];
        definitionKey?: string;
      };
      if (!Array.isArray(approverIds) || !approverIds.length) return;

      await this.notifications.send({
        companyId: ctx.companyId,
        userIds: approverIds,
        category: 'workflow.approval_required',
        subject: `Approval needed: ${stepName}`,
        body: `You have an approval pending in workflow "${definitionKey ?? ctx.refType ?? 'instance'}". Step: ${stepName}.`,
        refType: ctx.refType ?? 'workflow_instance',
        refId: ctx.refId ?? ctx.instanceId,
        data: { instanceId: ctx.instanceId, stepKey, definitionKey },
      });
    });
  }
}

function pickPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}
