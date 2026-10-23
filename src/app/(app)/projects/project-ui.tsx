import Link from "next/link";
import { AvatarStack } from "@/components/ui/avatar";
import { OptionChip } from "@/components/ui/chip";
import { Progress } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { StatusOption } from "@/lib/config-defaults";
import { TONE_CLASSES } from "@/lib/status";
import { addDays, diffDays, fmtDate, todayKey } from "@/lib/time";
import { HEALTH_LABEL, HEALTH_TONE, type Health } from "./health";
import type { ProjectRow } from "./rows";

export function HealthBadge({ health }: { health: Health }) {
  if (health === "na") return <span className="text-subtle">—</span>;
  const tone = TONE_CLASSES[HEALTH_TONE[health]];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap", tone.fg)}>
      <span className={cn("size-2 rounded-full", tone.dot)} aria-hidden />
      {HEALTH_LABEL[health]}
    </span>
  );
}

function progressTone(row: Pick<ProjectRow, "health" | "progress">) {
  return row.health === "late" ? "orange" : row.progress >= 100 ? "green" : "brand";
}

export function effortLabel(row: Pick<ProjectRow, "showEffort" | "loggedHours" | "estimatedHours">): string {
  if (!row.showEffort) return "—";
  const logged = Number.isInteger(row.loggedHours) ? String(row.loggedHours) : row.loggedHours.toFixed(1);
  if (row.estimatedHours > 0) return `${logged} / ${row.estimatedHours} h`;
  return row.loggedHours > 0 ? `${logged} h` : "—";
}

