import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';

/**
 * Context passed to every AUTOMATED_ACTION handler. Handlers MAY mutate
 * `context` — the engine persists the result back onto the instance row.
 *
 * Throwing from a handler is the way to signal failure; the engine moves the
 * instance to ERRORED (or jumps to `onError` if set) and writes an audit row.
 */
export interface ActionContext {
  companyId: string;
  instanceId: string;
  refType: string | null;
  refId: string | null;
  initiatorId: string | null;
  context: Record<string, unknown>;
  params: Record<string, unknown>;
}

export type WorkflowActionHandler = (ctx: ActionContext) => Promise<void> | void;

/**
 * Registry of named handlers for AUTOMATED_ACTION steps.
 *
 * Built-ins shipped here are intentionally small (noop, set_field,
 * audit_event, notify). Domain modules add their own — e.g. HR can register
 * "hr.leave.update_balance" or "finance.invoice.flip_status".
 */
@Injectable()
export class WorkflowActionsRegistry {
  private readonly logger = new Logger(WorkflowActionsRegistry.name);
  private readonly handlers = new Map<string, WorkflowActionHandler>();

  constructor(private readonly audit: AuditService) {
    this.registerBuiltins();
  }

  register(key: string, handler: WorkflowActionHandler) {
    if (this.handlers.has(key)) {
      this.logger.warn(`Overwriting workflow action handler: ${key}`);
    }
    this.handlers.set(key, handler);
  }

  has(key: string): boolean {
    return this.handlers.has(key);
  }

  async run(key: string, ctx: ActionContext): Promise<void> {
    const handler = this.handlers.get(key);
    if (!handler) throw new Error(`Unknown workflow action: ${key}`);
    await handler(ctx);
  }

  private registerBuiltins() {
    this.register('noop', () => undefined);

    this.register('set_field', (ctx) => {
      const path = String(ctx.params.path ?? '');
      const value = ctx.params.value;
      if (!path) return;
      setPath(ctx.context, path, value);
    });

    this.register('audit_event', async (ctx) => {
      await this.audit.record({
        companyId: ctx.companyId,
        actorId: ctx.initiatorId ?? null,
        action: String(ctx.params.action ?? 'workflow.action'),
        refType: ctx.refType ?? 'workflow_instance',
        refId: ctx.refId ?? ctx.instanceId,
        after: ctx.params.details as any,
        module: 'workflow',
      });
    });

    // Placeholder until the Notifications module lands. For now it just logs
    // and writes an audit entry so the trail is visible to admins.
    this.register('notify', async (ctx) => {
      this.logger.log(
        `[notify] instance=${ctx.instanceId} target=${JSON.stringify(ctx.params.target ?? {})} message=${ctx.params.message ?? ''}`,
      );
      await this.audit.record({
        companyId: ctx.companyId,
        actorId: ctx.initiatorId ?? null,
        action: 'workflow.notification_dispatched',
        refType: ctx.refType ?? 'workflow_instance',
        refId: ctx.refId ?? ctx.instanceId,
        after: { target: ctx.params.target, message: ctx.params.message } as any,
        module: 'workflow',
      });
    });
  }
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}
