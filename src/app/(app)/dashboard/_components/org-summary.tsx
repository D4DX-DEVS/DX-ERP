import type { CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { workCalendar } from "@/lib/domain/calendar";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { inrCompact, num, round2 } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { getPeriods, loadFinance, loadHeadcount, loadMonthlyOps, sumMonths } from "../_lib/queries";

interface SummaryRow {
  label: string;
  values: [string, string, string];
}

/** Which summary rows a user may see (each follows the permission of the data behind it). */
export function summaryAccess(user: CurrentUser) {
  return {
    attendance: can(user, "attendance.view_all"),
    movements: can(user, "movement.view_all"),
    tasks: can(user, "tasks.view_all"),
    finance: can(user, "invoices.view"),
  };
}

/** This month vs last month vs financial year to date (FRS §4.1 monthly and annual operational summaries). */
export async function OperationalSummaryCard({ user }: { user: CurrentUser }) {
  await connectDB();
  const access = summaryAccess(user);
  const settings = await getSettings();
  const p = getPeriods();
  const [ops, finance, headcount, cal] = await Promise.all([
    loadMonthlyOps({ attendance: access.attendance, movements: access.movements, tasks: access.tasks }),
    access.finance ? loadFinance() : null,
    access.attendance ? loadHeadcount() : null,
    access.attendance ? workCalendar(settings, p.prevFrom < p.fy.from ? p.prevFrom : p.fy.from, p.today) : null,
  ]);

  const windows: [string, string][] = [
    [p.month, p.month],
    [p.prevMonth, p.prevMonth],
    [p.fyStartMonth, p.month],
  ];
  const each = <T,>(pick: (from: string, to: string, index: number) => T): [T, T, T] => [pick(...windows[0], 0), pick(...windows[1], 1), pick(...windows[2], 2)];
  const rows: SummaryRow[] = [];

  if (access.attendance && cal && headcount) {
    const days: [string, string][] = [
      [p.monthFrom, p.today],
      [p.prevFrom, p.prevTo],
      [p.fy.from, p.today],
    ];
    rows.push({
      label: "Attendance rate",
      values: each((from, to, i) => {
        const expected = cal.workingDaysBetween(days[i][0], days[i][1]).length * headcount.total;
        return expected ? `${Math.round((sumMonths(ops.attendedDays, from, to) / expected) * 100)}%` : "—";
      }),
    });
    rows.push({ label: "Hours worked", values: each((from, to) => `${num(Math.round(sumMonths(ops.workMinutes, from, to) / 60))} h`) });
  }
  if (access.movements) rows.push({ label: "Movements", values: each((from, to) => num(sumMonths(ops.movements, from, to))) });
  if (access.tasks) rows.push({ label: "Tasks completed", values: each((from, to) => num(sumMonths(ops.tasksDone, from, to))) });
  if (access.finance && finance) {
    rows.push({
      label: "Invoices raised",
      values: each((from, to) => `${sumMonths(finance.invoiceCount, from, to)} · ${inrCompact(sumMonths(finance.invoiced, from, to))}`),
    });
    rows.push({ label: "Collections", values: each((from, to) => inrCompact(round2(sumMonths(finance.collected, from, to)))) });
    rows.push({ label: "Expenses", values: each((from, to) => inrCompact(round2(sumMonths(finance.expenses, from, to)))) });
  }

  if (rows.length === 0) return null;
  return (
    <Card className="h-full">
      <CardHeader title="Operational summary" subtitle="This month, last month and the financial year so far" href="/reports" hrefLabel="Reports" />
      <TableWrap phone={[1, 2, 3, 4]} tablet={[1, 2, 3, 4]}>
        <THead>
          <Th>Measure</Th>
          <Th align="right">{fmtDate(`${p.month}-01`, "MMMM yyyy")}</Th>
          <Th align="right">{fmtDate(`${p.prevMonth}-01`, "MMMM yyyy")}</Th>
          <Th align="right">{p.fy.label} to date</Th>
        </THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.label}>
              <Td className="font-medium text-ink-2">{r.label}</Td>
              {r.values.map((v, i) => (
                <Td key={i} align="right" className={i === 0 ? "font-semibold" : undefined}>
                  {v}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </TableWrap>
      {access.attendance && <p className="border-t border-line-soft px-5 py-3 text-xs text-muted">Attendance rate compares check-ins with working days × current headcount.</p>}
    </Card>
  );
}