export function ProjectTable({ rows, statuses }: { rows: ProjectRow[]; statuses: StatusOption[] }) {
  return (
    <TableWrap phone={[1, 6]} tablet={[1, 2, 4, 6]}>
      <THead>
        <Th>Project</Th>
        <Th>Manager · team</Th>
        <Th>Timeline</Th>
        <Th className="w-[190px]">Progress</Th>
        <Th>Effort used</Th>
        <Th>Status</Th>
        <Th>Health</Th>
      </THead>
      <tbody>
        {rows.length === 0 && <EmptyRow colSpan={7}>No projects match these filters.</EmptyRow>}
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td className="max-w-[320px]">
              <Link href={`/projects/${r.id}`} className="block min-w-0 hover:text-brand-600">
                <span className="block truncate font-semibold">{r.title}</span>
                <span className="block truncate text-xs text-muted">
                  {r.projectNo}
                  {r.clientName ? ` · ${r.clientName}` : ""}
                </span>
              </Link>
            </Td>
            <Td>
              <div className="flex items-center gap-2">
                <span className="max-w-28 truncate text-[13px]">{r.manager?.name ?? "—"}</span>
                {r.team.length > 0 && <AvatarStack people={r.team} max={3} />}
              </div>
            </Td>
            <Td className="text-xs whitespace-nowrap text-ink-2">{r.timeline}</Td>
            <Td>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted" title={r.nextMilestone}>
                  {r.nextMilestone}
                </span>
                <strong className="tabular">{r.progress}%</strong>
              </div>
              <Progress value={r.progress} tone={progressTone(r)} />
            </Td>
            <Td className="text-xs whitespace-nowrap text-ink-2">{effortLabel(r)}</Td>
            <Td>
              <OptionChip options={statuses} value={r.status} />
            </Td>
            <Td>
              <HealthBadge health={r.health} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export interface ProjectColumn {
  status: StatusOption;
  rows: ProjectRow[];
  total: number;
}

export function ProjectBoard({ columns }: { columns: ProjectColumn[] }) {
  return (
    // Never scrolls sideways: status columns wrap into a grid.
    <div>
      <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">
        {columns.map((col) => (
          <section key={col.status.key} aria-label={col.status.label} className="flex min-w-0 flex-col gap-2 rounded-[14px] bg-[#ebeef5] p-2.5 sm:gap-2.5 sm:p-3">
            <div className="flex items-center gap-2 px-1 py-0.5">
              <span className={cn("size-2.5 rounded-full", TONE_CLASSES[col.status.tone].dot)} aria-hidden />
              <h2 className="font-sans text-sm font-semibold">{col.status.label}</h2>
              <span className="text-xs font-semibold text-muted tabular">{col.total}</span>
            </div>
            {col.rows.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted">No projects</p>}
            {col.rows.map((r) => (
              <Link key={r.id} href={`/projects/${r.id}`} className="flex flex-col gap-2.5 rounded-xl border border-line bg-white p-3 shadow-[0_1px_2px_rgba(16,24,58,0.04)] hover:border-brand-200">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-muted">{r.projectNo}</span>
                  <HealthBadge health={r.health} />
                </span>
                <span className="text-sm leading-snug font-semibold text-ink">{r.title}</span>
                {r.clientName && <span className="truncate text-xs text-muted">{r.clientName}</span>}
                <span>
                  <span className="mb-1 flex items-center justify-between text-xs">
                    <span className="truncate text-muted">{r.nextMilestone}</span>
                    <strong className="tabular">{r.progress}%</strong>
                  </span>
                  <Progress value={r.progress} tone={progressTone(r)} />
                </span>
                <span className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="truncate">{r.manager?.name ?? "No manager"}</span>
                  {r.team.length > 0 && <AvatarStack people={r.team} max={3} />}
                </span>
              </Link>
            ))}
            {col.total > col.rows.length && <p className="px-1 text-center text-xs text-muted">Showing {col.rows.length} of {col.total}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Simple Gantt: one bar per project from start to target, progress fill and a marker for today. */
export function ProjectTimeline({ rows, statuses }: { rows: ProjectRow[]; statuses: StatusOption[] }) {
  const scheduled = rows.filter((r) => r.startDate && r.targetDate && r.targetDate >= r.startDate);
  if (scheduled.length === 0) {
    return <p className="px-5 py-12 text-center text-sm text-muted">None of these projects has both a start and a target date yet.</p>;
  }
  const today = todayKey();
  const minStart = scheduled.reduce((m, r) => (r.startDate! < m ? r.startDate! : m), scheduled[0].startDate!);
  const maxEnd = scheduled.reduce((m, r) => (r.targetDate! > m ? r.targetDate! : m), scheduled[0].targetDate!);
  const rangeStart = addDays(minStart < today ? minStart : today, -7);
  const rangeEnd = addDays(maxEnd > today ? maxEnd : today, 7);
  const span = Math.max(1, diffDays(rangeStart, rangeEnd));
  const pos = (day: string) => Math.max(0, Math.min(100, (diffDays(rangeStart, day) / span) * 100));

  const months: { label: string; short: string; left: number }[] = [];
  for (let d = `${rangeStart.slice(0, 7)}-01`; d <= rangeEnd; ) {
    if (d >= rangeStart) months.push({ label: fmtDate(d, "MMM yyyy"), short: fmtDate(d, "MMM"), left: pos(d) });
    const [y, m] = d.split("-").map(Number);
    d = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  }
  const todayLeft = pos(today);

  return (
    <div className="relative overflow-x-clip">
      <div>
        <div className="grid grid-cols-[104px_minmax(0,1fr)] border-b border-line-soft bg-field text-xs font-semibold text-muted sm:grid-cols-[220px_minmax(0,1fr)]">
          <div className="px-3 py-2.5 sm:px-5">Project</div>
          <div className="relative h-9">
            {months.map((m) => (
              <span key={m.label} className="absolute top-2.5 border-l border-line pl-1 text-[10px] whitespace-nowrap sm:pl-1.5 sm:text-xs" style={{ left: `${m.left}%` }}>
                <span className="sm:hidden">{m.short}</span>
                <span className="max-sm:hidden">{m.label}</span>
              </span>
            ))}
          </div>
        </div>
        <ul>
          {scheduled.map((r) => {
            const tone = TONE_CLASSES[statuses.find((s) => s.key === r.status)?.tone ?? "blue"];
            const left = pos(r.startDate!);
            const width = Math.max(1.5, pos(r.targetDate!) - left);
            return (
              <li key={r.id} className="grid grid-cols-[104px_minmax(0,1fr)] items-center border-b border-line-soft last:border-b-0 sm:grid-cols-[220px_minmax(0,1fr)]">
                <Link href={`/projects/${r.id}`} className="block min-w-0 px-3 py-2.5 hover:text-brand-600 sm:px-5">
                  <span className="block truncate text-[13px] font-semibold">{r.title}</span>
                  <span className="block truncate text-xs text-muted">{r.projectNo}</span>
                </Link>
                <div className="relative h-11">
                  <span className="absolute inset-y-0 w-px bg-brand-500/60" style={{ left: `${todayLeft}%` }} aria-hidden />
                  <Link
                    href={`/projects/${r.id}`}
                    className={cn("absolute top-3 flex h-5 items-center overflow-hidden rounded-md", tone.bg)}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    aria-label={`${r.title}: ${r.timeline}, ${r.progress}% complete`}
                    title={`${r.timeline} · ${r.progress}%`}
                  >
                    <span className={cn("h-full", tone.dot, r.health === "late" && "bg-chart-2")} style={{ width: `${r.progress}%` }} />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="grid grid-cols-[104px_minmax(0,1fr)] border-t border-line-soft text-[11px] text-muted sm:grid-cols-[220px_minmax(0,1fr)] sm:text-xs">
          <div className="px-3 py-2 sm:px-5">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-px bg-brand-500" aria-hidden /> Today · {fmtDate(today, "d MMM")}
            </span>
          </div>
          <div className="py-2">Bar = start to target · filled part = progress</div>
        </div>
      </div>
    </div>
  );
}
