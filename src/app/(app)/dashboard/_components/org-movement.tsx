import Link from "next/link";
import { CalendarDays, CheckCircle2, ChevronRight, Clock, UserCog, Wallet, Banknote, LogOut, type LucideIcon } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/session";
import type { Tone } from "@/lib/config-defaults";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { PersonCell } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { fmtTime, timeAgo } from "@/lib/time";
import { getPeriods, loadApprovalQueues, loadOpenMovements, type OpenMovementState, type QueueKey } from "../_lib/queries";
import { dayTime, IconBadge, ListRow } from "./shared";

const STATE: Record<OpenMovementState, { label: string; tone: Tone }> = {
  out: { label: "Out", tone: "orange" },
  overdue: { label: "Overdue", tone: "red" },
  missing_in: { label: "Missing In-Time", tone: "purple" },
};

const SHOWN = 8;

/** Who is outside the office right now. Personal movements show only "Personal" unless the viewer may see details. */
export async function OutOfOfficeCard({ showPersonal }: { showPersonal: boolean }) {
  const m = await loadOpenMovements();
  const { today } = getPeriods();
  const rows = m.rows.slice(0, SHOWN);
  return (
    <Card className="h-full">
      <CardHeader title="Out of office now" subtitle={m.rows.length > 0 ? `${m.rows.length} open movement${m.rows.length === 1 ? "" : "s"}` : undefined} href="/movement" hrefLabel="Movement register" />
      <TableWrap phone={[1, 3, 5]} tablet={[1, 2, 3, 4, 5]}>
        <THead>
          <Th>Person</Th>
          <Th>Purpose</Th>
          <Th>Out</Th>
          <Th>Expected</Th>
          <Th>Status</Th>
        </THead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5}>No one is out of the office right now.</EmptyRow>
          ) : (
            rows.map((r) => {
              const person = m.people.get(r.personId);
              const visible = r.official || showPersonal;
              const state = STATE[r.state];
              return (
                <Tr key={r.id}>
                  <Td>
                    <PersonCell name={person?.name ?? "Unknown"} sub={person?.designation} href={`/movement/${r.id}`} />
                  </Td>
                  <Td className="max-w-56">
                    <div className="truncate">{visible ? r.purpose : "Personal"}</div>
                    {visible && r.destination && <div className="truncate text-xs text-muted">{r.destination}</div>}
                  </Td>
                  <Td className="whitespace-nowrap">{dayTime(r.outTime, today)}</Td>
                  <Td className="whitespace-nowrap">{r.expectedReturn ? fmtTime(r.expectedReturn) : "—"}</Td>
                  <Td>
                    <Chip tone={state.tone}>{state.label}</Chip>
                  </Td>
                </Tr>
              );
            })
          )}
        </tbody>
      </TableWrap>
      {m.rows.length > SHOWN && (
        <div className="border-t border-line-soft px-5 py-2.5 text-[13px]">
          <Link href="/movement" className="font-semibold text-brand-600 hover:text-brand-800">
            +{m.rows.length - SHOWN} more in the register →
          </Link>
        </div>
      )}
    </Card>
  );
}

const QUEUE_STYLE: Record<QueueKey, { icon: LucideIcon; tone: Tone }> = {
  leave: { icon: CalendarDays, tone: "blue" },
  movement: { icon: LogOut, tone: "orange" },
  attendance: { icon: UserCog, tone: "amber" },
  expenses: { icon: Wallet, tone: "green" },
  timesheets: { icon: Clock, tone: "purple" },
  payroll: { icon: Banknote, tone: "green" },
};

/** Each approval queue the viewer can act on, with the oldest waiting item. */
export async function WaitingCard({ user }: { user: CurrentUser }) {
  const queues = await loadApprovalQueues(user);
  return (
    <Card className="h-full">
      <CardHeader title="Waiting for you" subtitle={queues.length ? "Approvals you can act on" : undefined} href="/notifications?tab=approvals" hrefLabel="All approvals" />
      {queues.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-5" />} title="You're all caught up" description="Leave, movement, expense and other approvals will appear here." className="py-8" />
      ) : (
        <div>
          {queues.map((q) => {
            const style = QUEUE_STYLE[q.key];
            const Icon = style.icon;
            return (
              <ListRow
                key={q.key}
                href={q.href}
                icon={
                  <IconBadge tone={style.tone}>
                    <Icon className="size-4" aria-hidden />
                  </IconBadge>
                }
                title={`${q.count} ${q.singular}${q.count === 1 ? "" : "s"}`}
                meta={q.oldest ? `Oldest${q.oldest.who ? `: ${q.oldest.who}` : ""} · ${timeAgo(q.oldest.at)}` : q.label}
                trailing={<ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}

