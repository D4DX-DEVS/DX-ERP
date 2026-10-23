import "server-only";
import { connectDB } from "@/lib/db";
import { AuditLog } from "@/lib/models";
import { requestMeta, type CurrentUser } from "@/lib/auth/session";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "submit"
  | "cancel"
  | "correct"
  | "assign"
  | "status"
  | "payment"
  | "login"
  | "logout"
  | "login_failed"
  | "access"
  | "config"
  | "export"
  | "import"
  | "backup"
  | "restore";

export interface AuditInput {
  action: AuditAction;
  entity: string;
  entityId?: string | { toString(): string };
  ref?: string;
  summary: string;
  changes?: { field: string; from?: unknown; to?: unknown }[];
}

function stringify(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, 500);
    } catch {
      return String(value);
    }
  }
  return String(value).slice(0, 500);
}

/** Records a significant action in the audit trail (FRS §20.3). Never throws. */
export async function audit(
  actor: Pick<CurrentUser, "_id" | "name" | "role"> | { _id?: undefined; name: string; role?: string } | null,
  input: AuditInput,
): Promise<void> {
  try {
    await connectDB();
    const meta = await requestMeta().catch(() => ({ ip: undefined, userAgent: undefined }));
    await AuditLog.create({
      actor: actor?._id,
      actorName: actor?.name ?? "System",
      actorRole: actor?.role,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId?.toString(),
      ref: input.ref,
      summary: input.summary,
      changes: input.changes
        ?.map((c) => ({ field: c.field, from: stringify(c.from), to: stringify(c.to) }))
        .filter((c) => c.from !== c.to),
      ip: meta.ip,
      userAgent: meta.userAgent,
      at: new Date(),
    });
  } catch (error) {
    console.error("[audit] failed to record", error);
  }
}

/** Marker stored instead of a value for confidential fields (amounts, restricted-client contacts, personal data). */
export const REDACTED = "(changed — value not recorded)";

/**
 * Builds a change list between two plain objects for the given fields. Fields listed in `redact` are recorded
 * by name only: `audit.view` holders need not hold the module permission that guards the value itself.
 */
export function diff<T extends Record<string, unknown>>(
  before: Partial<T>,
  after: Partial<T>,
  fields: (keyof T & string)[],
  redact: (keyof T & string)[] = [],
): { field: string; from?: unknown; to?: unknown }[] {
  return fields
    .filter((f) => stringify(before[f]) !== stringify(after[f]))
    .map((f) => (redact.includes(f) ? { field: f, to: REDACTED } : { field: f, from: before[f], to: after[f] }));
}
