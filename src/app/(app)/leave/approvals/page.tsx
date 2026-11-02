import { forbidden } from "next/navigation";
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import { CheckCircle2, Download } from "lucide-react";
import { AttachmentList } from "@/components/ui/file-upload";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { Pagination } from "@/components/ui/filters";
import { Menu } from "@/components/ui/menu";
import { Alert, EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bulkLeaveBalances, leaveYearOf } from "@/lib/domain/leave-balance";
import { CompOffClaim, Department, Designation, Holiday, LeaveRequest, LeaveType, User, type LeaveStatus } from "@/lib/models";
import { PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/query";
import { plain } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";
import { inList } from "@/lib/sql";
import { fmtDate, formatDuration, timeAgo, todayKey } from "@/lib/time";
import { LeaveTabs } from "../_components/tabs";
import { leaveAccess } from "../_lib/access";
import { daysLabel, leaveRangeLabel } from "../_lib/format";
import { DecisionBar } from "./decision-bar";
import { ReasonAction } from "@/components/ui/actions";
import { revokeLeave } from "../actions";
import { revokeCompOff } from "../comp-off-actions";

export const metadata = { title: "Leave approvals" };

const PENDING: LeaveStatus[] = ["pending_manager", "pending_hr"];
const TABS = ["pending", "approved", "rejected", "all", "compoff"] as const;

export default async function LeaveApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const access = await leaveAccess(user);
  if (!access.canOpenApprovals) forbidden();
  const sp = await searchParams;
  const tabParam = param(sp, "tab");
  const tab = TABS.find((t) => t === tabParam) ?? "pending";
  const page = pageParam(sp);
  const settings = await getSettings();

  // Queue: HR / management decide at any pending stage; a manager decides the manager stage for their own reports.
  const pendingFilter = access.approve
    ? and(inList(LeaveRequest.status, PENDING), ne(LeaveRequest.user, user._id))
    : and(eq(LeaveRequest.status, "pending_manager"), inList(LeaveRequest.user, access.reportIds), ne(LeaveRequest.user, user._id));
  // History: everyone with org-wide access, otherwise the manager's direct reports.
  const scope = access.viewAll || access.approve ? undefined : inList(LeaveRequest.user, access.reportIds);
  const historyFilter = and(scope, tab === "approved" ? eq(LeaveRequest.status, "approved") : tab === "rejected" ? eq(LeaveRequest.status, "rejected") : undefined);

  // Comp-off claims: HR decides any; a reporting manager decides their reports' claims.
  const claimScope = access.viewAll || access.approve ? undefined : inList(CompOffClaim.user, access.reportIds);
  const claimPendingFilter = and(eq(CompOffClaim.status, "pending"), ne(CompOffClaim.user, user._id), access.approve ? undefined : inList(CompOffClaim.user, access.reportIds));

  const [leavePending, claimPending] = await Promise.all([db().$count(LeaveRequest, pendingFilter), db().$count(CompOffClaim, claimPendingFilter)]);
  const pendingCount = leavePending + claimPending;
  const canExport = access.viewAll || access.manage;
  const header = (
    <PageHeader
      overline="Time"
      title="Leave approvals"
      actions={
        canExport ? (
          <Menu
            trigger={
              <Button variant="secondary" icon={<Download className="size-4" />}>
                Export leave report
              </Button>
            }
            items={[
              { label: "CSV", href: "/leave/export?format=csv", external: true },
              { label: "Excel (XLSX)", href: "/leave/export?format=xlsx", external: true },
              { label: "PDF", href: "/leave/export?format=pdf", external: true },
            ]}
          />
        ) : undefined
      }
    />
  );
  const tabs = (
    <>
      <LeaveTabs active="approvals" access={access} pending={pendingCount} />
      <LinkTabs
        items={[
          { href: "/leave/approvals", label: "Pending", active: tab === "pending", count: pendingCount },
          { href: "/leave/approvals?tab=approved", label: "Approved", active: tab === "approved" },
          { href: "/leave/approvals?tab=rejected", label: "Rejected", active: tab === "rejected" },
          { href: "/leave/approvals?tab=all", label: "All requests", active: tab === "all" },
          { href: "/leave/approvals?tab=compoff", label: "Comp-off claims", active: tab === "compoff" },
        ]}
      />
    </>
  );

  if (tab === "compoff") {
    const [claims, total] = await Promise.all([
      db().select().from(CompOffClaim).where(claimScope).orderBy(desc(CompOffClaim.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      db().$count(CompOffClaim, claimScope),
    ]);
    const people = await db()
      .select({ _id: User._id, name: User.name, employeeId: User.employeeId })
      .from(User)
      .where(
        inList(
          User._id,
          claims.map((c) => c.user),
        ),
      );
    const byId = new Map(people.map((p) => [p._id, p]));
    return (
      <PageBody>
        {header}
        {tabs}
        <Card>
          <TableWrap phone={[1, 2, 5]} tablet={[1, 2, 3, 5, 6]}>
            <THead>
              <Th>Person</Th>
              <Th>Day worked</Th>
              <Th align="right">Credit</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>Decision</Th>
            </THead>
            <tbody>
              {claims.length === 0 && <EmptyRow colSpan={6}>No comp-off claims yet.</EmptyRow>}
              {claims.map((c) => {
                const p = byId.get(c.user);
                return (
                  <Tr key={c._id} className="align-top">
                    <Td>
                      <div className="font-semibold">{p?.name ?? "Unknown person"}</div>
                      <div className="text-xs text-muted">{c.claimNo}</div>
                    </Td>
                    <Td>
                      <div>{fmtDate(c.workDate, "EEE d MMM yyyy")}</div>
                      <div className="text-xs text-muted">{formatDuration(c.workMinutes)} worked</div>
                    </Td>
                    <Td align="right">{daysLabel(c.days)}</Td>
                    <Td className="text-[13px] text-ink-2">{c.reason}</Td>
                    <Td>
                      <StatusChip domain="correction" value={c.status} />
                    </Td>
                    <Td className="text-[13px]">
                      {c.decidedByName ? (
                        <>
                          <div>{c.decidedByName}</div>
                          {c.decidedAt && <div className="text-xs text-muted">{fmtDate(c.decidedAt)}</div>}
                          {c.decisionNote && <div className="mt-0.5 text-xs text-ink-2">{c.decisionNote}</div>}
                        </>
                      ) : (
                        <span className="text-muted">Waiting</span>
                      )}
                      {c.status === "approved" && (access.manage || access.approve) && c.user !== user._id && (
                        <div className="mt-1.5">
                          <ReasonAction
                            action={revokeCompOff.bind(null, c._id)}
                            title="Revoke comp-off"
                            description={`${p?.name ?? "The person"} loses ${daysLabel(c.days)} of comp-off for ${fmtDate(c.workDate)}. If it was already taken, their balance shows as negative. They are notified.`}
                            label="Reason"
                            confirmLabel="Revoke"
                            confirmVariant="danger"
                            successMessage="Comp-off revoked"
                            trigger={
                              <Button variant="danger-outline" size="sm">
                                Revoke
                              </Button>
                            }
                          />
                        </div>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </Card>
      </PageBody>
    );
  }

  if (tab !== "pending") {
    const [rows, total] = await Promise.all([
      db()
        .select()
        .from(LeaveRequest)
        .where(historyFilter)
        .orderBy(desc(LeaveRequest.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db().$count(LeaveRequest, historyFilter),
    ]);
    const people = await db()
      .select({ _id: User._id, name: User.name, employeeId: User.employeeId })
      .from(User)
      .where(
        inList(
          User._id,
          rows.map((r) => r.user),
        ),
      );
    const byId = new Map(people.map((p) => [p._id, p]));
    return (
      <PageBody>
        {header}
        {tabs}
        <Card>
          <TableWrap phone={[1, 3, 6]} tablet={[1, 2, 3, 5, 6]}>
            <THead>
              <Th>Person</Th>
              <Th>Type</Th>
              <Th>Dates</Th>
              <Th align="right">Days</Th>
              <Th>Status</Th>
              <Th>Decision</Th>
              <Th>Applied</Th>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={7}>No leave requests in this view.</EmptyRow>}
              {rows.map((r) => {
                const p = byId.get(r.user);
                const last = r.approvals.at(-1);
                return (
                  <Tr key={r._id} className="align-top">
                    <Td>
                      <div className="font-semibold">{p?.name ?? "Unknown person"}</div>
                      <div className="text-xs text-muted">{p?.employeeId}</div>
                    </Td>
                    <Td>{r.leaveTypeName}</Td>
                    <Td>{leaveRangeLabel(r)}</Td>
                    <Td align="right">{r.days}</Td>
                    <Td>
                      <StatusChip domain="leave" value={r.status} />
                    </Td>
                    <Td className="text-[13px]">
                      {last ? (
                        <>
                          <div>
                            {last.action === "approved" ? "Approved" : "Rejected"} by {last.byName} <span className="text-muted">({last.level === "hr" ? "HR" : "manager"})</span>
                          </div>
                          <div className="text-xs text-muted">{fmtDate(last.at)}</div>
                          {last.note && <div className="mt-0.5 text-xs text-ink-2">{last.note}</div>}
                        </>
                      ) : r.status === "cancelled" ? (
                        <span className="text-muted">Cancelled{r.cancelReason ? ` — ${r.cancelReason}` : ""}</span>
                      ) : (
                        <span className="text-muted">Waiting</span>
                      )}
                      {r.status === "approved" && (access.manage || access.approve) && r.user !== user._id && (
                        <div className="mt-1.5">
                          <ReasonAction
                            action={revokeLeave.bind(null, r._id)}
                            title="Cancel approved leave"
                            description={`${p?.name ?? "The person"}'s ${r.leaveTypeName ?? "leave"} (${leaveRangeLabel(r)}) is cancelled, the days return to their balance and attendance is restored. They are notified.`}
                            label="Reason"
                            confirmLabel="Cancel leave"
                            confirmVariant="danger"
                            successMessage="Leave cancelled"
                            trigger={
                              <Button variant="danger-outline" size="sm">
                                Cancel leave
                              </Button>
                            }
                          />
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs text-muted">
                      <div className="whitespace-nowrap">{r.requestNo}</div>
                      <div className="whitespace-nowrap">{timeAgo(r.createdAt)}</div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </Card>
      </PageBody>
    );
  }

  const [requests, claims] = await Promise.all([
    db().select().from(LeaveRequest).where(pendingFilter).orderBy(asc(LeaveRequest.createdAt)).limit(60),
    claimPending ? db().select().from(CompOffClaim).where(claimPendingFilter).orderBy(asc(CompOffClaim.createdAt)).limit(40) : [],
  ]);
  const [claimPeople, claimHolidays] = claims.length
    ? await Promise.all([
        db()
          .select({ _id: User._id, name: User.name, photo: User.photo, employeeId: User.employeeId })
          .from(User)
          .where(
            inList(
              User._id,
              claims.map((c) => c.user),
            ),
          ),
        db()
          .select({ date: Holiday.date, name: Holiday.name })
          .from(Holiday)
          .where(
            inList(
              Holiday.date,
              claims.map((c) => c.workDate),
            ),
          ),
      ])
    : [[], []];
  const claimPerson = new Map(claimPeople.map((p) => [p._id, p]));
  const holidayName = new Map(claimHolidays.map((h) => [h.date, h.name]));
  const claimsSection = claims.length > 0 && (
    <section id="comp-off" className="flex scroll-mt-20 flex-col gap-3" aria-label="Comp-off claims">
      <h2 className="font-display text-[15px] font-semibold text-ink">Comp-off claims</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {claims.map((c) => {
          const p = claimPerson.get(c.user);
          return (
            <article key={c._id} className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-white p-4 sm:p-[18px]">
              <div className="flex items-center gap-3">
                <Avatar name={p?.name ?? "?"} src={p?.photo ?? undefined} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-ink">{p?.name ?? "Unknown person"}</div>
                  <div className="truncate text-xs text-muted">{p?.employeeId}</div>
                </div>
                <Tag tone="orange">Comp-off · {daysLabel(c.days)}</Tag>
              </div>
              <div className="flex flex-wrap gap-x-[18px] gap-y-2 text-[13px]">
                <span>
                  <span className="text-muted">Worked on</span>
                  <br />
                  <strong>{fmtDate(c.workDate, "EEE d MMM yyyy")}</strong>
                </span>
                <span>
                  <span className="text-muted">Day type</span>
                  <br />
                  <strong>{holidayName.get(c.workDate) ?? "Weekend"}</strong>
                </span>
                <span>
                  <span className="text-muted">Hours worked</span>
                  <br />
                  <strong>{formatDuration(c.workMinutes)}</strong>
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-ink-2">&ldquo;{c.reason}&rdquo;</p>
              <div className="text-xs text-muted">
                {c.claimNo} · submitted {timeAgo(c.createdAt)}
              </div>
              <DecisionBar id={c._id} name={p?.name ?? "the applicant"} subject="compOff" />
            </article>
          );
        })}
      </div>
    </section>
  );
  const [people, types] = await Promise.all([
    db()
      .select({
        _id: User._id,
        name: User.name,
        employeeId: User.employeeId,
        photo: User.photo,
        personType: User.personType,
        department: User.department,
        reportingManager: User.reportingManager,
        deptName: Department.name,
        desigName: Designation.name,
      })
      .from(User)
      .leftJoin(Department, eq(Department._id, User.department))
      .leftJoin(Designation, eq(Designation._id, User.designation))
      .where(
        inList(
          User._id,
          requests.flatMap((r) => [r.user, ...(r.manager ? [r.manager] : [])]),
        ),
      ),
    db()
      .select({ _id: LeaveType._id, name: LeaveType.name })
      .from(LeaveType)
      .where(
        inList(
          LeaveType._id,
          requests.map((r) => r.leaveType),
        ),
      ),
  ]);
  const byId = new Map(people.map((p) => [p._id, p]));
  const typeName = new Map(types.map((t) => [t._id, t.name]));

  // Balance after approval: pending requests are already reserved in `available`, so it is the post-approval balance.
  const years = [...new Set(requests.map((r) => leaveYearOf(r.startDate, settings)))];
  const today = todayKey();
  const balanceSets = await Promise.all(
    years.map(async (year) => {
      const subjects = requests.filter((r) => leaveYearOf(r.startDate, settings) === year).map((r) => ({ id: r.user, personType: byId.get(r.user)?.personType ?? "employee" }));
      return [year, await bulkLeaveBalances(subjects, year, settings, today)] as const;
    }),
  );
  const balanceByYear = new Map(balanceSets);

  // Hint: approved leave of other people in the same department during the same dates.
  const minStart = requests.reduce((m, r) => (r.startDate < m ? r.startDate : m), "9999-12-31");
  const maxEnd = requests.reduce((m, r) => (r.endDate > m ? r.endDate : m), "0000-01-01");
  const approved = requests.length
    ? await db()
        .select({
          user: LeaveRequest.user,
          startDate: LeaveRequest.startDate,
          endDate: LeaveRequest.endDate,
          halfDay: LeaveRequest.halfDay,
          halfDaySession: LeaveRequest.halfDaySession,
        })
        .from(LeaveRequest)
        .where(and(eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, maxEnd), gte(LeaveRequest.endDate, minStart)))
    : [];
  const approvedPeople = await db()
    .select({ _id: User._id, name: User.name, department: User.department })
    .from(User)
    .where(
      inList(
        User._id,
        approved.map((a) => a.user),
      ),
    );
  const approvedById = new Map(approvedPeople.map((p) => [p._id, p]));

  return (
    <PageBody>
      {header}
      {tabs}
      {claimsSection}
      {requests.length === 0 ? (
        !claimsSection && (
          <Card>
            <EmptyState icon={<CheckCircle2 className="size-5" />} title="No pending approvals" description="Leave requests and comp-off claims waiting for your decision appear here." />
          </Card>
        )
      ) : (
        <>
        {claimsSection && <h2 className="font-display text-[15px] font-semibold text-ink">Leave requests</h2>}
        <div className="grid gap-4 md:grid-cols-2">
          {requests.map((r) => {
            const id = r._id;
            const p = byId.get(r.user);
            const dept = p?.deptName ?? undefined;
            const role = p?.desigName ?? undefined;
            const manager = p?.reportingManager ? byId.get(p.reportingManager)?.name : undefined;
            const balance = balanceByYear.get(leaveYearOf(r.startDate, settings))?.rows.get(r.user)?.get(r.leaveType);
            const clashes = approved
              .filter((a) => a.user !== r.user && a.startDate <= r.endDate && a.endDate >= r.startDate)
              .filter((a) => dept && approvedById.get(a.user)?.department === p?.department)
              .slice(0, 3);
            const afterText = !balance ? "—" : balance.unlimited ? "Unpaid · no limit" : `${balance.available} ${(typeName.get(r.leaveType) ?? r.leaveTypeName ?? "").toLowerCase()}`;
            return (
              <article key={id} className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-white p-4 sm:p-[18px]">
                <div className="flex items-center gap-3">
                  <Avatar name={p?.name ?? "?"} src={p?.photo ?? undefined} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-ink">{p?.name ?? "Unknown person"}</div>
                    <div className="truncate text-xs text-muted">{[role, dept, manager && `reports to ${manager}`].filter(Boolean).join(" · ") || p?.employeeId}</div>
                  </div>
                  <Tag tone="blue">
                    {r.leaveTypeName}
                    {r.halfDay ? " · half day" : ""}
                  </Tag>
                </div>
                <div className="flex flex-wrap gap-x-[18px] gap-y-2 text-[13px]">
                  <span>
                    <span className="text-muted">Dates</span>
                    <br />
                    <strong>{leaveRangeLabel(r)}</strong>
                  </span>
                  <span>
                    <span className="text-muted">Days</span>
                    <br />
                    <strong>{daysLabel(r.days)}</strong>
                  </span>
                  <span>
                    <span className="text-muted">Balance after</span>
                    <br />
                    <strong className={balance && !balance.unlimited && balance.available < 0 ? "text-danger" : undefined}>{afterText}</strong>
                  </span>
                  <span>
                    <span className="text-muted">Stage</span>
                    <br />
                    <StatusChip domain="leave" value={r.status} size="sm" />
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-ink-2">&ldquo;{r.reason}&rdquo;</p>
                {r.attachments.length > 0 && <AttachmentList files={plain(r.attachments).map((f) => ({ file: f.file, name: f.name, size: f.size }))} />}
                {clashes.length > 0 && (
                  <Alert tone="warning" className="py-2 text-xs">
                    {clashes.map((c) => `${approvedById.get(c.user)?.name ?? "A colleague"} (${leaveRangeLabel(c)})`).join("; ")} — same department, already on approved leave.
                  </Alert>
                )}
                <div className="text-xs text-muted">
                  {r.requestNo} · submitted {timeAgo(r.createdAt)}
                </div>
                <DecisionBar id={id} name={p?.name ?? "the applicant"} />
              </article>
            );
          })}
        </div>
        </>
      )}
      {requests.length > 0 && !access.approve && <p className="text-xs text-muted">You decide the manager stage for your reports. HR completes leave types that need a second approval.</p>}
    </PageBody>
  );
}
