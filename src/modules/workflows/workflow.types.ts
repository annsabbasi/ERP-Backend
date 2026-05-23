import type { WorkflowStepType as PrismaWorkflowStepType } from '@prisma/client';

export type WorkflowStepType = PrismaWorkflowStepType;

// ApprovalSemantics is declared in the Prisma schema for documentation but is
// not used as a column type — it lives inside the JSON step graph below. We
// mirror it as a local string union so callers don't import from a generated
// type that isn't actually emitted by the client.
export type ApprovalSemantics = 'FIRST_RESPONSE' | 'UNANIMOUS' | 'MAJORITY';

/**
 * Shape of a workflow definition's `steps` JSON column.
 *
 * The runtime engine walks this graph by step `key`. Each step's `next`
 * field points to the next step's key (linear default). Step-type-specific
 * fields (onApprove/onReject for APPROVAL, cases for CONDITIONAL_BRANCH)
 * override `next` when set.
 *
 * Why JSON instead of normalized tables: workflows are read >> written, and
 * each instance pins to a specific (definition, version) snapshot. A JSON
 * blob is one disk read, validates against this TypeScript shape at write
 * time, and avoids a 3-table join on every step transition.
 */
export interface WorkflowStepGraph {
  /** Step key that starts this workflow. */
  start: string;
  /** All steps, keyed by `step.key`. */
  steps: Record<string, WorkflowStep>;
}

export type WorkflowStep =
  | ApprovalStep
  | AutomatedActionStep
  | ConditionalBranchStep
  | WaitStep
  | EscalationStep;

interface BaseStep {
  key: string;
  name: string;
  description?: string;
  /** Next step key (linear flow); step-type-specific routing overrides this. */
  next?: string;
  /** Routing target on uncaught error. */
  onError?: string;
}

export interface ApprovalStep extends BaseStep {
  type: 'APPROVAL';
  approvers: ApproverSpec[];
  semantics: ApprovalSemantics;
  /** Soft SLA; informational until the cron resumer arrives. */
  slaMinutes?: number;
  /** Override `next` on full approval. */
  onApprove?: string;
  /** Where to route when the approval is rejected. */
  onReject?: string;
}

export interface AutomatedActionStep extends BaseStep {
  type: 'AUTOMATED_ACTION';
  /** Key in the WorkflowActionsRegistry. */
  actionKey: string;
  params?: Record<string, unknown>;
}

export interface ConditionalBranchStep extends BaseStep {
  type: 'CONDITIONAL_BRANCH';
  cases: Array<{ when: Condition; then: string }>;
  default?: string;
}

export interface WaitStep extends BaseStep {
  type: 'WAIT';
  /** Wait this many seconds from when the step is entered. */
  forSeconds?: number;
  /** Or resume when a context field matches an ISO timestamp <= now. */
  untilContextPath?: string;
}

export interface EscalationStep extends BaseStep {
  type: 'ESCALATION';
  /** Approval-step key whose SLA we're enforcing. */
  watchStepKey: string;
  reassignTo?: ApproverSpec;
}

export type ApproverSpec =
  | { kind: 'user'; userId: string }
  | { kind: 'role'; roleId: string }
  | { kind: 'department_head'; departmentId?: string }
  | { kind: 'context'; path: string };

// ── Condition evaluator (Section 9.1 — JSON-logic-like) ─────────────────────

export type Condition =
  | { path: string; eq: unknown }
  | { path: string; neq: unknown }
  | { path: string; gt: number | string }
  | { path: string; gte: number | string }
  | { path: string; lt: number | string }
  | { path: string; lte: number | string }
  | { path: string; in: unknown[] }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/** Returns the value at the dotted path, or undefined if missing. */
export function getPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function evaluateCondition(cond: Condition, ctx: unknown): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, ctx));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, ctx));
  if ('not' in cond) return !evaluateCondition(cond.not, ctx);

  const lhs = getPath(ctx, cond.path);
  if ('eq' in cond)  return lhs === cond.eq;
  if ('neq' in cond) return lhs !== cond.neq;
  if ('in' in cond)  return cond.in.includes(lhs);

  // Numeric / lexicographic comparisons — fall through to JS semantics.
  if ('gt' in cond)  return (lhs as any) > cond.gt;
  if ('gte' in cond) return (lhs as any) >= cond.gte;
  if ('lt' in cond)  return (lhs as any) < cond.lt;
  if ('lte' in cond) return (lhs as any) <= cond.lte;

  return false;
}
