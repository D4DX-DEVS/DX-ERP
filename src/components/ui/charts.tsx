"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr, inrCompact, num } from "@/lib/format";
import { formatDuration } from "@/lib/time";

/**
 * Value formats for chart labels. Charts are Client Components, so Server Components pass a
 * format key (functions can't cross the server → client boundary).
 */
export type ChartFormat = "number" | "inr" | "inrCompact" | "hours" | "percent" | "minutes";

export function formatChartValue(v: number, format: ChartFormat = "number"): string {
  switch (format) {
    case "inr":
      return inr(v);
    case "inrCompact":
      return inrCompact(v);
    case "hours":
      return `${num(v)}h`;
    case "percent":
      return `${num(v)}%`;
    case "minutes":
      return formatDuration(v);
    default:
      return num(v);
  }
}

/** Validated categorical palette from the design (blue, orange, green), then neutrals. */
export const CHART_COLORS = ["#284CC7", "#D0691F", "#0E9F75", "#6D28D9", "#5B78E0", "#8A93B2"];

const axisStyle = { fontSize: 12, fill: "#5E6583" };

export function GroupedBarChart({
  data,
  series,
  height = 260,
  format = "number",
  stacked = false,
}: {
  data: Record<string, string | number>[];
  series: { key: string; label: string; color?: string }[];
  height?: number;
  format?: ChartFormat;
  stacked?: boolean;
}) {
  const valueFormatter = (v: number) => formatChartValue(v, format);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="#EEF1F7" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisStyle} />
        <YAxis tickLine={false} axisLine={false} tick={axisStyle} width={56} tickFormatter={(v: number) => valueFormatter(v)} />
        <Tooltip
          cursor={{ fill: "rgba(40,76,199,0.06)" }}
          contentStyle={{ borderRadius: 10, border: "1px solid #E2E6F0", boxShadow: "0 6px 20px rgba(16,24,58,0.10)", fontSize: 12 }}
          formatter={(value) => valueFormatter(Number(value))}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#3D4566" }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} radius={stacked ? 0 : [4, 4, 0, 0]} stackId={stacked ? "a" : undefined} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  height = 220,
  format = "number",
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  format?: ChartFormat;
}) {
  const valueFormatter = (v: number) => formatChartValue(v, format);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="95%" paddingAngle={data.length > 1 ? 2 : 0} stroke="none">
              {data.map((d, i) => (
                <Cell key={d.label} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => valueFormatter(Number(value))} contentStyle={{ borderRadius: 10, border: "1px solid #E2E6F0", fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-xl font-semibold text-ink tabular">{valueFormatter(total)}</span>
          <span className="text-xs text-muted">Total</span>
        </div>
      </div>
      <ul className="flex min-w-40 flex-1 flex-col gap-2">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-[13px]">
            <span className="size-2.5 rounded-full" style={{ background: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="flex-1 text-ink-2">{d.label}</span>
            <span className="font-semibold text-ink tabular">{valueFormatter(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Simple horizontal bars (funnel / workload / overdue-by-team). Server-safe markup, no recharts. */
export function HBarList({ rows, format = "number", color = "#284CC7" }: { rows: { label: string; value: number; hint?: string }[]; format?: ChartFormat; color?: string }) {
  const valueFormatter = (v: number) => formatChartValue(v, format);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate text-ink-2" title={r.hint ?? r.label}>
            {r.label}
          </span>
          <span className="h-2 rounded-full bg-track">
            <span className="block h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </span>
          <span className="font-semibold text-ink tabular">{valueFormatter(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
