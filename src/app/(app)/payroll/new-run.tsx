"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { createPayrollRun } from "./actions";

export function NewRunDialog({ defaultPeriod, maxPeriod }: { defaultPeriod: string; maxPeriod: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title="Create payroll run"
      description="Payslips are calculated from salary structures, attendance, approved leave, advances and approved reimbursements. Only one active run is allowed per month and kind."
      trigger={
        <Button icon={<Plus className="size-4" aria-hidden />}>New run</Button>
      }
    >
      <ActionForm
        action={createPayrollRun}
        successMessage="Run created"
        refresh={false}
        onSuccess={(d) => {
          setOpen(false);
          if (d.skipped.length > 0) toast.info(`${d.skipped.length} ${d.skipped.length === 1 ? "person was" : "people were"} skipped: ${d.skipped.slice(0, 3).join(", ")}${d.skipped.length > 3 ? "…" : ""}`, { duration: 10000 });
          router.push(`/payroll/${d.id}`);
        }}
      >
        <FormGrid>
          <Field label="Month" name="period" required>
            <Input id="period" name="period" type="month" max={maxPeriod} defaultValue={defaultPeriod} />
          </Field>
          <Field label="Kind" name="kind" required>
            <Select id="kind" name="kind" defaultValue="salary">
              <option value="salary">Salary (employees)</option>
              <option value="stipend">Stipend (interns &amp; trainees)</option>
            </Select>
          </Field>
        </FormGrid>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Create run</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
