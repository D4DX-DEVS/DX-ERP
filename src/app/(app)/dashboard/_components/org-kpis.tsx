import { LogOut } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/session";
import { StatCard } from "@/components/ui/page";
import { Chip } from "@/components/ui/chip";
import { loadApprovalQueues, loadAttendanceToday, loadHeadcount, loadOpenMovements } from "../_lib/queries";

export async function HeadcountCard() {
  const h = await loadHeadcount();
  const parts = [
    { label: "employees", n: h.employees, color: "bg-chart-1" },
    { label: "trainees", n: h.trainees, color: "bg-chart-2" },
    { label: "interns", n: h.interns, color: "bg-chart-3" },
  ];
  return (
    <StatCard
      className="h-full"
      label="Headcount"
      value={h.total}
      href="/staff"
      sub={
        <div className="flex flex-col gap-2.5">
          <span className="flex h-2 gap-0.5 overflow-hidden rounded" role="img" aria-label={parts.map((p) => `${p.n} ${p.label}`).join(", ")}>
            {parts.filter((p) => p.n > 0).map((p) => (
              <span key={p.label} className={p.color} style={{ flex: p.n }} />
            ))}
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-ink-2">
            {parts.map((p) => (
              <span key={p.label} className="flex items-center gap-1.5">
                <span className={`size-2 rounded-[2px] ${p.color}`} />
                {p.n} {p.label}
              </span>
            ))}
          </span>
        </div>
      }
    />
  );
}

export async function PresentCard() {
  const a = await loadAttendanceToday();
  return (
    <StatCard
      className="h-full"
      label="Present today"
      href="/attendance/team"
      value={
        <>
          {a.present} <span className="text-base font-medium text-muted">/ {a.total}</span>
        </>
      }
      sub={
        a.workingDay ? (
          <span className="flex flex-wrap gap-1.5">
            <Chip tone="amber" size="sm" dot={false}>
              {a.late} late
            </Chip>
            <Chip tone={a.early ? "gray" : "red"} size="sm" dot={false}>
              {a.absent} {a.early ? "not in yet" : "absent"}
            </Chip>
            <Chip tone="blue" size="sm" dot={false}>
              {a.onLeave} on leave
            </Chip>
          </span>
        ) : (
          <Chip tone="gray" size="sm" dot={false}>
            {a.holiday ? `Holiday · ${a.holiday}` : "Weekend / non-working day"}
          </Chip>
        )
      }
    />
  );
}

export async function OutsideCard() {
  const m = await loadOpenMovements();
  const flagged = m.overdue + m.missing;
  return (
    <StatCard
      className="h-full"
      label="Outside office now"
      value={m.outside}
      href="/movement"
      icon={<LogOut className="size-4" />}
      tone={flagged > 0 ? "alert" : "default"}
      sub={
        flagged > 0 ? (
          <span className="font-semibold text-danger">
            {[m.overdue > 0 && `${m.overdue} overdue`, m.missing > 0 && `${m.missing} missing In-Time`].filter(Boolean).join(" · ")}
          </span>
        ) : m.outside === 0 ? (
          "Everyone is in the office"
        ) : (
          "All within expected return times"
        )
      }
    />
  );
}

export async function ApprovalsCard({ user }: { user: CurrentUser }) {
  const queues = await loadApprovalQueues(user);
  const total = queues.reduce((s, q) => s + q.count, 0);
  return (
    <StatCard
      className="h-full"
      label="Pending approvals"
      value={total}
      href="/notifications?tab=approvals"
      sub={total === 0 ? "Nothing is waiting for you" : queues.map((q) => `${q.label} ${q.count}`).join(" · ")}
    />
  );
}

