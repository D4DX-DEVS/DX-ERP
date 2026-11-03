import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, lte, ne, type SQL } from "drizzle-orm";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { Pagination, SortSelect } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader, Progress } from "@/components/ui/page";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { AttachmentList } from "@/components/ui/file-upload";
import { isStaff, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { leaveBalances, leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { CompOffClaim, Holiday, LeaveRequest, LeaveType } from "@/lib/models";
import { namesFor } from "@/lib/people";
import { plain } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";
import { inList, jsonHas } from "@/lib/sql";
import { pageParam, PAGE_SIZE, param, sortParam, type SearchParams, type SortChoices } from "@/lib/query";
import { addDays, fmtDate, formatDuration, timeAgo, todayKey, weekday } from "@/lib/time";
import { cancelLeave } from "./actions";
import { ApplyLeaveForm } from "./apply-form";
import { withdrawCompOff } from "./comp-off-actions";
import { CompOffClaimDialog } from "./_components/comp-off-claim";
import { LeaveTabs } from "./_components/tabs";
import { leaveAccess } from "./_lib/access";
import { daysLabel, leaveRangeLabel } from "./_lib/format";

export const metadata = { title: "My leave" };

const SORTS = {
  newest: { label: "Newest first", order: [desc(LeaveRequest.createdAt)] },
  oldest: { label: "Oldest first", order: [asc(LeaveRequest.createdAt)] },
  start: { label: "Leave start (latest)", order: [desc(LeaveRequest.startDate), desc(LeaveRequest.createdAt)] },
  startOldest: { label: "Leave start (earliest)", order: [asc(LeaveRequest.startDate), asc(LeaveRequest.createdAt)] },
  days: { label: "Days (most)", order: [desc(LeaveRequest.days), desc(LeaveRequest.createdAt)] },
  updated: { label: "Recently updated", order: [desc(LeaveRequest.updatedAt)] },
} satisfies SortChoices<SQL[]>;

export default async function MyLeavePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  if (!isStaff(user)) redirect("/leave/approvals");
  const settings = await getSettings();
  const access = await leaveAccess(user);
  const today = todayKey();
  const year = leaveYearOf(today, settings);
  const range = leaveYearRange(year, settings);
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);
  const mine = eq(LeaveRequest.user, user._id);

  const [balances, types, requests, requestTotal, busy, holidays, pendingForMe, claims] = await Promise.all([
    leaveBalances(user._id, user.personType, year, settings, today),
    db()
      .select()
      .from(LeaveType)
      .where(and(eq(LeaveType.active, true), jsonHas(LeaveType.applicableTo, user.personType))),
    db().select().from(LeaveRequest).where(mine).orderBy(...sort.order).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().$count(LeaveRequest, mine),
    // Live requests the date picker warns about overlapping, independent of the page shown below.
    db()
      .select({ start: LeaveRequest.startDate, end: LeaveRequest.endDate, status: LeaveRequest.status })
      .from(LeaveRequest)
      .where(and(mine, inList(LeaveRequest.status, ["pending_manager", "pending_hr", "approved"]), gte(LeaveRequest.endDate, addDays(today, -60)))),
    db()
      .select({ date: Holiday.date, name: Holiday.name, optional: Holiday.optional })
      .from(Holiday)
      .where(and(gte(Holiday.date, addDays(today, -60)), lte(Holiday.date, addDays(today, 430))))
      .orderBy(asc(Holiday.date)),
    access.canOpenApprovals
      ? db().$count(
          LeaveRequest,
          access.approve
            ? and(inList(LeaveRequest.status, ["pending_manager", "pending_hr"]), ne(LeaveRequest.user, user._id))
            : and(eq(LeaveRequest.status, "pending_manager"), eq(LeaveRequest.manager, user._id)),
        )
      : Promise.resolve(0),
    db().select().from(CompOffClaim).where(eq(CompOffClaim.user, user._id)).orderBy(desc(CompOffClaim.createdAt)).limit(8),
  ]);
  const typeById = new Map(types.map((t) => [t._id, t]));
  const names = await namesFor([user.reportingManagerId, ...requests.map((r) => r.manager)]);
  const managerName = user.reportingManagerId ? names.get(user.reportingManagerId) : undefined;

  const options = balances.map((b) => {
    const t = typeById.get(b.leaveTypeId);
    return { id: b.leaveTypeId, name: b.name, kind: b.kind, allowHalfDay: t?.allowHalfDay ?? false, unlimited: b.unlimited, available: b.available, requiresAttachmentAfterDays: t?.requiresAttachmentAfterDays ?? undefined };
  });
  const upcoming = holidays.filter((h) => h.date >= today).slice(0, 6);
  // Optional holidays that can still be taken: today or later, on a working day, not already requested.
  const optionalDates = holidays
    .filter((h) => h.optional && h.date >= today && settings.attendance.workingDays.includes(weekday(h.date)) && !busy.some((b) => b.start <= h.date && b.end >= h.date))
    .map((h) => ({ date: h.date, name: h.name }));
  const optionalType = balances.find((b) => b.kind === "optional_holiday" && b.available > 0);
  const takeDate = param(sp, "oh");
  const initial = optionalType && optionalDates.some((h) => h.date === takeDate) ? { typeId: optionalType.leaveTypeId, date: takeDate } : undefined;
  const compOff = balances.find((b) => b.kind === "comp_off");
  const approvalNote = managerName ? `Approval: ${managerName} → HR only when the leave type requires it` : "Your request goes to HR for approval.";

  return (
    <PageBody>
      <PageHeader
        overline={`Time · leave year ${fmtDate(range.from, "MMM yyyy")} – ${fmtDate(range.to, "MMM yyyy")}`}
        title="My leave"
        actions={
          <ButtonLink href="#apply">Apply for leave</ButtonLink>
        }
      />
      <LeaveTabs active="me" access={access} pending={pendingForMe} />

      {balances.length === 0 ? (
        <Card>
          <EmptyState title="No leave types are set up for you" description="Ask HR to configure leave types for your role." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {balances.map((b) => {
            const total = b.accrued + b.carriedForward + b.adjustment;
            const t = typeById.get(b.leaveTypeId);
            const usedPct = total > 0 ? ((b.used + b.pending) / total) * 100 : b.used ? 100 : 0;
            const notes = [
              b.pending > 0 && `${b.pending} pending`,
              b.carriedForward > 0 && `${b.carriedForward} carried forward`,
              b.kind === "standard" && t?.accrual === "monthly" && `Accrues monthly · ${b.accrued} of ${b.quota} so far`,
              b.prorated && `Pro-rated from ${b.annualQuota}/year for the months you're employed`,
              b.kind === "comp_off" && `${b.accrued} earned from comp-off claims`,
              b.kind === "optional_holiday" && "Only on optional holidays",
              t?.carryForward && t.maxCarryForward > 0 ? `Carry forward up to ${t.maxCarryForward}` : !b.unlimited && `Resets ${fmtDate(addDays(range.to, 1), "d MMM yyyy")}`,
              b.unlimited && "Not balance-limited",
              t?.requiresAttachmentAfterDays != null && `Document needed after ${t.requiresAttachmentAfterDays} days`,
            ].filter(Boolean) as string[];
            return (
              <div key={b.leaveTypeId} className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-line bg-white p-4">
                <span className="text-[13px] font-semibold text-ink-2">{b.name}</span>
                <span className="font-display text-[26px] leading-none font-semibold tabular">
                  {b.unlimited ? b.used : b.available}
                  <span className="ml-1 text-[13px] font-medium text-muted">{b.unlimited ? "used" : `of ${total}`}</span>
                </span>
                <Progress value={usedPct} tone={usedPct >= 100 ? "red" : "brand"} />
                <span className="text-xs text-muted">{notes.length ? notes.join(" · ") : `${b.used} used`}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card id="apply" className="scroll-mt-20 lg:col-span-2">
          <CardHeader title="Apply for leave" />
          <CardBody>
            {options.length === 0 ? (
              <p className="text-sm text-muted">No leave types are available to apply for.</p>
            ) : (
              <ApplyLeaveForm
                types={options}
                workingDays={settings.attendance.workingDays}
                holidays={holidays.filter((h) => !h.optional).map((h) => h.date)}
                countWeekends={settings.leave.countWeekendsInLeave}
                allowNegative={settings.leave.allowNegativeBalance}
                busy={busy}
                approvalNote={approvalNote}
                optionalHolidays={optionalType ? optionalDates : []}
                initial={initial}
              />
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Upcoming holidays" />
            <CardBody className="pb-3">
              {upcoming.length === 0 ? (
                <p className="text-[13px] text-muted">No upcoming holidays are listed. HR maintains the holiday list in Configuration.</p>
              ) : (
                <ul>
                  {upcoming.map((h) => (
                    <li key={h.date} className="flex items-center justify-between gap-3 border-t border-line-soft py-2 text-[13px] first:border-t-0 first:pt-0">
                      <span className="flex flex-wrap items-center gap-2">
                        {h.name}
                        {h.optional && <Tag>Optional</Tag>}
                        {h.optional && optionalType && optionalDates.some((o) => o.date === h.date) && (
                          <Link href={`/leave?oh=${h.date}#apply`} className="text-xs font-semibold text-brand-600 hover:underline">
                            Take it
                          </Link>
                        )}
                      </span>
                      <span className="shrink-0 text-muted">{fmtDate(h.date, "EEE d MMM")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {compOff && (
            <Card id="comp-off" className="scroll-mt-20">
              <CardHeader
                title="Comp-off"
                subtitle={`${compOff.available} day${compOff.available === 1 ? "" : "s"} available · lapses ${fmtDate(range.to, "d MMM yyyy")}`}
                action={
                  <CompOffClaimDialog
                    min={addDays(today, -settings.leave.compOffClaimDays)}
                    max={today}
                    windowDays={settings.leave.compOffClaimDays}
                    fullDay={formatDuration(settings.attendance.fullDayMinutes)}
                    halfDay={formatDuration(settings.attendance.halfDayMinutes)}
                  />
                }
              />
              <CardBody className="pb-3">
                {claims.length === 0 ? (
                  <p className="text-[13px] text-muted">Worked on a weekend or company holiday? Claim a comp-off within {settings.leave.compOffClaimDays} days and take it as leave once approved.</p>
                ) : (
                  <ul>
                    {claims.map((c) => (
                      <li key={c._id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft py-2 text-[13px] first:border-t-0 first:pt-0">
                        <span className="min-w-0">
                          <span className="block font-semibold text-ink">
                            {fmtDate(c.workDate, "EEE d MMM")} · {daysLabel(c.days)}
                          </span>
                          <span className="block text-xs text-muted">
                            {c.claimNo}
                            {c.decisionNote && c.status !== "pending" ? ` · ${c.decisionNote}` : ""}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <StatusChip domain="correction" value={c.status} size="sm" />
                          {c.status === "pending" && (
                            <ActionButton action={withdrawCompOff.bind(null, c._id)} variant="ghost" size="sm" confirm="Withdraw this comp-off claim?" confirmTone="danger" successMessage="Claim withdrawn">
                              Withdraw
                            </ActionButton>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title="My requests" action={requestTotal > 0 && <SortSelect options={sort.options} />} />
        {requests.length === 0 ? (
          <EmptyState title="No leave requests yet" description="Requests you submit will appear here with their approval trail." />
        ) : (
          <ul className="px-5 pb-3">
            {requests.map((r) => {
              const id = r._id;
              const trail: TimelineItem[] = [
                { title: "Submitted", meta: r.requestNo, at: r.createdAt },
                ...r.approvals.map((a): TimelineItem => ({
                  title: `${a.action === "approved" ? "Approved" : "Rejected"} by ${a.byName}`,
                  meta: a.level === "hr" ? "HR / management" : "Reporting manager",
                  body: a.note,
                  at: a.at,
                  tone: a.action === "approved" ? "success" : "danger",
                })),
                ...(r.status === "cancelled" ? [{ title: "Cancelled", at: r.cancelledAt, body: r.cancelReason } satisfies TimelineItem] : []),
              ];
              const waiting =
                r.status === "pending_manager" ? `waiting for ${(r.manager && names.get(r.manager)) ?? "your manager"}` : r.status === "pending_hr" ? "waiting for HR" : null;
              const canCancel = r.status === "pending_manager" || r.status === "pending_hr" || (r.status === "approved" && r.startDate > today);
              return (
                <li key={id} className="border-t border-line-soft py-3 first:border-t-0">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">
                          {leaveRangeLabel(r)} · {r.leaveTypeName} · {daysLabel(r.days)}
                        </span>
                        <span className="block text-xs text-muted">
                          Submitted {timeAgo(r.createdAt)}
                          {waiting ? ` · ${waiting}` : ""}
                        </span>
                      </span>
                      <StatusChip domain="leave" value={r.status} />
                    </summary>
                    <div className="mt-3 flex flex-col gap-3 rounded-xl bg-field p-4">
                      <p className="text-[13px] text-ink-2">&ldquo;{r.reason}&rdquo;</p>
                      {r.attachments.length > 0 && <AttachmentList files={plain(r.attachments).map((f) => ({ file: f.file, name: f.name, size: f.size }))} />}
                      <Timeline items={trail} />
                      {canCancel && (
                        <div>
                          <ReasonAction
                            action={cancelLeave.bind(null, id)}
                            title="Cancel leave request"
                            description={r.status === "approved" ? "This leave is already approved. Cancelling it frees your balance and updates your attendance days." : "The request will be withdrawn."}
                            required={false}
                            label="Reason (optional)"
                            confirmLabel="Cancel request"
                            confirmVariant="danger"
                            successMessage="Request cancelled"
                            trigger={
                              <Button variant="danger-outline" size="sm">
                                Cancel request
                              </Button>
                            }
                          />
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={requestTotal} />
      </Card>
      {balances.length > 0 && (
        <p className="text-xs text-muted">
          Approved leave counts as used and pending requests as reserved. {settings.leave.countWeekendsInLeave ? "Weekends count as leave days." : "Weekends and holidays aren't counted as leave days."}
        </p>
      )}
    </PageBody>
  );
}
