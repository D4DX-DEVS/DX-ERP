import { forbidden } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, StatusChip } from "@/components/ui/chip";
import { Pagination } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { AttendanceCorrection, Department, User, type IAttendanceCorrection } from "@/lib/models";
import { PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/query";
import { fmtDate, fmtDateTime, fmtTime, timeAgo } from "@/lib/time";
import { approveCorrection, rejectCorrection } from "../actions";
import { AttendanceTabs } from "../_components/tabs";
import { attendanceAccess } from "../_lib/access";
import { currentTime } from "../_lib/clock";
import { decidableFilter, historyFilter } from "../_lib/corrections";

export const metadata = { title: "Attendance corrections" };

type Correction = Pick<IAttendanceCorrection, "date" | "requestedCheckIn" | "requestedCheckOut" | "original">;

function Change({ c }: { c: Correction }) {
  return (
    <div className="flex flex-col gap-0.5 text-[13px]">
      {c.requestedCheckIn && (
        <span>
          <span className="text-muted">Check-in</span> <span className="tabular">{fmtTime(c.original.checkIn)}</span> → <strong className="tabular">{fmtTime(c.requestedCheckIn)}</strong>
        </span>
      )}
      {c.requestedCheckOut && (
        <span>
          <span className="text-muted">Check-out</span> <span className="tabular">{fmtTime(c.original.checkOut)}</span> → <strong className="tabular">{fmtTime(c.requestedCheckOut)}</strong>
        </span>
      )}
    </div>
  );
}

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const access = await attendanceAccess(user);
  if (!access.canDecide) forbidden();
  const sp = await searchParams;
  const tab = param(sp, "tab") === "history" ? "history" : "pending";
  const page = pageParam(sp);
  await connectDB();
  const now = currentTime();

  const pendingFilter: Record<string, unknown> = { status: "pending", ...decidableFilter(user, access) };
  const historyQuery: Record<string, unknown> = { status: { $in: ["approved", "rejected"] }, ...historyFilter(access) };
  const rowsQuery =
    tab === "pending"
      ? AttendanceCorrection.find(pendingFilter).sort({ createdAt: 1 }).limit(100)
      : AttendanceCorrection.find(historyQuery).sort({ reviewedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE);
  const [pendingCount, rows, historyTotal] = await Promise.all([
    AttendanceCorrection.countDocuments(pendingFilter),
    rowsQuery.lean(),
    tab === "history" ? AttendanceCorrection.countDocuments(historyQuery) : Promise.resolve(0),
  ]);

  const people = await User.find({ _id: { $in: rows.map((r) => r.user) } }, { name: 1, employeeId: 1, photo: 1, department: 1 }).lean();
  const departments = await Department.find({ _id: { $in: people.flatMap((p) => (p.department ? [p.department] : [])) } }, { name: 1 }).lean();
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const personById = new Map(people.map((p) => [p._id.toString(), { ...p, deptName: p.department ? deptName.get(p.department.toString()) : undefined }]));

  return (
    <PageBody>
      <PageHeader overline="Time" title="Attendance corrections" description={access.approve ? "Corrections from all staff." : "Corrections from the people who report to you."} />
      <AttendanceTabs active="corrections" access={access} pendingCorrections={pendingCount} />
      <LinkTabs
        items={[
          { href: "/attendance/corrections", label: "Pending", active: tab === "pending", count: pendingCount },
          { href: "/attendance/corrections?tab=history", label: "Decision history", active: tab === "history" },
        ]}
      />

      {tab === "pending" ? (
        rows.length === 0 ? (
          <Card>
            <EmptyState icon={<CheckCircle2 className="size-5" />} title="No pending corrections" description="Requests from your team will appear here for approval." />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((c) => {
              const p = personById.get(c.user.toString());
              const overdue = now.getTime() - c.createdAt.getTime() > 24 * 3_600_000;
              const id = c._id.toString();
              return (
                <article key={id} className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={p?.name ?? "?"} src={p?.photo} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-ink">{p?.name ?? "Unknown person"}</div>
                      <div className="truncate text-xs text-muted">{[p?.employeeId, p?.deptName].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Chip tone={overdue ? "orange" : "amber"}>{overdue ? "Waiting " + timeAgo(c.createdAt).replace(" ago", "") : "Pending"}</Chip>
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted">Day</div>
                      <div className="text-sm font-semibold">{fmtDate(c.date, "EEE d MMM yyyy")}</div>
                    </div>
                    <Change c={c} />
                  </div>
                  <p className="text-[13px] leading-relaxed text-ink-2">&ldquo;{c.reason}&rdquo;</p>
                  <div className="flex gap-2">
                    <ReasonAction
                      action={rejectCorrection.bind(null, id)}
                      title="Reject correction"
                      description={`${p?.name ?? "The requester"} will be notified with your reason.`}
                      confirmLabel="Reject"
                      confirmVariant="danger"
                      successMessage="Correction rejected"
                      trigger={
                        <Button variant="danger-outline" className="flex-1">
                          Reject
                        </Button>
                      }
                    />
                    <ActionButton action={approveCorrection.bind(null, id)} variant="success" className="flex-1" successMessage="Correction approved">
                      Approve
                    </ActionButton>
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : (
        <Card>
          <TableWrap phone={[1, 2, 5]} tablet={[1, 2, 3, 5]}>
            <THead>
              <Th>Person</Th>
              <Th>Day</Th>
              <Th>Change</Th>
              <Th>Reason</Th>
              <Th>Decision</Th>
              <Th>Decided by</Th>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={6}>No decided corrections yet.</EmptyRow>}
              {rows.map((c) => {
                const p = personById.get(c.user.toString());
                return (
                  <Tr key={c._id.toString()} className="align-top">
                    <Td>
                      <div className="font-semibold">{p?.name ?? "Unknown person"}</div>
                      <div className="text-xs text-muted">{[p?.employeeId, p?.deptName].filter(Boolean).join(" · ")}</div>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(c.date, "EEE d MMM yyyy")}</Td>
                    <Td>
                      <Change c={c} />
                    </Td>
                    <Td className="max-w-xs text-[13px] text-ink-2">{c.reason}</Td>
                    <Td>
                      <StatusChip domain="correction" value={c.status} />
                    </Td>
                    <Td className="text-[13px]">
                      <div>{c.reviewerName ?? "—"}</div>
                      <div className="text-xs text-muted">{c.reviewedAt ? fmtDateTime(c.reviewedAt) : ""}</div>
                      {c.reviewNote && <div className="mt-0.5 text-xs text-ink-2">{c.reviewNote}</div>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={historyTotal} />
        </Card>
      )}
    </PageBody>
  );
}
