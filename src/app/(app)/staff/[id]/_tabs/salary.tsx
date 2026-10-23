import { Lock } from "lucide-react";
import { can } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { inr } from "@/lib/format";
import { User } from "@/lib/models";
import { fmtDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tag } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/page";
import { EmptyRow, Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import { ReviseSalaryButton, ReviseStipendButton } from "../../_components/salary-dialogs";
import { STIPEND_PERIODS, salaryTotals } from "../../_lib/constants";
import type { TabProps } from "./types";

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 text-[13px] ${strong ? "border-t border-line-soft pt-2.5 text-sm font-semibold text-ink" : muted ? "text-muted" : "text-ink"}`}>
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

/** Salary structure + revision history (and stipend for interns). Only rendered for staff.confidential. */
export async function SalaryTab({ user, person, access, today }: TabProps) {
  await connectDB();
  const data = await User.findById(person._id, { salary: 1, salaryHistory: 1, "internship.stipend": 1, "internship.stipendHistory": 1 }).lean();
  const salary = data?.salary;
  const history = [...(data?.salaryHistory ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const stipend = data?.internship?.stipend;
  const stipendHistory = [...(data?.internship?.stipendHistory ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const canRevise = can(user, "staff.edit");
  const canReviseStipend = canRevise || can(user, "interns.manage");
  const id = person._id.toString();
  const totals = salary ? salaryTotals(salary) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader
            title="Salary & allowances"
            action={
              <Tag tone="gray" className="gap-1 bg-navy text-white">
                <Lock className="size-3" /> Restricted
              </Tag>
            }
          />
          <CardBody className="flex flex-col gap-2.5">
            {salary && totals ? (
              <>
                <Line label="Basic" value={inr(salary.basic)} />
                {salary.allowances.map((l, i) => (
                  <Line key={`a${i}`} label={l.name} value={inr(l.amount)} />
                ))}
                <Line label="Gross / month" value={inr(totals.gross)} strong />
                {salary.deductions.map((l, i) => (
                  <Line key={`d${i}`} label={`− ${l.name}`} value={inr(l.amount)} muted />
                ))}
                {salary.deductions.length > 0 && <Line label="Net / month" value={inr(totals.net)} strong />}
                <p className="text-xs text-muted">{salary.effectiveFrom ? `Effective from ${fmtDate(salary.effectiveFrom)}` : "Current structure"} · visible to HR, Finance and Management</p>
              </>
            ) : (
              <EmptyState title="No salary structure recorded" description={access.internLike ? "Interns and trainees are paid a stipend — see below." : "Add one to include this person in payroll runs."} className="py-6" />
            )}
            {canRevise && (
              <div className="pt-1">
                <ReviseSalaryButton userId={id} salary={salary ? { basic: salary.basic, allowances: salary.allowances, deductions: salary.deductions } : undefined} today={today} />
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Salary revision history" />
          <TableWrap phone={[1, 4]} tablet={[1, 2, 3, 4, 6]}>
            <THead>
              <Th>Effective</Th>
              <Th align="right">Basic</Th>
              <Th align="right">Gross</Th>
              <Th align="right">Net</Th>
              <Th>Note</Th>
              <Th>Revised by</Th>
            </THead>
            <tbody>
              {history.length === 0 && <EmptyRow colSpan={6}>No revisions recorded.</EmptyRow>}
              {history.map((h, i) => {
                const t = salaryTotals(h);
                return (
                  <Tr key={h._id?.toString() ?? i}>
                    <Td className="whitespace-nowrap">{fmtDate(h.effectiveFrom ?? h.at)}</Td>
                    <Td align="right">{inr(h.basic)}</Td>
                    <Td align="right">{inr(t.gross)}</Td>
                    <Td align="right">{inr(t.net)}</Td>
                    <Td className="text-ink-2">{h.note ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-ink-2">
                      {h.byName ?? "—"} <span className="text-xs text-muted">· {fmtDate(h.at)}</span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      {access.internLike && stipend && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader
              title="Stipend"
              action={
                <Tag tone="gray" className="gap-1 bg-navy text-white">
                  <Lock className="size-3" /> Restricted
                </Tag>
              }
            />
            <CardBody className="flex flex-col gap-2.5">
              <Line label="Eligible" value={stipend.eligible ? "Yes" : "No"} />
              <Line label="Amount" value={stipend.eligible ? inr(stipend.amount) : "—"} strong />
              <Line label="Period" value={STIPEND_PERIODS.find((p) => p.value === stipend.period)?.label ?? stipend.period} />
              {canReviseStipend && (
                <div className="pt-1">
                  <ReviseStipendButton userId={id} stipend={{ eligible: stipend.eligible, amount: stipend.amount, period: stipend.period }} today={today} />
                </div>
              )}
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Stipend revision history" />
            <TableWrap phone={[1, 2]} tablet={[1, 2, 3, 4]}>
              <THead>
                <Th>Effective</Th>
                <Th align="right">Amount</Th>
                <Th>Note</Th>
                <Th>Recorded</Th>
              </THead>
              <tbody>
                {stipendHistory.length === 0 && <EmptyRow colSpan={4}>No stipend revisions recorded.</EmptyRow>}
                {stipendHistory.map((h, i) => (
                  <Tr key={h._id?.toString() ?? i}>
                    <Td className="whitespace-nowrap">{fmtDate(h.effectiveFrom ?? h.at)}</Td>
                    <Td align="right">{inr(h.amount)}</Td>
                    <Td className="text-ink-2">{h.note ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{fmtDate(h.at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      )}
    </div>
  );
}
