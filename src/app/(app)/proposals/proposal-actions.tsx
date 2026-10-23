"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, Pencil, Send } from "lucide-react";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button, ButtonLink, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/ui/form";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { approveProposal, convertToProject, rejectProposal, reopenProposal, sendProposal, startNegotiation } from "./actions";

function ConvertDialog({ id, people }: { id: string; people: PickerOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      trigger={<Button>Convert to project</Button>}
      title="Convert to project"
      description="Creates the project from this proposal — scope, dates, budget and one milestone per payment milestone. Nothing to re-type."
    >
      <ActionForm
        action={(input) => convertToProject(id, input)}
        successMessage="Project created"
        refresh={false}
        onSuccess={(d) => {
          setOpen(false);
          router.push(`/projects/${d.id}`);
        }}
      >
        <Field label="Project manager" name="manager" required>
          <PeoplePicker name="manager" options={people} allowClear={false} placeholder="Select project manager" />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Create project</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** Header actions for a proposal, driven by its status and the viewer's permissions. */
export function ProposalActions({
  id,
  status,
  hasProject,
  canManage,
  canApprove,
  people,
  pdfHref,
}: {
  id: string;
  status: string;
  hasProject: boolean;
  canManage: boolean;
  canApprove: boolean;
  people: PickerOption[];
  pdfHref: string;
}) {
  const editable = status === "draft" || status === "negotiation";
  const decidable = status === "sent" || status === "negotiation";
  return (
    <>
      <a href={pdfHref} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
        <Download className="size-4" aria-hidden />
        PDF
      </a>
      {canManage && editable && (
        <ButtonLink href={`/proposals/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />}>
          Edit
        </ButtonLink>
      )}
      {canManage && status === "sent" && (
        <ActionButton variant="secondary" action={startNegotiation.bind(null, id)} successMessage="Moved to negotiation" confirm="Move this proposal to negotiation? You'll be able to edit it and send a revised version.">
          Start negotiation
        </ActionButton>
      )}
      {canManage && (status === "rejected" || status === "expired") && (
        <ActionButton variant="secondary" action={reopenProposal.bind(null, id)} successMessage="Proposal reopened" confirm="Reopen this proposal for negotiation so it can be revised and sent again?">
          Reopen
        </ActionButton>
      )}
      {decidable && (canApprove || canManage) && (
        <ReasonAction
          action={(reason) => rejectProposal(id, reason)}
          title="Mark as rejected"
          description="Record that the client declined. The lead stays open so you can revise or follow up."
          label="Reason"
          placeholder="Why was it rejected?"
          confirmLabel="Mark rejected"
          confirmVariant="danger"
          successMessage="Proposal marked rejected"
          trigger={<Button variant="danger-outline">Reject</Button>}
        />
      )}
      {decidable && canApprove && (
        <ReasonAction
          action={(note) => approveProposal(id, note)}
          title="Client accepted"
          description="Approves the proposal and marks the linked lead as won."
          label="Note"
          required={false}
          placeholder="Optional — how and when the client accepted"
          confirmLabel="Approve"
          confirmVariant="success"
          successMessage="Proposal approved"
          trigger={
            <Button variant="success" icon={<Check className="size-4" aria-hidden />}>
              Approve
            </Button>
          }
        />
      )}
      {canManage && editable && (
        <ActionButton
          action={sendProposal.bind(null, id)}
          successMessage="Marked as sent"
          icon={<Send className="size-4" aria-hidden />}
          confirm="Mark this proposal as sent to the client? Make sure you've shared the PDF with them. The linked lead moves to “Proposal sent”."
        >
          Send to client
        </ActionButton>
      )}
      {canApprove && status === "approved" && !hasProject && <ConvertDialog id={id} people={people} />}
    </>
  );
}
