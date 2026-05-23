import type { WorkflowStepGraph } from './workflow.types';

/**
 * System workflow templates seeded once by `prisma seed`. Each template is
 * platform-wide (companyId = null, isSystem = true) and can be cloned into a
 * per-company version that the company is free to edit.
 *
 * Adding a template:
 *   1. Append to SYSTEM_WORKFLOW_TEMPLATES below.
 *   2. Bump its `version` if you change the graph after release.
 *   3. Re-run `prisma db seed`.
 */

export interface SystemWorkflowTemplate {
  key: string;
  name: string;
  description: string;
  entityType?: string;
  version: number;
  steps: WorkflowStepGraph;
}

export const SYSTEM_WORKFLOW_TEMPLATES: SystemWorkflowTemplate[] = [
  // 9.2.2 — Leave Request
  {
    key: 'leave_request',
    name: 'Leave Request',
    description: "Employee submits → direct manager approval (resolved from request context) → HR notified.",
    entityType: 'hr.leave',
    version: 1,
    steps: {
      start: 'manager_approval',
      steps: {
        manager_approval: {
          key: 'manager_approval',
          name: 'Manager approval',
          type: 'APPROVAL',
          semantics: 'FIRST_RESPONSE',
          slaMinutes: 60 * 24, // 24h informational SLA
          // Pull approver from the instance context — the kick-off code sets
          // context.managerId from the requester's department head.
          approvers: [{ kind: 'context', path: 'managerId' }],
          onApprove: 'notify_hr',
          onReject: 'notify_rejection',
        },
        notify_hr: {
          key: 'notify_hr',
          name: 'Notify HR',
          type: 'AUTOMATED_ACTION',
          actionKey: 'notify',
          params: { target: { roleKey: 'hr-admin' }, message: 'Leave approved — please update calendars.' },
        },
        notify_rejection: {
          key: 'notify_rejection',
          name: 'Notify requester',
          type: 'AUTOMATED_ACTION',
          actionKey: 'notify',
          params: { target: { contextPath: 'requesterId' }, message: 'Your leave request was declined.' },
        },
      },
    },
  },

  // 9.2.3 — Purchase Order Approval (three-tier by amount)
  {
    key: 'purchase_order_approval',
    name: 'Purchase Order Approval',
    description: "Amount-tiered approval chain: small → department head, medium → finance, large → company admin.",
    entityType: 'purchasing.po',
    version: 1,
    steps: {
      start: 'route_by_amount',
      steps: {
        route_by_amount: {
          key: 'route_by_amount',
          name: 'Route by amount',
          type: 'CONDITIONAL_BRANCH',
          cases: [
            { when: { path: 'amountMinor', lt: 100000 }, then: 'small_po_approval' },
            { when: { path: 'amountMinor', lt: 1000000 }, then: 'medium_po_approval' },
          ],
          default: 'large_po_approval',
        },
        small_po_approval: {
          key: 'small_po_approval',
          name: 'Department head approval',
          type: 'APPROVAL',
          semantics: 'FIRST_RESPONSE',
          approvers: [{ kind: 'department_head' }],
          onApprove: 'send_po',
          onReject: 'notify_rejection',
        },
        medium_po_approval: {
          key: 'medium_po_approval',
          name: 'Finance approval',
          type: 'APPROVAL',
          semantics: 'FIRST_RESPONSE',
          approvers: [{ kind: 'context', path: 'financeApproverId' }],
          onApprove: 'send_po',
          onReject: 'notify_rejection',
        },
        large_po_approval: {
          key: 'large_po_approval',
          name: 'Company admin approval',
          type: 'APPROVAL',
          semantics: 'UNANIMOUS',
          approvers: [{ kind: 'context', path: 'executiveApproverIds' }],
          onApprove: 'send_po',
          onReject: 'notify_rejection',
        },
        send_po: {
          key: 'send_po',
          name: 'Dispatch PO to supplier',
          type: 'AUTOMATED_ACTION',
          actionKey: 'notify',
          params: { target: { contextPath: 'supplierContactId' }, message: 'PO approved and dispatched.' },
        },
        notify_rejection: {
          key: 'notify_rejection',
          name: 'Notify requester',
          type: 'AUTOMATED_ACTION',
          actionKey: 'notify',
          params: { target: { contextPath: 'requesterId' }, message: 'PO request declined.' },
        },
      },
    },
  },

  // Generic single-approver flow — handy template for expense / reimbursement.
  {
    key: 'expense_reimbursement',
    name: 'Expense Reimbursement',
    description: 'Employee submits → direct manager approval → finance notified.',
    entityType: 'finance.reimbursement',
    version: 1,
    steps: {
      start: 'manager_approval',
      steps: {
        manager_approval: {
          key: 'manager_approval',
          name: 'Manager approval',
          type: 'APPROVAL',
          semantics: 'FIRST_RESPONSE',
          approvers: [{ kind: 'context', path: 'managerId' }],
          onApprove: 'notify_finance',
          onReject: 'notify_rejection',
        },
        notify_finance: {
          key: 'notify_finance',
          name: 'Notify finance',
          type: 'AUTOMATED_ACTION',
          actionKey: 'notify',
          params: { target: { roleKey: 'finance' }, message: 'Reimbursement approved — please process.' },
        },
        notify_rejection: {
          key: 'notify_rejection',
          name: 'Notify requester',
          type: 'AUTOMATED_ACTION',
          actionKey: 'notify',
          params: { target: { contextPath: 'requesterId' }, message: 'Reimbursement request declined.' },
        },
      },
    },
  },
];
