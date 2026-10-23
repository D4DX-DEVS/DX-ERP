import type { Tone } from "@/lib/config-defaults";
import type { AuditAction } from "@/lib/audit";

/** Label and chip colour for every audit action. */
export const ACTION_META: Record<AuditAction, [label: string, tone: Tone]> = {
  create: ["Created", "green"],
  update: ["Updated", "blue"],
  delete: ["Deleted", "red"],
  approve: ["Approved", "green"],
  reject: ["Rejected", "red"],
  submit: ["Submitted", "blue"],
  cancel: ["Cancelled", "gray"],
  correct: ["Corrected", "purple"],
  assign: ["Assigned", "blue"],
  status: ["Status change", "amber"],
  payment: ["Payment", "green"],
  login: ["Signed in", "gray"],
  logout: ["Signed out", "gray"],
  login_failed: ["Sign-in failed", "red"],
  access: ["Access change", "purple"],
  config: ["Configuration", "orange"],
  export: ["Export", "gray"],
  import: ["Import", "blue"],
  backup: ["Backup", "green"],
  restore: ["Restore", "red"],
};

export const AUDIT_ACTIONS = Object.keys(ACTION_META) as AuditAction[];

export function actionLabel(action: string): string {
  return ACTION_META[action as AuditAction]?.[0] ?? action.replace(/_/g, " ");
}

export function actionTone(action: string): Tone {
  return ACTION_META[action as AuditAction]?.[1] ?? "gray";
}
