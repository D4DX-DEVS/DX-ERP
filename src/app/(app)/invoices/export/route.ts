import { can, getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Invoice, Project } from "@/lib/models";
import { audit } from "@/lib/audit";
import { exportResponse, isExportFormat } from "@/lib/export";
import { todayKey } from "@/lib/time";
import { AGING_BUCKETS, clientNames, invoiceFilter, loadReceivables, type AgingKey } from "../data";
import { effectiveStatus } from "../totals";
import { statusLabel } from "@/lib/status";
import { hiddenClientIds, notHiddenClient } from "@/app/(app)/crm/_lib/access";

/** GET /invoices/export?type=invoices|receivables&format=csv|xlsx|pdf (+ the list filters). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "invoices.view")) return new Response("You don't have access to invoices.", { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!isExportFormat(format)) return new Response("Unsupported format", { status: 400 });
  const type = url.searchParams.get("type") === "receivables" ? "receivables" : "invoices";
  await connectDB();
  const today = todayKey();
  const hidden = await hiddenClientIds(user);

  if (type === "receivables") {
    const receivables = await loadReceivables(today, notHiddenClient(hidden));
    const names = await clientNames(receivables.map((r) => r.client));
    const byClient = new Map<string, { client: string; count: number; total: number; buckets: Record<AgingKey, number> }>();
    for (const r of receivables) {
      const row = byClient.get(r.client) ?? { client: r.client, count: 0, total: 0, buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 } };
      row.count += 1;
      row.total += r.balance;
      row.buckets[r.bucket] += r.balance;
      byClient.set(r.client, row);
    }
    const rows = [...byClient.values()].sort((a, b) => b.total - a.total);
    await audit(user, { action: "export", entity: "invoice", summary: `Exported receivables (${format.toUpperCase()}, ${rows.length} clients)` });
    return exportResponse({
      title: "Receivables by client",
      filename: "receivables",
      format,
      subtitle: `As of ${today}. Buckets are days past the due date.`,
      rows,
      columns: [
        { header: "Client", value: (r) => names.get(r.client)?.name ?? "Unknown client", width: 32 },
        { header: "Invoices", value: (r) => r.count, type: "number" },
        ...AGING_BUCKETS.map((b) => ({ header: b.label, value: (r: (typeof rows)[number]) => r.buckets[b.key], type: "money" as const })),
        { header: "Outstanding", value: (r) => r.total, type: "money" },
      ],
    });
  }

  const filter = invoiceFilter(Object.fromEntries(url.searchParams.entries()), today, hidden);
  const invoices = await Invoice.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
  const [names, projects] = await Promise.all([
    clientNames(invoices.map((i) => i.client.toString())),
    Project.find({ _id: { $in: invoices.flatMap((i) => (i.project ? [i.project] : [])) } }, { projectNo: 1 }).lean(),
  ]);
  const projectNo = new Map(projects.map((p) => [p._id.toString(), p.projectNo]));
  await audit(user, { action: "export", entity: "invoice", summary: `Exported invoices (${format.toUpperCase()}, ${invoices.length} records)` });
  return exportResponse({
    title: "Invoices",
    filename: "invoices",
    format,
    rows: invoices,
    columns: [
      { header: "Invoice no.", value: (i) => i.invoiceNo ?? "", width: 20 },
      { header: "Draft no.", value: (i) => i.draftNo, width: 14 },
      { header: "Status", value: (i) => statusLabel("invoice", effectiveStatus(i, today)) },
      { header: "Client", value: (i) => names.get(i.client.toString())?.name ?? "", width: 30 },
      { header: "Project", value: (i) => (i.project ? projectNo.get(i.project.toString()) ?? "" : "") },
      { header: "Issue date", value: (i) => (i.status === "draft" ? "" : i.issueDate) },
      { header: "Due date", value: (i) => (i.status === "draft" ? "" : i.dueDate) },
      { header: "Subtotal", value: (i) => i.subtotal, type: "money" },
      { header: "Discount", value: (i) => i.discount, type: "money" },
      { header: "Tax", value: (i) => i.taxTotal, type: "money" },
      { header: "Total", value: (i) => i.total, type: "money" },
      { header: "Received", value: (i) => i.amountPaid, type: "money" },
      { header: "Balance", value: (i) => (i.status === "cancelled" || i.status === "draft" ? 0 : i.balance), type: "money" },
    ],
  });
}
