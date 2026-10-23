import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Movement, Project, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { canApproveMovement, canViewMovement, displayStatus, managesUser, personalDetailsVisible, withinSelfCancelWindow } from "@/lib/movement/access";
import { isObjectId } from "@/lib/validation";
import { fmtDate, fmtDateTime, fmtTime, formatDuration, minutesBetween, todayKey } from "@/lib/time";
import { Alert, PageBody, PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { PersonCell } from "@/components/ui/avatar";
import { Timeline } from "@/components/ui/timeline";
import {
  ApprovalButtons,
  CancelMovementButton,
  CorrectionDecision,
  CorrectionDialog,
  ElapsedTimer,
  ExtendReturnDialog,
  RecordInButton,
  ResolveDialog,
} from "../movement-controls";

export const metadata: Metadata = { title: "Movement" };

export default async function MovementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const user = await requireUser();
  await connectDB();
  const m = await Movement.findById(id).lean();
  if (!m) notFound();
  if (!(await canViewMovement(user, m))) forbidden();

  const settings = await getSettings();
  const today = todayKey();
  const own = m.user.toString() === user.id;
  const isManager = own ? false : await managesUser(user.id, m.user);
  const showDetails = personalDetailsVisible(user, m, isManager);
  const canApprove = await canApproveMovement(user, m);
  const canManage = can(user, "movement.manage");
  const status = displayStatus(m, settings, today);

  const [person, project, client] = await Promise.all([
    User.findById(m.user, { name: 1, employeeId: 1, photo: 1 }).lean(),
    m.project ? Project.findById(m.project, { projectNo: 1, title: 1 }).lean() : null,
    m.client ? Client.findById(m.client, { clientNo: 1, name: 1, confidential: 1, owner: 1 }).lean() : null,
  ]);
  const clientVisible = client && (!client.confidential || can(user, "crm.confidential") || client.owner?.toString() === user.id);
  const pendingCorrection = m.corrections.find((c) => c.status === "pending");
  const late = m.inTime && m.expectedReturn && m.inTime.getTime() > m.expectedReturn.getTime() ? minutesBetween(m.expectedReturn, m.inTime) : 0;

  return (
    <PageBody className="max-w-[1100px]">
      <PageHeader
        back={{ href: "/movement", label: "Movement register" }}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {m.movementNo}
            <StatusChip domain="movement" value={status} />
            {m.approvalStatus !== "not_required" && <StatusChip domain="movementApproval" value={m.approvalStatus} />}
            {m.entryMode === "alternative" && <Tag tone="purple">Late entry</Tag>}
          </span>
        }
        description={`${m.categoryLabel} · ${fmtDate(m.date, "EEEE, d MMMM yyyy")}`}
      />

      {status === "missing_in" && (
        <Alert tone="danger" title="Missing In-Time.">
          This movement started on {fmtDate(m.date)} and was never closed. {own ? "Request a correction with the time you returned." : "Resolve it with the confirmed return time."}
        </Alert>
      )}
      {status === "overdue" && (
        <Alert tone="outside" title="Overdue.">
          Expected back at {fmtTime(m.expectedReturn)}. {own ? "Record your In-Time or update the return time." : ""}
        </Alert>
      )}
      {m.approvalStatus === "rejected" && <Alert tone="danger" title="Rejected.">{showDetails ? (m.approvalNote ?? "") : ""}</Alert>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          {m.status === "out" && m.outTime && (
            <Card className="border-[#fcd3bd]">
              <CardBody className="flex flex-col gap-4 pt-5">
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-outside-bg px-3 py-1 text-[13px] font-semibold text-tone-orange">
                  <span className="size-2 rounded-full bg-outside" />
                  {own ? "You're out of the office" : `${person?.name ?? "Person"} is out of the office`}
                </span>
                <ElapsedTimer outTime={m.outTime.toISOString()} expectedReturn={m.expectedReturn?.toISOString()} />
                <div className="text-[13px] text-muted">
                  Out {fmtTime(m.outTime)}
                  {m.date !== today ? ` on ${fmtDate(m.date)}` : ""} · {m.expectedReturn ? `back by ${fmtTime(m.expectedReturn)}` : "no expected return"}
                </div>
                <div className="flex flex-wrap gap-2">
                  {own && <RecordInButton id={id} size="lg" />}
                  {(own || canManage) && <ExtendReturnDialog id={id} current={m.expectedReturn?.toISOString()} />}
                  {!own && canManage && <ResolveDialog id={id} outTime={m.outTime.toISOString()} />}
                  {((own && m.date === today && withinSelfCancelWindow(m)) || canManage) && <CancelMovementButton id={id} />}
                </div>
                {own && (
                  <p className="text-xs text-muted">
                    If you don&apos;t record an In-Time, your manager and HR are alerted {settings.movement.overdueGraceMinutes} minutes after the expected return.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Movement details" />
            <CardBody>
              <DetailList
                items={[
                  { label: "Person", value: person ? <PersonCell name={person.name} sub={person.employeeId} photo={person.photo} href={can(user, "staff.view") ? `/staff/${person._id}` : undefined} /> : "—" },
                  { label: "Category", value: <span className="flex items-center gap-2">{m.categoryLabel} <Tag tone={m.official ? "blue" : "orange"}>{m.official ? "Official" : "Personal"}</Tag></span> },
                  { label: "Out-Time", value: fmtDateTime(m.outTime) },
                  { label: "Expected return", value: fmtDateTime(m.expectedReturn) },
                  { label: "In-Time", value: m.inTime ? fmtDateTime(m.inTime) : m.status === "out" ? "Not yet recorded" : "—" },
                  {
                    label: "Total time outside",
                    value: m.durationMinutes != null ? (
                      <span className="font-semibold">
                        {formatDuration(m.durationMinutes)}
                        {late > 0 && <span className="ml-2 text-xs font-medium text-danger">returned {formatDuration(late)} late</span>}
                      </span>
                    ) : (
                      "No final duration until In-Time is recorded"
                    ),
                  },
                  { label: "Purpose", value: showDetails ? m.purpose : "Personal (details restricted)" },
                  { label: "Destination", value: showDetails ? m.destination || "—" : "—" },
                  { label: "Project", value: project ? <Link className="text-brand-600 hover:underline" href={`/projects/${project._id}`}>{`${project.projectNo} · ${project.title}`}</Link> : "—" },
                  { label: "Client", value: clientVisible ? `${client!.clientNo} · ${client!.name}` : client ? "Restricted" : "—" },
                  { label: "Remarks", value: showDetails ? m.remarks || "—" : "—", full: true },
                  {
                    label: "Entry",
                    value:
                      m.entryMode === "alternative"
                        ? `Late entry by ${m.enteredByName ?? "—"}${m.alternativeReason && showDetails ? ` — ${m.alternativeReason}` : ""}`
                        : m.enteredBy && m.enteredBy.toString() !== m.user.toString()
                          ? `Recorded on behalf by ${m.enteredByName}`
                          : "Recorded live",
                    full: true,
                  },
                  ...(m.resolvedByName ? [{ label: "Resolved", value: showDetails ? `${m.resolvedByName}: ${m.resolutionNote ?? ""}` : m.resolvedByName, full: true }] : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Corrections" subtitle="Original timestamps are preserved; every change is logged." action={own && m.status !== "cancelled" && !pendingCorrection ? <CorrectionDialog id={id} outTime={m.outTime?.toISOString()} inTime={m.inTime?.toISOString()} needsIn={m.status === "returned"} /> : undefined} />
            <CardBody className="flex flex-col gap-3">
              {m.corrections.length === 0 && <p className="text-[13px] text-muted">No corrections requested.</p>}
              {m.corrections
                .slice()
                .reverse()
                .map((c) => (
                  <div key={c._id?.toString()} className="rounded-xl border border-line p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-[13px]">
                        <div className="font-semibold text-ink">
                          {c.requestedByName} · {fmtDateTime(c.requestedAt)}
                        </div>
                        <div className="mt-1 text-ink-2">
                          Out {fmtDateTime(c.originalOutTime)} → <strong>{fmtDateTime(c.proposedOutTime)}</strong>
                        </div>
                        <div className="text-ink-2">
                          In {c.originalInTime ? fmtDateTime(c.originalInTime) : "—"} → <strong>{c.proposedInTime ? fmtDateTime(c.proposedInTime) : "—"}</strong>
                        </div>
                        {showDetails && <div className="mt-1 text-muted">Reason: {c.reason}</div>}
                        {c.reviewedByName && (
                          <div className="mt-1 text-muted">
                            {c.status === "approved" ? "Approved" : "Rejected"} by {c.reviewedByName} · {fmtDateTime(c.reviewedAt)}
                            {c.reviewNote && showDetails ? ` — ${c.reviewNote}` : ""}
                          </div>
                        )}
                      </div>
                      <StatusChip domain="correction" value={c.status} />
                    </div>
                    {c.status === "pending" && canApprove && (
                      <div className="mt-3 flex justify-end">
                        <CorrectionDecision id={id} correctionId={c._id!.toString()} />
                      </div>
                    )}
                  </div>
                ))}
            </CardBody>
          </Card>
        </div>

        <aside className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Approval" />
            <CardBody className="flex flex-col gap-3 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-muted">Status</span>
                <StatusChip domain="movementApproval" value={m.approvalStatus} />
              </div>
              {m.approvedByName && (
                <div className="text-ink-2">
                  {m.approvalStatus === "approved" ? "Approved" : "Decided"} by <strong>{m.approvedByName}</strong> · {fmtDateTime(m.approvedAt)}
                  {m.approvalNote && showDetails && <div className="mt-1 text-muted">“{m.approvalNote}”</div>}
                </div>
              )}
              {m.approvalStatus === "pending" && canApprove && <ApprovalButtons id={id} />}
              {m.approvalStatus === "pending" && !canApprove && <p className="text-muted">Waiting for the reporting manager or an authorised approver.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <Timeline
                items={m.history
                  .slice()
                  .reverse()
                  .map((h, i) => ({
                    id: String(i),
                    title: h.action,
                    meta: h.byName,
                    at: h.at,
                    body: [h.from && h.to ? `${h.from} → ${h.to}` : h.to ?? h.from, showDetails ? h.note : undefined].filter(Boolean).join("\n") || undefined,
                    tone: /reject|cancel/i.test(h.action) ? "danger" : /approv|In-Time/i.test(h.action) ? "success" : "default",
                  }))}
              />
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}
