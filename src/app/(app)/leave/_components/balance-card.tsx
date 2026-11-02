import Link from "next/link";
import type { LeaveBalanceRow } from "@/lib/domain/leave-balance";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/page";

/** Compact leave balances for one person (current leave year): available of total, used and pending. */
export function LeaveBalanceCard({ balances, title = "Leave balance", href = "/leave", linkLabel = "Apply / details →" }: { balances: LeaveBalanceRow[]; title?: string; href?: string | null; linkLabel?: string }) {
  return (
    <Card>
      <CardHeader
        title={title}
        action={
          href ? (
            <Link href={href} className="text-[13px] font-semibold text-brand-600 hover:underline">
              {linkLabel}
            </Link>
          ) : undefined
        }
      />
      <CardBody className="pb-4">
        {balances.length === 0 ? (
          <p className="text-[13px] text-muted">No leave types apply.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {balances.map((b) => {
              const total = b.accrued + b.carriedForward + b.adjustment;
              const usedPct = total > 0 ? ((b.used + b.pending) / total) * 100 : b.used ? 100 : 0;
              return (
                <li key={b.leaveTypeId} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 font-semibold break-words text-ink-2">{b.name}</span>
                    <span className="shrink-0 tabular text-ink">
                      {b.unlimited ? (
                        <>
                          {b.used} <span className="text-muted">used</span>
                        </>
                      ) : (
                        <>
                          <strong className="font-semibold">{b.available}</strong> <span className="text-muted">of {total} left</span>
                        </>
                      )}
                    </span>
                  </div>
                  {!b.unlimited && <Progress value={usedPct} tone={usedPct >= 100 ? "red" : "brand"} />}
                  {(b.used > 0 || b.pending > 0) && !b.unlimited && (
                    <span className="text-xs text-muted">
                      {b.used} used{b.pending > 0 ? ` · ${b.pending} pending` : ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
