import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { exportResponse, isExportFormat } from "@/lib/export";
import { titleCase } from "@/lib/format";
import { AuditLog, User } from "@/lib/models";
import { idParam, type SearchParams } from "@/lib/query";
import { ROLE_LABELS } from "@/lib/rbac/permissions";
import { fmtDateTime } from "@/lib/time";
import { describeAuditFilter, buildAuditFilter } from "../filters";
import { actionLabel } from "../meta";

const MAX_ROWS = 10_000;

/** CSV / Excel / PDF export of the audit trail with the page's filters. Requires audit.view; the export is audited. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!can(user, "audit.view")) return new NextResponse("You don't have permission to export the audit trail.", { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!isExportFormat(format)) return new NextResponse("Unsupported format", { status: 400 });
  const sp: SearchParams = Object.fromEntries(url.searchParams.entries());

  const filter = buildAuditFilter(sp);
  const actorId = idParam(sp, "actor");
  const [rows, total, [actor]] = await Promise.all([
    db().select().from(AuditLog).where(filter).orderBy(desc(AuditLog.at), desc(AuditLog._id)).limit(MAX_ROWS),
    db().$count(AuditLog, filter),
    actorId ? db().select({ name: User.name }).from(User).where(eq(User._id, actorId)).limit(1) : Promise.resolve([]),
  ]);

  const description = describeAuditFilter(sp, actor?.name);
  await audit(user, {
    action: "export",
    entity: "audit",
    ref: format.toUpperCase(),
    summary: `Exported ${rows.length} audit entries as ${format.toUpperCase()} · ${description}${total > rows.length ? ` (truncated from ${total})` : ""}`,
  });

  return exportResponse({
    title: "Audit trail",
    filename: "audit-trail",
    format,
    subtitle: `${description}${total > rows.length ? ` · first ${MAX_ROWS} of ${total} entries` : ""}`,
    rows,
    columns: [
      { header: "When", value: (r) => fmtDateTime(r.at), width: 20 },
      { header: "User", value: (r) => r.actorName, width: 22 },
      { header: "Role", value: (r) => (r.actorRole ? (ROLE_LABELS[r.actorRole] ?? titleCase(r.actorRole)) : "System"), width: 18 },
      { header: "Action", value: (r) => actionLabel(r.action), width: 16 },
      { header: "Record type", value: (r) => titleCase(r.entity), width: 16 },
      { header: "Record", value: (r) => r.ref ?? r.entityId ?? "", width: 18 },
      { header: "Summary", value: (r) => r.summary, width: 60 },
      { header: "Changes", value: (r) => (r.changes ?? []).map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`).join("; "), width: 60 },
      { header: "IP", value: (r) => r.ip ?? "", width: 16 },
    ],
  });
}
