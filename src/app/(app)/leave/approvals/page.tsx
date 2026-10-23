import { forbidden } from "next/navigation";
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
import { connectDB } from "@/lib/db";
import { leaveYearOf } from "@/lib/domain/leave-balance";
import { Department, Designation, LeaveRequest, LeaveType, User, type LeaveStatus } from "@/lib/models";
import { PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/query";
import { plain } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";
import { fmtDate, timeAgo, todayKey } from "@/lib/time";
import { LeaveTabs } from "../_components/tabs";
import { leaveAccess } from "../_lib/access";
import { bulkLeaveBalances } from "../_lib/balances";
import { daysLabel, leaveRangeLabel } from "../_lib/format";
import { DecisionBar } from "./decision-bar";

export const metadata = { title: "Leave approvals" };

const PENDING: LeaveStatus[] = ["pending_manager", "pending_hr"];
const TABS = ["pending", "approved", "rejected", "all"] as const;

export default async function LeaveApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const access = await leaveAccess(user);
  if (!access.canOpenApprovals) forbidden();
  const sp = await searchParams;
  const tabParam = param(sp, "tab");
  const tab = TABS.find((t) => t === tabParam) ?? "pending";
  const page = pageParam(sp);
  await connectDB();
  const settings = await getSettings();

  // Queue: HR / management decide at any pending stage; a manager decides the manager stage for their own reports.
  const pendingFilter: Record<string, unknown> = access.approve
    ? { status: { $in: PENDING }, user: { $ne: user._id } }
    : { status: "pending_manager", manager: user._id, user: { $ne: user._id } };
  // History: everyone with org-wide access, otherwise the manager's direct reports.
  const scope: Record<string, unknown> = access.viewAll || access.approve ? {} : { user: { $in: access.reportIds } };
  const historyFilter: Record<string, unknown> = { ...scope, ...(tab === "approved" ? { status: "approved" } : tab === "rejected" ? { status: "rejected" } : {}) };

  const pendingCount = await LeaveRequest.countDocuments(pendingFilter);
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
        ]}
      />
    </>
  );

  if (tab !== "pending") {
    const [rows, total] = await Promise.all([
      LeaveRequest.find(historyFilter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      LeaveRequest.countDocuments(historyFilter),
    ]);
    const people = await User.find({ _id: { $in: rows.map((r) => r.user) } }, { name: 1, employeeId: 1 }).lean();
    const byId = new Map(people.map((p) => [p._id.toString(), p]));
    return (
      <PageBody>
        {header}
        {tabs}
        <Card>
          <TableWrap phone={[1, 3, 5]} tablet={[1, 2, 3, 5, 6]}>
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
                const p = byId.get(r.user.toString());
                const last = r.approvals.at(-1);
                return (
                  <Tr key={r._id.toString()} className="align-top">
                    <Td>
                      <div className="font-semibold">{p?.name ?? "Unknown person"}</div>
                      <div className="text-xs text-muted">{p?.employeeId}</div>
                    </Td>
                    <Td>{r.leaveTypeName}</Td>
                    <Td className="whitespace-nowrap">{leaveRangeLabel(r)}</Td>
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
                    </Td>
                    <Td className="text-xs whitespace-nowrap text-muted">
                      {r.requestNo} · {timeAgo(r.createdAt)}
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

  const requests = await LeaveRequest.find(pendingFilter).sort({ createdAt: 1 }).limit(60).lean();
  const people = await User.find(
    { _id: { $in: requests.flatMap((r) => [r.user, ...(r.manager ? [r.manager] : [])]) } },
    { name: 1, employeeId: 1, photo: 1, personType: 1, department: 1, designation: 1, reportingManager: 1 },
  ).lean();
  const byId = new Map(people.map((p) => [p._id.toString(), p]));
  const [departments, designations, types] = await Promise.all([
    Department.find({ _id: { $in: people.flatMap((p) => (p.department ? [p.department] : [])) } }, { name: 1 }).lean(),
    Designation.find({ _id: { $in: people.flatMap((p) => (p.designation ? [p.designation] : [])) } }, { name: 1 }).lean(),
    LeaveType.find({ _id: { $in: requests.map((r) => r.leaveType) } }, { name: 1 }).lean(),
  ]);
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const desigName = new Map(designations.map((d) => [d._id.toString(), d.name]));
  const typeName = new Map(types.map((t) => [t._id.toString(), t.name]));

  // Balance after approval: pending requests are already reserved in `available`, so it is the post-approval balance.
  const years = [...new Set(requests.map((r) => leaveYearOf(r.startDate, settings)))];
  const today = todayKey();
  const balanceSets = await Promise.all(
    years.map(async (year) => {
      const subjects = requests.filter((r) => leaveYearOf(r.startDate, settings) === year).map((r) => ({ id: r.user.toString(), personType: byId.get(r.user.toString())?.personType ?? "employee" }));
      return [year, await bulkLeaveBalances(subjects, year, settings, today)] as const;
    }),
  );
  const balanceByYear = new Map(balanceSets);

  // Hint: approved leave of other people in the same department during the same dates.
  const minStart = requests.reduce((m, r) => (r.startDate < m ? r.startDate : m), "9999-12-31");
  const maxEnd = requests.reduce((m, r) => (r.endDate > m ? r.endDate : m), "0000-01-01");
  const approved = requests.length
    ? await LeaveRequest.find({ status: "approved", startDate: { $lte: maxEnd }, endDate: { $gte: minStart } }, { user: 1, startDate: 1, endDate: 1, halfDay: 1, halfDaySession: 1 }).lean()
    : [];
  const approvedPeople = await User.find({ _id: { $in: approved.map((a) => a.user) } }, { name: 1, department: 1 }).lean();
  const approvedById = new Map(approvedPeople.map((p) => [p._id.toString(), p]));

  return (
    <PageBody>
      {header}
      {tabs}
      {requests.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckCircle2 className="size-5" />} title="No pending approvals" description="Leave requests waiting for your decision appear here." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {requests.map((r) => {
            const id = r._id.toString();
            const p = byId.get(r.user.toString());
            const dept = p?.department ? deptName.get(p.department.toString()) : undefined;
            const role = p?.designation ? desigName.get(p.designation.toString()) : undefined;
            const manager = p?.reportingManager ? byId.get(p.reportingManager.toString())?.name : undefined;
            const balance = balanceByYear.get(leaveYearOf(r.startDate, settings))?.rows.get(r.user.toString())?.get(r.leaveType.toString());
            const clashes = approved
              .filter((a) => a.user.toString() !== r.user.toString() && a.startDate <= r.endDate && a.endDate >= r.startDate)
              .filter((a) => dept && approvedById.get(a.user.toString())?.department?.toString() === p?.department?.toString())
              .slice(0, 3);
            const afterText = !balance ? "—" : balance.unlimited ? "Unpaid · no limit" : `${balance.available} ${(typeName.get(r.leaveType.toString()) ?? r.leaveTypeName ?? "").toLowerCase()}`;
            return (
              <article key={id} className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-white p-4 sm:p-[18px]">
                <div className="flex items-center gap-3">
                  <Avatar name={p?.name ?? "?"} src={p?.photo} size="md" />
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
                    {clashes.map((c) => `${approvedById.get(c.user.toString())?.name ?? "A colleague"} (${leaveRangeLabel(c)})`).join("; ")} — same department, already on approved leave.
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
      )}
      {requests.length > 0 && !access.approve && <p className="text-xs text-muted">You decide the manager stage for your reports. HR completes leave types that need a second approval.</p>}
    </PageBody>
  );
}
