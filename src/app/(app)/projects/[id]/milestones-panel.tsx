"use client";

import { useState } from "react";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Chip, StatusChip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { statusLabel, statusTone } from "@/lib/status";
import { advanceMilestone, deleteMilestone, saveMilestone } from "../actions";

export interface MilestoneView {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  dueLabel: string;
  status: string;
  /** Effective status: overdue undelivered milestones are shown as delayed. */
  displayStatus: string;
  amount?: number;
  amountLabel?: string;
  deliveredLabel?: string;
  clientReviewNote: string;
  approvedBy: string;
  releaseNotes: string;
  deliveredAt: string;
  invoiceLabel?: string;
  invoiceStatus?: string;
  /** Label of the next step in the flow, if any. */
  nextLabel?: string;
}

const FLOW = ["pending", "in_progress", "client_review", "approved", "delivered"];

function MilestoneForm({ projectId, milestone, showAmount, onDone }: { projectId: string; milestone?: MilestoneView; showAmount: boolean; onDone: () => void }) {
  const delayed = milestone?.status === "delayed";
  return (
    <ActionForm action={(input) => saveMilestone(projectId, milestone?.id, input)} successMessage={milestone ? "Milestone saved" : "Milestone added"} onSuccess={onDone}>
      <FormGrid>
        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={milestone?.title} maxLength={200} autoComplete="off" />
        </Field>
        <Field label="Due date" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={milestone?.dueDate} />
        </Field>
        <Field label="Status" name="status" required>
          <Select id="status" name="status" defaultValue={milestone?.status ?? "pending"}>
            {FLOW.map((s) => (
              <option key={s} value={s}>
                {statusLabel("milestone", s)}
              </option>
            ))}
            {delayed && <option value="delayed">{statusLabel("milestone", "delayed")}</option>}
          </Select>
        </Field>
        {showAmount && (
          <Field label="Billing amount (₹)" name="amount" hint={milestone?.invoiceLabel ? `Invoiced: ${milestone.invoiceLabel}` : "Billed when the milestone is reached"}>
            <Input id="amount" name="amount" type="number" inputMode="decimal" min={0} step="1" defaultValue={milestone?.amount} />
          </Field>
        )}
        <Field label="Delivered on" name="deliveredAt" hint="Used when the status is Delivered (defaults to today)">
          <Input id="deliveredAt" name="deliveredAt" type="date" defaultValue={milestone?.deliveredAt} />
        </Field>
        <Field label="Description" name="description" className="sm:col-span-2">
          <Textarea id="description" name="description" rows={2} defaultValue={milestone?.description} />
        </Field>
        <Field label="Client review note" name="clientReviewNote" className="sm:col-span-2">
          <Textarea id="clientReviewNote" name="clientReviewNote" rows={2} defaultValue={milestone?.clientReviewNote} placeholder="Feedback or sign-off from the client" />
        </Field>
        <Field label="Approved by" name="approvedBy" hint="Client contact who approved (defaults to you)">
          <Input id="approvedBy" name="approvedBy" defaultValue={milestone?.approvedBy} maxLength={200} />
        </Field>
        <Field label="Release notes" name="releaseNotes" className="sm:col-span-2">
          <Textarea id="releaseNotes" name="releaseNotes" rows={3} defaultValue={milestone?.releaseNotes} />
        </Field>
      </FormGrid>
      <FormActions>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton>{milestone ? "Save milestone" : "Add milestone"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

function EditMilestone({ projectId, milestone, showAmount }: { projectId: string; milestone: MilestoneView; showAmount: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title="Edit milestone"
      trigger={
        <Button variant="secondary" size="sm" icon={<Pencil className="size-3.5" aria-hidden />}>
          Edit
        </Button>
      }
    >
      <MilestoneForm projectId={projectId} milestone={milestone} showAmount={showAmount} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function AddMilestone({ projectId, showAmount }: { projectId: string; showAmount: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title="New milestone"
      trigger={
        <Button size="sm" icon={<Plus className="size-4" aria-hidden />}>
          Milestone
        </Button>
      }
    >
      <MilestoneForm projectId={projectId} showAmount={showAmount} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

/** Milestone register: status flow, delivery tracking, client review and release notes. */
export function MilestonesPanel({ projectId, milestones, canManage, showAmount }: { projectId: string; milestones: MilestoneView[]; canManage: boolean; showAmount: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-semibold">Milestones</h2>
        {canManage && <AddMilestone projectId={projectId} showAmount={showAmount} />}
      </div>
      {milestones.length === 0 && (
        <Card>
          <CardBody className="py-10 text-center text-sm text-muted">No milestones yet. Add the delivery points agreed with the client.</CardBody>
        </Card>
      )}
      {milestones.map((m) => (
        <Card key={m.id}>
          <CardBody className="flex flex-col gap-3 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-sans text-[15px] font-semibold text-ink">{m.title}</h3>
                <p className="mt-0.5 text-[13px] text-muted">
                  Due {m.dueLabel}
                  {m.deliveredLabel ? ` · Delivered ${m.deliveredLabel}` : ""}
                  {m.amountLabel ? ` · ${m.amountLabel}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {m.invoiceStatus && <StatusChip domain="invoice" value={m.invoiceStatus} size="sm" />}
                {!m.invoiceStatus && showAmount && m.amount ? <Chip tone="gray" size="sm">Not invoiced</Chip> : null}
                <Chip tone={statusTone("milestone", m.displayStatus)}>{statusLabel("milestone", m.displayStatus)}</Chip>
              </div>
            </div>
            {m.description && <p className="text-sm whitespace-pre-line text-ink-2">{m.description}</p>}
            {(m.clientReviewNote || m.approvedBy || m.releaseNotes) && (
              <dl className="grid gap-3 rounded-xl bg-field p-3.5 text-[13px] sm:grid-cols-2">
                {m.clientReviewNote && (
                  <div>
                    <dt className="text-xs font-semibold text-muted">Client review</dt>
                    <dd className="mt-0.5 whitespace-pre-line text-ink-2">{m.clientReviewNote}</dd>
                  </div>
                )}
                {m.approvedBy && (
                  <div>
                    <dt className="text-xs font-semibold text-muted">Approved by</dt>
                    <dd className="mt-0.5 text-ink-2">{m.approvedBy}</dd>
                  </div>
                )}
                {m.releaseNotes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-muted">Release notes</dt>
                    <dd className="mt-0.5 whitespace-pre-line text-ink-2">{m.releaseNotes}</dd>
                  </div>
                )}
              </dl>
            )}
            {canManage && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                {m.nextLabel && (
                  <ActionButton action={() => advanceMilestone(projectId, m.id)} size="sm" icon={<ArrowRight className="size-3.5" aria-hidden />} successMessage="Milestone updated">
                    Move to {m.nextLabel}
                  </ActionButton>
                )}
                <EditMilestone projectId={projectId} milestone={m} showAmount={showAmount} />
                <ActionButton
                  action={() => deleteMilestone(projectId, m.id)}
                  variant="danger-outline"
                  size="sm"
                  icon={<Trash2 className="size-3.5" aria-hidden />}
                  confirm={`Remove the milestone “${m.title}”?`}
                  successMessage="Milestone removed"
                >
                  Remove
                </ActionButton>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
