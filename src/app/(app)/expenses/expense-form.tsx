"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Radio, Select, Textarea } from "@/components/ui/input";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { saveExpense } from "./actions";
import { EXPENSE_PAYMENT_MODES } from "./constants";

export interface ExpenseFormInitial {
  id?: string;
  date: string;
  category: string;
  amount: string;
  taxAmount: string;
  vendor: string;
  description: string;
  project: string;
  client: string;
  department: string;
  type: "reimbursable" | "company";
  paymentMode: string;
  receipts: UploadedFile[];
}

export function ExpenseForm({
  initial,
  categories,
  projects,
  clients,
  departments,
  today,
}: {
  initial: ExpenseFormInitial;
  categories: string[];
  projects: { id: string; label: string }[];
  /** null when the user cannot see clients. */
  clients: { id: string; label: string }[] | null;
  departments: { id: string; label: string }[];
  today: string;
}) {
  const router = useRouter();
  const [intent, setIntent] = useState<"draft" | "submit">("draft");
  // Keep a category that was removed from settings selectable so old expenses stay editable.
  const categoryOptions = categories.includes(initial.category) || !initial.category ? categories : [initial.category, ...categories];

  return (
    <ActionForm
      action={saveExpense}
      values={{ id: initial.id, intent }}
      onSuccess={(d) => router.push(`/expenses/${d.id}`)}
      refresh={false}
      successMessage={intent === "submit" ? "Submitted for approval" : "Draft saved"}
      className="gap-5"
    >
      <Card>
        <CardHeader title="Expense details" subtitle="Amount is the total paid including tax." />
        <CardBody className="flex flex-col gap-4">
          <FormGrid>
            <Field label="Date" name="date" required>
              <Input id="date" name="date" type="date" max={today} defaultValue={initial.date} />
            </Field>
            <Field label="Category" name="category" required>
              <Select id="category" name="category" defaultValue={initial.category}>
                <option value="">Select category</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount (₹)" name="amount" required>
              <Input id="amount" name="amount" type="number" inputMode="decimal" min={0.01} step="0.01" defaultValue={initial.amount} />
            </Field>
            <Field label="Of which tax (₹)" name="taxAmount" hint="GST or other tax included in the amount.">
              <Input id="taxAmount" name="taxAmount" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={initial.taxAmount} />
            </Field>
            <Field label="Vendor" name="vendor">
              <Input id="vendor" name="vendor" defaultValue={initial.vendor} maxLength={150} />
            </Field>
            <Field label="Payment mode" name="paymentMode">
              <Select id="paymentMode" name="paymentMode" defaultValue={initial.paymentMode}>
                <option value="">Not specified</option>
                {EXPENSE_PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <Field label="Description" name="description" required>
            <Textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={initial.description} placeholder="What was this for?" />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-semibold text-ink-2">Who paid</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Radio name="type" value="reimbursable" defaultChecked={initial.type === "reimbursable"} label="I paid — reimburse me" />
              <Radio name="type" value="company" defaultChecked={initial.type === "company"} label="Paid by the company" />
            </div>
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Allocation" subtitle="Optional — helps with project and department cost reports." />
        <CardBody>
          <FormGrid cols={3}>
            <Field label="Project" name="project">
              <Select id="project" name="project" defaultValue={initial.project}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            {clients && (
              <Field label="Client" name="client">
                <Select id="client" name="client" defaultValue={initial.client}>
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Department" name="department">
              <Select id="department" name="department" defaultValue={initial.department}>
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Receipts" subtitle="Attach the bill or invoice. Approvers can see them." />
        <CardBody>
          <FileUpload name="receipts" context={{ entityType: "expense" }} initial={initial.receipts} label="Attach receipts" />
        </CardBody>
      </Card>

      <FormActions>
        <Link href={initial.id ? `/expenses/${initial.id}` : "/expenses"} className={buttonClass("ghost")}>
          Cancel
        </Link>
        <SubmitButton variant="secondary" onClick={() => flushSync(() => setIntent("draft"))}>
          Save draft
        </SubmitButton>
        <SubmitButton onClick={() => flushSync(() => setIntent("submit"))}>Submit for approval</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
