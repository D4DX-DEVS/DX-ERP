import type { ProposalContent } from "@/lib/models/sales";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { inr, num } from "@/lib/format";
import { fmtDate } from "@/lib/time";

// Same palette as the design's chart colours (not imported from the client-only charts module).
const CHART_COLORS = ["#284CC7", "#5B78E0", "#0E9F75", "#D0691F", "#6D28D9", "#8A93B2"];

/** Read-only rendering of proposal content (the current version or any stored snapshot). */
export function ProposalDocument({ content }: { content: ProposalContent }) {
  const hasTax = content.items.some((i) => i.taxRate > 0);
  const hasDiscount = content.discount > 0;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader title="Scope & deliverables" />
        <CardBody className="flex flex-col gap-4">
          {content.summary && <p className="text-sm leading-relaxed whitespace-pre-line text-ink-2">{content.summary}</p>}
          {content.scope && (
            <div>
              <h3 className="font-sans text-xs font-semibold text-muted">Scope</h3>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink-2">{content.scope}</p>
            </div>
          )}
          {content.deliverables.length > 0 && (
            <div>
              <h3 className="font-sans text-xs font-semibold text-muted">Deliverables</h3>
              <ol className="mt-2 flex flex-col gap-2">
                {content.deliverables.map((d, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-[10px] border border-line-soft px-3 py-2.5">
                    <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-brand-50 text-xs font-bold text-brand-600">{i + 1}</span>
                    <span className="text-sm text-ink">{d}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {(content.timeline || content.startDate || content.endDate) && (
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              {content.timeline && (
                <div>
                  <div className="text-xs font-medium text-muted">Timeline</div>
                  <div className="mt-0.5 text-ink">{content.timeline}</div>
                </div>
              )}
              {content.startDate && (
                <div>
                  <div className="text-xs font-medium text-muted">Start</div>
                  <div className="mt-0.5 text-ink">{fmtDate(content.startDate)}</div>
                </div>
              )}
              {content.endDate && (
                <div>
                  <div className="text-xs font-medium text-muted">End</div>
                  <div className="mt-0.5 text-ink">{fmtDate(content.endDate)}</div>
                </div>
              )}
            </div>
          )}
          {!content.summary && !content.scope && content.deliverables.length === 0 && !content.timeline && <p className="text-[13px] text-muted">No scope has been written yet.</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Costing" />
        <TableWrap phone={[1, 2, "last"]} tablet={[1, 2, 3, 4, 5]}>
          <THead>
            <Th>Item</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Rate</Th>
            {hasTax && <Th align="right">Tax</Th>}
            <Th align="right">Amount</Th>
          </THead>
          <tbody>
            {content.items.map((i, idx) => (
              <Tr key={idx}>
                <Td>{i.description}</Td>
                <Td align="right">{num(i.quantity)}</Td>
                <Td align="right">{inr(i.rate, true)}</Td>
                {hasTax && <Td align="right">{i.taxRate}%</Td>}
                <Td align="right" className="font-semibold">
                  {inr(i.amount, true)}
                </Td>
              </Tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={hasTax ? 4 : 3} className="px-3 py-2 text-right text-muted">
                Subtotal
              </td>
              <td className="px-3 py-2 pr-5 text-right tabular">{inr(content.subtotal, true)}</td>
            </tr>
            {hasDiscount && (
              <tr>
                <td colSpan={hasTax ? 4 : 3} className="px-3 py-1 text-right text-muted">
                  Discount
                </td>
                <td className="px-3 py-1 pr-5 text-right text-success tabular">− {inr(content.discount, true)}</td>
              </tr>
            )}
            {content.taxTotal > 0 && (
              <tr>
                <td colSpan={hasTax ? 4 : 3} className="px-3 py-1 text-right text-muted">
                  Tax
                </td>
                <td className="px-3 py-1 pr-5 text-right tabular">{inr(content.taxTotal, true)}</td>
              </tr>
            )}
            <tr className="bg-brand-50">
              <td colSpan={hasTax ? 4 : 3} className="px-3 py-3 text-right font-bold text-ink">
                Total
              </td>
              <td className="px-3 py-3 pr-5 text-right font-display text-lg font-semibold text-ink tabular">{inr(content.total, true)}</td>
            </tr>
          </tfoot>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title="Payment milestones & terms" />
        <CardBody className="flex flex-col gap-4">
          {content.paymentMilestones.length > 0 ? (
            <>
              <div className="flex h-3 gap-0.5" role="img" aria-label={`Payment split ${content.paymentMilestones.map((m) => `${m.percent}%`).join(" / ")}`}>
                {content.paymentMilestones.map((m, i) => (
                  <span key={i} className="first:rounded-l last:rounded-r" style={{ flex: Math.max(m.percent, 0.5), background: CHART_COLORS[i % CHART_COLORS.length] }} />
                ))}
              </div>
              <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {content.paymentMilestones.map((m, i) => (
                  <li key={i} className="rounded-[10px] border border-line-soft p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <span className="size-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
                      {m.percent}% · {m.title}
                    </div>
                    <div className="mt-0.5 text-[15px] font-semibold text-ink tabular">{inr(m.amount, true)}</div>
                    {m.dueOn && <div className="text-xs text-muted">Due {fmtDate(m.dueOn)}</div>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[13px] text-muted">No payment milestones — the full amount is billed as agreed.</p>
          )}
          {content.terms && <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{content.terms}</p>}
          {content.validUntil && <p className="text-[13px] font-semibold text-ink">Valid until {fmtDate(content.validUntil)}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
