import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Download, Pencil } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Contract, Invoice, Payment, Project } from "@/lib/models";
import { inr, plural, round2 } from "@/lib/format";
import { fmtDate, fmtDateTime, diffDays, todayKey } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { isObjectId } from "@/lib/validation";
import { rupeesInWords } from "@/lib/payroll/words";
import { Alert, PageBody, PageHeader, Progress } from "@/components/ui/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClass, ButtonLink } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { canSeeClient } from "@/app/(app)/crm/_lib/access";
import { computeTotals, effectiveStatus } from "../totals";
import { AdjustmentDialog, CancelInvoiceButton, DeleteDraftButton, IssueInvoiceButton, RecordPaymentDialog, RefundDialog } from "../invoice-actions";

export const metadata = { title: "Invoice" };

function formatAddress(a?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }): string[] {
  if (!a) return [];
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.line1, a.line2, cityLine, a.country].filter((x): x is string => Boolean(x));
}

interface TimelineEvent {
  at: number;
  title: string;
  sub?: string;
  amount?: string;
  tone?: "green" | "red" | "purple";
}

const HISTORY_TITLES: Record<string, string> = { created: "Draft created", edited: "Draft edited", issued: "Issued", cancelled: "Cancelled" };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("invoices.view");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const inv = await Invoice.findById(id).lean();
  if (!inv) notFound();

  const [settings, client, project, contract, payments] = await Promise.all([
    getSettings(),
    Client.findById(inv.client, { name: 1, clientNo: 1, address: 1, gstin: 1, email: 1, confidential: 1, owner: 1 }).lean(),
    inv.project ? Project.findById(inv.project, { projectNo: 1, title: 1, milestones: 1 }).lean() : null,
    inv.contract && can(user, "contracts.view") ? Contract.findById(inv.contract, { contractNo: 1, title: 1 }).lean() : null,
    Payment.find({ invoice: inv._id }).sort({ createdAt: -1 }).lean(),
  ]);
  if (client && !canSeeClient(user, client)) forbidden();

  const today = todayKey();
  const status = effectiveStatus(inv, today);
  const manage = can(user, "invoices.manage");
  const money = can(user, "invoices.payments");
  const isDraft = inv.status === "draft";
  const cancelled = inv.status === "cancelled";
  const payable = ["issued", "partially_paid", "overdue"].includes(inv.status);
  const netPaid = round2(inv.amountPaid - inv.amountRefunded);
  const label = inv.invoiceNo ?? inv.draftNo;
  const totals = computeTotals(inv.items, inv.discount);
  const milestone = project?.milestones.find((m) => m._id.toString() === inv.milestone?.toString());

  const billing = inv.billingSnapshot
    ? { name: inv.billingSnapshot.name, lines: inv.billingSnapshot.address ? [inv.billingSnapshot.address] : [], gstin: inv.billingSnapshot.gstin, email: inv.billingSnapshot.email }
    : { name: client?.name ?? "Unknown client", lines: formatAddress(client?.address), gstin: client?.gstin, email: client?.email };

  const events: TimelineEvent[] = [
    ...payments.map<TimelineEvent>((p) => ({
      at: new Date(p.createdAt).getTime(),
      title: p.type === "payment" ? `Payment · ${p.method}` : p.type === "refund" ? `Refund · ${p.method}` : "Adjustment / write-off",
      sub: [fmtDate(p.date), p.reference ? `ref ${p.reference}` : undefined, p.note, p.paymentNo, p.recordedByName ? `by ${p.recordedByName}` : undefined].filter(Boolean).join(" · "),
      amount: `${p.type === "refund" ? "−" : ""}${inr(p.amount, true)}`,
      tone: p.type === "payment" ? "green" : p.type === "refund" ? "red" : "purple",
    })),
    ...inv.history.map<TimelineEvent>((h) => ({
      at: new Date(h.at).getTime(),
      title: `${HISTORY_TITLES[h.action] ?? h.action}${h.action === "issued" && h.note ? ` · ${h.note}` : ""}`,
      sub: [fmtDateTime(h.at), h.byName ? `by ${h.byName}` : undefined, h.action === "cancelled" ? h.note : undefined].filter(Boolean).join(" · "),
    })),
  ].sort((a, b) => b.at - a.at);

  const canRefund = money && netPaid > 0 && !isDraft && !cancelled;
  const canAdjust = money && payable;
  const canCancel = manage && !isDraft && !cancelled && netPaid <= 0;
  const canDelete = manage && isDraft;
  const overdueDays = status === "overdue" ? diffDays(inv.dueDate, today) : 0;

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/invoices", label: "Invoices" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[22px] sm:text-2xl">{label}</span>
            <StatusChip domain="invoice" value={status} />
          </span>
        }
        actions={
          <>
            <a href={`/api/pdf/invoice/${id}`} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
              <Download className="size-4" aria-hidden /> PDF
            </a>
            {manage && isDraft && (
              <ButtonLink variant="secondary" href={`/invoices/${id}/edit`} icon={<Pencil className="size-4" aria-hidden />}>
                Edit
              </ButtonLink>
            )}
            {manage && isDraft && <IssueInvoiceButton id={id} />}
            {money && payable && <RecordPaymentDialog id={id} balance={inv.balance} today={today} />}
          </>
        }
      />

      {isDraft && <Alert tone="info" title="Draft.">This invoice has not been issued yet. It gets its number and is locked when you issue it.</Alert>}
      {cancelled && (
        <Alert tone="danger" title="Cancelled.">
          {inv.cancelReason ? `Reason: ${inv.cancelReason}` : "This invoice was cancelled."}
          {inv.cancelledAt ? ` (${fmtDate(inv.cancelledAt)})` : ""}
        </Alert>
      )}
      {overdueDays > 0 && (
        <Alert tone="warning" title={`Overdue by ${plural(overdueDays, "day")}.`}>
          Balance due {inr(inv.balance, true)} since {fmtDate(inv.dueDate)}.
        </Alert>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <article className="flex min-w-0 flex-col gap-6 rounded-[14px] border border-line bg-white p-5 shadow-popover sm:p-8">
          <div className="flex flex-wrap justify-between gap-6">
            <div className="flex items-center gap-3.5">
              {settings.company.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.company.logo} alt="" className="h-14 w-auto object-contain" />
              )}
              <div className="text-xs leading-relaxed text-ink-2">
                <strong className="text-sm text-ink">{settings.company.legalName || settings.company.name}</strong>
                {settings.company.address && <div className="whitespace-pre-line">{settings.company.address}</div>}
                {settings.company.gstin && <div>GSTIN {settings.company.gstin}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="font-display text-[22px] font-bold tracking-[0.06em] text-brand-600">{isDraft ? "DRAFT INVOICE" : settings.company.gstin ? "TAX INVOICE" : "INVOICE"}</div>
              <div className="mt-1 text-xs leading-relaxed text-ink-2">
                {label}
                <br />
                {isDraft ? `Date ${fmtDate(inv.issueDate)}` : `Issued ${fmtDate(inv.issueDate)}`} · Due {fmtDate(inv.dueDate)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-6 border-y border-line-soft py-4">
            <div className="text-xs leading-relaxed text-ink-2">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">Bill to</div>
              <strong className="text-sm text-ink">{billing.name}</strong>
              {billing.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
              {billing.gstin && <div>GSTIN {billing.gstin}</div>}
              {billing.email && <div>{billing.email}</div>}
            </div>
            <div className="text-xs leading-relaxed text-ink-2 sm:text-right">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">Reference</div>
              {project && (
                <div>
                  Project{" "}
                  <Link href={`/projects/${project._id}`} className="font-medium text-brand-600 hover:text-brand-800">
                    {project.projectNo}
                  </Link>
                  {contract ? ` · Contract ${contract.contractNo}` : ""}
                </div>
              )}
              {!project && contract && <div>Contract {contract.contractNo}</div>}
              {milestone && <div>Milestone: {milestone.title}</div>}
              {inv.placeOfSupply && <div>Place of supply: {inv.placeOfSupply}</div>}
              {!project && !contract && !inv.placeOfSupply && <div>—</div>}
            </div>
          </div>

          <div className="relative overflow-x-clip">
            {/* Fits any width: Rate and Tax are hidden on phones (the amount already includes them). */}
            <table className="w-full border-collapse text-xs sm:text-[13px] [&_tr>*:nth-child(3)]:max-sm:hidden [&_tr>*:nth-child(4)]:max-sm:hidden">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                  <th className="py-2 pr-2">Description</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Rate</th>
                  <th className="px-2 py-2 text-right">Tax</th>
                  <th className="py-2 pl-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((i, idx) => (
                  <tr key={idx} className="border-b border-line-soft align-top">
                    <td className="py-3 pr-2 break-words whitespace-pre-line">{i.description}</td>
                    <td className="px-2 py-3 text-right tabular">{i.quantity}</td>
                    <td className="px-2 py-3 text-right tabular">{inr(i.rate, true)}</td>
                    <td className="px-2 py-3 text-right tabular">{i.taxRate ? `${i.taxRate}%` : "—"}</td>
                    <td className="py-3 pl-2 text-right tabular">{inr(i.amount, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <dl className="flex w-full max-w-[320px] flex-col gap-1.5 text-[13px]">
              <Row label="Subtotal" value={inr(inv.subtotal, true)} />
              {inv.discount > 0 && <Row label="Discount" value={`−${inr(inv.discount, true)}`} />}
              {totals.taxByRate.map((t) => (
                <Row key={t.rate} label={`Tax @ ${t.rate}%`} value={inr(t.amount, true)} />
              ))}
              <div className="mt-1 flex justify-between border-t border-line pt-2 text-[15px] font-bold">
                <dt>Total</dt>
                <dd className="tabular">{inr(inv.total, true)}</dd>
              </div>
              <div className="text-right text-[11px] text-muted">{rupeesInWords(inv.total)}</div>
              {!isDraft && !cancelled && (
                <>
                  <Row label="Received" value={inr(inv.amountPaid, true)} tone="text-success" />
                  {inv.amountRefunded > 0 && <Row label="Refunded" value={`−${inr(inv.amountRefunded, true)}`} />}
                  {inv.adjustments > 0 && <Row label="Adjustments" value={`−${inr(inv.adjustments, true)}`} />}
                  <div className="flex justify-between border-t border-line-soft pt-2 text-sm font-bold">
                    <dt>Balance due</dt>
                    <dd className="tabular">{inr(inv.balance, true)}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>

          {settings.documents.bankDetails && (
            <div className="border-t border-line-soft pt-4 text-xs leading-relaxed text-muted">
              <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] uppercase">Bank details</div>
              <div className="whitespace-pre-line">{settings.documents.bankDetails}</div>
            </div>
          )}
          {(inv.notes || inv.terms) && (
            <div className="grid gap-4 border-t border-line-soft pt-4 text-xs leading-relaxed text-muted sm:grid-cols-2">
              {inv.notes && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] uppercase">Notes</div>
                  <div className="whitespace-pre-line">{inv.notes}</div>
                </div>
              )}
              {inv.terms && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] uppercase">Terms</div>
                  <div className="whitespace-pre-line">{inv.terms}</div>
                </div>
              )}
            </div>
          )}
        </article>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardBody className="flex flex-col gap-3 pt-5">
              <div className="flex justify-between text-[13px]">
                <span className="text-muted">Invoice total</span>
                <strong className="tabular">{inr(inv.total, true)}</strong>
              </div>
              {!isDraft && !cancelled && (
                <>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-muted">Received (net of refunds)</span>
                    <strong className="text-success tabular">{inr(netPaid, true)}</strong>
                  </div>
                  <Progress value={inv.total > 0 ? ((netPaid + inv.adjustments) / inv.total) * 100 : 0} tone="green" />
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] text-muted">Balance due</span>
                    <span className="font-display text-[22px] font-semibold tabular">{inr(inv.balance, true)}</span>
                  </div>
                  {inv.dueDate && <div className="text-xs text-muted">Due {fmtDate(inv.dueDate)}</div>}
                </>
              )}
              {(isDraft || cancelled) && <div className="text-xs text-muted">{isDraft ? "Totals are final once issued." : "No balance — invoice cancelled."}</div>}
            </CardBody>
          </Card>

          {(canRefund || canAdjust || canCancel || canDelete) && (
            <Card>
              <CardHeader title="More actions" />
              <CardBody className="flex flex-wrap gap-2">
                {canRefund && <RefundDialog id={id} maxAmount={netPaid} today={today} />}
                {canAdjust && <AdjustmentDialog id={id} balance={inv.balance} today={today} />}
                {canCancel && <CancelInvoiceButton id={id} />}
                {canDelete && <DeleteDraftButton id={id} />}
              </CardBody>
            </Card>
          )}
          {manage && !isDraft && !cancelled && netPaid > 0 && <p className="px-1 text-xs text-muted">To cancel this invoice, refund the {inr(netPaid, true)} received first.</p>}

          <Card>
            <CardHeader title="History" />
            <CardBody className="flex flex-col">
              {events.length === 0 && <p className="text-[13px] text-muted">Nothing recorded yet.</p>}
              {events.map((e, i) => (
                <div key={i} className="flex items-start justify-between gap-3 border-t border-line-soft py-2.5 text-[13px] first:border-t-0">
                  <span className="min-w-0">
                    <strong className="block font-semibold text-ink">{e.title}</strong>
                    {e.sub && <span className="block text-xs break-words text-muted">{e.sub}</span>}
                  </span>
                  {e.amount && <strong className={cn("shrink-0 tabular", e.tone === "green" && "text-success", e.tone === "red" && "text-danger", e.tone === "purple" && "text-tone-purple")}>{e.amount}</strong>}
                </div>
              ))}
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("tabular", tone)}>{value}</dd>
    </div>
  );
}
