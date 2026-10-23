"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, RefreshCw } from "lucide-react";
import { ReasonAction } from "@/components/ui/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { renewContract, terminateContract } from "./actions";

function RenewDialog({ id, defaults }: { id: string; defaults: { start: string; end: string; value: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      trigger={
        <Button icon={<RefreshCw className="size-4" aria-hidden />}>Renew</Button>
      }
      title="Renew contract"
      description="Creates the next term as a new contract linked to this one. This contract is marked as renewed."
    >
      <ActionForm
        action={(input) => renewContract(id, input)}
        successMessage="Contract renewed"
        refresh={false}
        onSuccess={(d) => {
          setOpen(false);
          router.push(`/contracts/${d.id}`);
        }}
      >
        <FormGrid>
          <Field label="New start date" name="startDate" required>
            <Input id="renew-start" name="startDate" type="date" defaultValue={defaults.start} />
          </Field>
          <Field label="New end date" name="endDate" required>
            <Input id="renew-end" name="endDate" type="date" defaultValue={defaults.end} />
          </Field>
        </FormGrid>
        <Field label="Contract value (₹)" name="value">
          <Input id="renew-value" name="value" type="number" inputMode="decimal" min={0} step="any" defaultValue={defaults.value} />
        </Field>
        <Field label="Notes" name="notes">
          <Textarea id="renew-notes" name="notes" rows={2} placeholder="Optional — what changed in this term" />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Renew contract</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** Edit / renew / terminate for a contract (contracts.manage). */
export function ContractActions({ id, status, defaults }: { id: string; status: string; defaults: { start: string; end: string; value: string } }) {
  return (
    <>
      <ButtonLink href={`/contracts/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />}>
        Edit
      </ButtonLink>
      {(status === "draft" || status === "active") && (
        <ReasonAction
          action={(reason) => terminateContract(id, reason)}
          title="Terminate contract"
          description="Ends the contract early. This can't be undone."
          label="Reason"
          placeholder="Why is the contract being terminated?"
          confirmLabel="Terminate"
          confirmVariant="danger"
          successMessage="Contract terminated"
          trigger={<Button variant="danger-outline">Terminate</Button>}
        />
      )}
      {(status === "active" || status === "expired") && <RenewDialog id={id} defaults={defaults} />}
    </>
  );
}
