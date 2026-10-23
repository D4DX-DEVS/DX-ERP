import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Department, Expense, PayrollRun, Payslip, Project, User } from "@/lib/models";
import { inr } from "@/lib/format";
import { fmtDate, fmtDateTime, todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { Alert, PageBody, PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Chip, StatusChip } from "@/components/ui/chip";
import { AttachmentList } from "@/components/ui/file-upload";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { PersonCell } from "@/components/ui/avatar";
import { ApproveExpenseButton, DeleteExpenseButton, PayExpenseDialog, RejectExpenseButton, SubmitExpenseButton } from "../expense-actions";
import { EXPENSE_TYPE_LABEL } from "../constants";

export const metadata = { title: "Expense" };

const HISTORY_LABEL: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  submitted: "Submitted for approval",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Payment recorded",
};

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const e = await Expense.findById(id).lean();
  if (!e) notFound();

  const owner = e.user.toString() === user.id;
  const viewAll = can(user, "expenses.view_all");
  const approve = can(user, "expenses.approve");
  const pay = can(user, "expenses.pay");
  // Approvers and payers only see what has reached their queue, never someone else's drafts.
  const inQueue = (approve && e.status !== "draft") || (pay && (e.status === "approved" || e.status === "paid"));
  if (!owner && !viewAll && !inQueue) forbidden();

  const [person, project, client, department, slips] = await Promise.all([
    User.findById(e.user, { name: 1, employeeId: 1, photo: 1 }).lean(),
    e.project ? Project.findById(e.project, { projectNo: 1, title: 1 }).lean() : null,
    e.client && can(user, "crm.view") ? Client.findById(e.client, { name: 1, clientNo: 1, confidential: 1 }).lean() : null,
    e.department ? Department.findById(e.department, { name: 1 }).lean() : null,
    e.status === "approved" ? Payslip.find({ reimbursedExpenses: e._id }, { run: 1 }).lean() : [],
  ]);
  // An approved claim that is part of an unfinished payroll run is paid through that run.
  const run = slips.length ? await PayrollRun.findOne({ _id: { $in: slips.map((s) => s.run) }, status: { $in: ["draft", "verified", "approved"] } }, { runNo: 1 }).lean() : null;

  const today = todayKey();
  const editable = owner && (e.status === "draft" || e.status === "rejected");
  const canDecide = approve && !owner && e.status === "submitted";
  const canPay = pay && e.status === "approved" && !run;

  const timeline: TimelineItem[] = [...e.history]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((h, i) => ({
      id: `${i}`,
      title: HISTORY_LABEL[h.action] ?? h.action,
      meta: h.byName,
      at: h.at,
      body: h.note,
      tone: h.action === "approved" || h.action === "paid" ? "success" : h.action === "rejected" ? "danger" : "default",
    }));

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/expenses", label: "Expenses" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[22px] sm:text-2xl">{e.expenseNo}</span>
            <StatusChip domain="expense" value={e.status} />
            <Chip tone={e.type === "reimbursable" ? "blue" : "gray"} dot={false}>
              {EXPENSE_TYPE_LABEL[e.type]}
            </Chip>
          </span>
        }
        actions={
          <>
            {editable && (
              <ButtonLink variant="secondary" href={`/expenses/${id}/edit`} icon={<Pencil className="size-4" aria-hidden />}>
                Edit
              </ButtonLink>
            )}
            {editable && <DeleteExpenseButton id={id} />}
            {editable && <SubmitExpenseButton id={id} label={e.status === "rejected" ? "Resubmit" : "Submit for approval"} />}
            {canDecide && <RejectExpenseButton id={id} />}
            {canDecide && <ApproveExpenseButton id={id} />}
            {canPay && <PayExpenseDialog id={id} amount={e.amount} today={today} reimbursable={e.type === "reimbursable"} />}
          </>
        }
      />

      {e.status === "rejected" && (
        <Alert tone="danger" title="Rejected.">
          {e.decisionNote ? `${e.approverName ?? "The approver"}: ${e.decisionNote}` : "This expense was rejected."} {owner && "Edit it and submit again."}
        </Alert>
      )}
      {e.status === "submitted" && owner && <Alert tone="info">Waiting for approval. You can no longer edit it unless it is rejected.</Alert>}
      {e.status === "approved" && run && <Alert tone="info">Included in payroll run {run.runNo}. It will be marked paid when that run is paid.</Alert>}
      {e.status === "approved" && !run && e.type === "reimbursable" && owner && <Alert tone="success">Approved. Finance will reimburse it, or it will be added to your next payroll.</Alert>}
      {canDecide && e.receipts.length === 0 && <Alert tone="warning">No receipt is attached to this expense.</Alert>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="flex flex-col gap-5">
              <div className="font-display text-[28px] leading-none font-semibold tabular">
                {inr(e.amount, true)}
                {e.taxAmount > 0 && <span className="ml-3 font-sans text-sm font-normal text-muted">incl. {inr(e.taxAmount, true)} tax</span>}
              </div>
              <DetailList
                columns={3}
                items={[
                  { label: "Date", value: fmtDate(e.date) },
                  { label: "Category", value: e.category },
                  { label: "Vendor", value: e.vendor || "—" },
                  { label: "Payment mode", value: e.paymentMode || "—" },
                  { label: "Project", value: project ? <Link href={`/projects/${project._id}`} className="font-medium text-brand-600 hover:text-brand-800">{project.projectNo} · {project.title}</Link> : "—" },
                  { label: "Client", value: client && (!client.confidential || can(user, "crm.confidential")) ? `${client.name} · ${client.clientNo}` : e.client ? "Restricted" : "—" },
                  { label: "Department", value: department?.name ?? "—" },
                  { label: "Submitted", value: e.submittedAt ? fmtDateTime(e.submittedAt) : "Not submitted" },
                ]}
              />
              <div>
                <div className="text-xs font-medium text-muted">Description</div>
                <p className="mt-1 text-sm whitespace-pre-line text-ink">{e.description}</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Receipts" subtitle={e.receipts.length ? undefined : "Nothing attached"} />
            <CardBody>
              <AttachmentList files={e.receipts.map((r) => ({ file: r.file.toString(), name: r.name, size: r.size }))} empty="No receipts attached." />
            </CardBody>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Submitted by" />
            <CardBody>{person ? <PersonCell name={person.name} photo={person.photo} sub={person.employeeId} /> : <span className="text-sm text-muted">Unknown person</span>}</CardBody>
          </Card>

          {(e.decidedAt || e.payment?.date) && (
            <Card>
              <CardHeader title="Decision and payment" />
              <CardBody className="flex flex-col gap-4">
                {e.decidedAt && (
                  <DetailList
                    columns={1}
                    items={[
                      { label: e.status === "rejected" ? "Rejected by" : "Approved by", value: `${e.approverName ?? "—"} · ${fmtDateTime(e.decidedAt)}` },
                      ...(e.decisionNote ? [{ label: "Note", value: e.decisionNote }] : []),
                    ]}
                  />
                )}
                {e.payment?.date && (
                  <DetailList
                    columns={1}
                    items={[
                      { label: e.type === "reimbursable" ? "Reimbursed" : "Paid", value: `${fmtDate(e.payment.date)} · ${e.payment.method ?? "—"}${e.payment.viaPayroll ? " (with payroll)" : ""}` },
                      ...(e.payment.reference ? [{ label: "Reference", value: e.payment.reference }] : []),
                      ...(e.payment.byName ? [{ label: "Recorded by", value: e.payment.byName }] : []),
                    ]}
                  />
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="History" />
            <CardBody>
              <Timeline items={timeline} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}
