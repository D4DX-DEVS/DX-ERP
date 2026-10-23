import Link from "next/link";
import { addMonths, fmtDate } from "@/lib/time";
import { inr } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { GroupedBarChart } from "@/components/ui/charts";
import { getPeriods, loadFinance } from "../_lib/queries";
import { GlanceRow } from "./shared";

const SERIES = [
  { key: "invoiced", label: "Invoiced", color: "#284CC7" },
  { key: "collected", label: "Collected", color: "#0E9F75" },
  { key: "expenses", label: "Expenses", color: "#D0691F" },
];

/** Invoiced vs collected vs expenses for the last seven months (FRS §4.1, §16.4). */
export async function FinanceChartCard() {
  const finance = await loadFinance();
  const { month, fy } = getPeriods();
  const data = Array.from({ length: 7 }, (_, i) => {
    const m = addMonths(month, i - 6);
    return {
      label: fmtDate(`${m}-01`, "MMM"),
      invoiced: finance.invoiced.get(m) ?? 0,
      collected: finance.collected.get(m) ?? 0,
      expenses: finance.expenses.get(m) ?? 0,
    };
  });
  return (
    <Card className="h-full">
      <CardHeader title="Invoiced, collected and spent" subtitle={`${fy.label} · last 7 months, in rupees · ${fmtDate(`${month}-01`, "MMMM")} to date`} />
      <CardBody>
        <GroupedBarChart data={data} series={SERIES} format="inrCompact" height={248} />
      </CardBody>
    </Card>
  );
}

export async function MonthGlanceCard() {
  const finance = await loadFinance();
  const { month } = getPeriods();
  return (
    <Card className="h-full">
      <CardHeader title={`${fmtDate(`${month}-01`, "MMMM")} at a glance`} />
      <CardBody className="flex h-[calc(100%-4.5rem)] flex-col gap-3">
        <GlanceRow label="Invoiced" value={inr(finance.invoiced.get(month) ?? 0)} />
        <GlanceRow label="Payments received" value={inr(finance.collected.get(month) ?? 0)} />
        <GlanceRow
          label="Outstanding"
          sub={finance.overdueCount > 0 ? `${finance.overdueCount} overdue · ${inr(finance.overdueAmount)}` : undefined}
          value={inr(finance.outstanding)}
        />
        <GlanceRow label="Expenses recorded" value={inr(finance.expenses.get(month) ?? 0)} last />
        <Link href="/invoices/receivables" className="mt-auto text-[13px] font-semibold text-brand-600 hover:text-brand-800">
          Open receivables →
        </Link>
      </CardBody>
    </Card>
  );
}
