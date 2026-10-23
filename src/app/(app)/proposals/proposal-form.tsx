"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton, useFormState } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import { createProposal, updateProposal } from "./actions";
import { computeTotals, percentSum, scheduleAmounts } from "./_lib/calc";

interface ItemState {
  description: string;
  quantity: string;
  rate: string;
  taxRate: string;
}

interface MilestoneState {
  title: string;
  percent: string;
  dueOn: string;
}

export interface ProposalFormInitial {
  id?: string;
  kind: "proposal" | "quotation";
  title: string;
  client: string;
  lead: string;
  summary: string;
  scope: string;
  deliverables: string;
  timeline: string;
  startDate: string;
  endDate: string;
  items: ItemState[];
  discount: string;
  milestones: MilestoneState[];
  terms: string;
  validUntil: string;
}

const GRID = "sm:grid-cols-[minmax(0,1fr)_84px_120px_150px_120px_36px]";

const n = (v: string) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Form-level error for a field that has no input of its own (line items, milestone total). */
function ErrorText({ name }: { name: string }) {
  const { errors } = useFormState();
  return errors[name] ? <p className="text-xs font-medium text-danger">{errors[name]}</p> : null;
}

export function ProposalForm({
  mode,
  initial,
  clients,
  taxes,
  defaultTaxRate,
  clientLocked = false,
  leadCompany,
  editingSent = false,
}: {
  mode: "create" | "edit";
  initial: ProposalFormInitial;
  clients: { id: string; name: string; clientNo: string }[];
  taxes: { name: string; rate: number }[];
  defaultTaxRate: number;
  clientLocked?: boolean;
  /** Company of a lead that isn't a client yet — a client is created from it on save. */
  leadCompany?: string;
  /** Editing a proposal the client has already seen: the previous version is kept in history. */
  editingSent?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ItemState[]>(initial.items);
  const [milestones, setMilestones] = useState<MilestoneState[]>(initial.milestones);
  const [discount, setDiscount] = useState(initial.discount);

  const totals = computeTotals(
    items.map((i) => ({ description: i.description, quantity: n(i.quantity), rate: n(i.rate), taxRate: n(i.taxRate) })),
    n(discount),
  );
  const percents = milestones.map((m) => n(m.percent));
  const sum = percentSum(percents);
  const amounts = scheduleAmounts(totals.total, percents);
  const taxOptions = (rate: string) => (taxes.some((t) => String(t.rate) === rate) ? taxes : [...taxes, { name: `${rate}%`, rate: n(rate) }]);

  const setItem = (i: number, patch: Partial<ItemState>) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const setMilestone = (i: number, patch: Partial<MilestoneState>) => setMilestones((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  return (
    <ActionForm<{ id: string }>
      action={(input) => (mode === "create" ? createProposal(input) : updateProposal(initial.id as string, input))}
      values={{
        lead: initial.lead,
        items,
        discount,
        paymentMilestones: milestones.map((m) => ({ title: m.title, percent: m.percent, dueOn: m.dueOn })),
      }}
      successMessage="Proposal saved"
      refresh={false}
      onSuccess={(d) => router.push(`/proposals/${d.id}`)}
      className="gap-4"
    >
      <Card>
        <CardBody className="pt-5">
          <FormSection title="Basics">
            <FormGrid>
              <Field label="Type" name="kind" required>
                <Select id="kind" name="kind" defaultValue={initial.kind}>
                  <option value="proposal">Proposal</option>
                  <option value="quotation">Quotation</option>
                </Select>
              </Field>
              <Field label="Client" name="client" required={!leadCompany} hint={clientLocked ? "The client can't be changed once the proposal has been sent." : undefined}>
                <Select id="client" name="client" defaultValue={initial.client} disabled={clientLocked}>
                  <option value="">{leadCompany ? `Create client “${leadCompany}” from the lead` : "Choose a client…"}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.clientNo}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title" name="title" required className="sm:col-span-2">
                <Input id="title" name="title" defaultValue={initial.title} maxLength={200} />
              </Field>
              <Field label="Valid until" name="validUntil" required hint="After this date a sent proposal expires automatically.">
                <Input id="validUntil" name="validUntil" type="date" defaultValue={initial.validUntil} />
              </Field>
            </FormGrid>
          </FormSection>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-5">
          <FormSection title="Scope & deliverables">
            <Field label="Summary" name="summary">
              <Textarea id="summary" name="summary" rows={3} defaultValue={initial.summary} maxLength={5000} />
            </Field>
            <Field label="Scope" name="scope">
              <Textarea id="scope" name="scope" rows={5} defaultValue={initial.scope} maxLength={20000} />
            </Field>
            <Field label="Deliverables" name="deliverables" hint="One deliverable per line.">
              <Textarea id="deliverables" name="deliverables" rows={5} defaultValue={initial.deliverables} />
            </Field>
            <FormGrid cols={3}>
              <Field label="Timeline" name="timeline" className="sm:col-span-3 lg:col-span-1">
                <Input id="timeline" name="timeline" defaultValue={initial.timeline} placeholder="e.g. 11 weeks from kickoff" maxLength={2000} />
              </Field>
              <Field label="Start date" name="startDate">
                <Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} />
              </Field>
              <Field label="End date" name="endDate">
                <Input id="endDate" name="endDate" type="date" defaultValue={initial.endDate} />
              </Field>
            </FormGrid>
          </FormSection>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-5">
          <FormSection title="Costing" description="Amount = quantity × rate. Tax is charged on the value after discount.">
            <ErrorText name="items" />
            <div className="flex flex-col gap-3">
              <div className={cn("hidden gap-2 px-0.5 text-xs font-semibold text-muted sm:grid", GRID)} aria-hidden>
                <span>Description</span>
                <span>Qty</span>
                <span>Rate (₹)</span>
                <span>Tax</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              {items.map((it, i) => (
                <div key={i} className={cn("grid grid-cols-3 gap-2 rounded-xl border border-line p-3 sm:items-start sm:rounded-none sm:border-0 sm:p-0", GRID)}>
                  <div className="col-span-3 sm:col-span-1">
                    <Field name={`items.${i}.description`}>
                      <Input aria-label={`Line ${i + 1} description`} placeholder="Description" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} maxLength={500} />
                    </Field>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-semibold text-muted sm:hidden">Qty</span>
                    <Field name={`items.${i}.quantity`}>
                      <Input aria-label={`Line ${i + 1} quantity`} type="number" inputMode="decimal" min={0} step="any" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} />
                    </Field>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-semibold text-muted sm:hidden">Rate (₹)</span>
                    <Field name={`items.${i}.rate`}>
                      <Input aria-label={`Line ${i + 1} rate`} type="number" inputMode="decimal" min={0} step="any" value={it.rate} onChange={(e) => setItem(i, { rate: e.target.value })} />
                    </Field>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-semibold text-muted sm:hidden">Tax</span>
                    <Field name={`items.${i}.taxRate`}>
                      <Select aria-label={`Line ${i + 1} tax`} value={it.taxRate} onChange={(e) => setItem(i, { taxRate: e.target.value })}>
                        {taxOptions(it.taxRate).map((t) => (
                          <option key={t.rate} value={String(t.rate)}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="col-span-2 flex h-11 items-center justify-between text-sm font-semibold text-ink tabular sm:col-span-1 sm:h-10 sm:justify-end">
                    <span className="text-xs font-semibold text-muted sm:hidden">Amount</span>
                    {inr(totals.items[i]?.amount ?? 0, true)}
                  </div>
                  <div className="col-span-1 flex justify-end sm:col-span-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove line ${i + 1}`} disabled={items.length === 1} onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" className="self-start" icon={<Plus className="size-4" aria-hidden />} onClick={() => setItems((prev) => [...prev, { description: "", quantity: "1", rate: "", taxRate: String(defaultTaxRate) }])}>
              Add line item
            </Button>

            <dl className="ml-auto grid w-full max-w-sm gap-1.5 rounded-xl bg-field p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="tabular">{inr(totals.subtotal, true)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">
                  <label htmlFor="discount">Discount (₹)</label>
                </dt>
                <dd className="w-36">
                  <Field name="discount">
                    <Input id="discount" type="number" inputMode="decimal" min={0} step="any" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-9 text-right sm:h-9" />
                  </Field>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Tax</dt>
                <dd className="tabular">{inr(totals.taxTotal, true)}</dd>
              </div>
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="font-display text-lg font-semibold text-ink tabular">{inr(totals.total, true)}</dd>
              </div>
            </dl>
          </FormSection>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-5">
          <FormSection title="Payment milestones" description="Billed as a schedule on the project once the proposal is converted. Percentages must add up to 100.">
            <ErrorText name="paymentMilestones" />
            {milestones.length === 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                No payment milestones — the full amount is billed as agreed.
                <Button
                  variant="link"
                  size="sm"
                  onClick={() =>
                    setMilestones([
                      { title: "On signing", percent: "40", dueOn: "" },
                      { title: "Mid-project handover", percent: "40", dueOn: "" },
                      { title: "Go-live", percent: "20", dueOn: "" },
                    ])
                  }
                >
                  Use 40 / 40 / 20
                </Button>
              </div>
            )}
            {milestones.map((m, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_100px_160px_130px_36px] sm:items-start sm:rounded-none sm:border-0 sm:p-0">
                <div className="col-span-2 sm:col-span-1">
                  <Field name={`paymentMilestones.${i}.title`}>
                    <Input aria-label={`Milestone ${i + 1} title`} placeholder="Milestone title" value={m.title} onChange={(e) => setMilestone(i, { title: e.target.value })} maxLength={200} />
                  </Field>
                </div>
                <Field name={`paymentMilestones.${i}.percent`}>
                  <Input aria-label={`Milestone ${i + 1} percent`} type="number" inputMode="decimal" min={0} max={100} step="any" placeholder="%" value={m.percent} onChange={(e) => setMilestone(i, { percent: e.target.value })} />
                </Field>
                <Field name={`paymentMilestones.${i}.dueOn`}>
                  <Input aria-label={`Milestone ${i + 1} due date`} type="date" value={m.dueOn} onChange={(e) => setMilestone(i, { dueOn: e.target.value })} />
                </Field>
                <div className="flex h-11 items-center justify-end text-sm font-semibold text-ink tabular sm:h-10">{inr(amounts[i] ?? 0, true)}</div>
                <div className="flex justify-end">
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove milestone ${i + 1}`} onClick={() => setMilestones((prev) => prev.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setMilestones((prev) => [...prev, { title: "", percent: "", dueOn: "" }])}>
                Add milestone
              </Button>
              {milestones.length > 0 && (
                <span className={cn("text-[13px] font-semibold tabular", Math.abs(sum - 100) <= 0.01 ? "text-success" : "text-warning")} role="status">
                  {sum}% of 100% allocated
                </span>
              )}
            </div>
          </FormSection>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-5">
          <FormSection title="Terms">
            <Field label="Terms & conditions" name="terms">
              <Textarea id="terms" name="terms" rows={5} defaultValue={initial.terms} maxLength={20000} />
            </Field>
            {editingSent && (
              <Field label="What changed? (optional)" name="revisionNote" hint="Saved with the previous version in the revision history.">
                <Input id="revisionNote" name="revisionNote" maxLength={500} placeholder="e.g. Reduced phase 1 scope, 4% discount" />
              </Field>
            )}
          </FormSection>
          <FormActions className="mt-4">
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <SubmitButton>{mode === "create" ? "Save draft" : editingSent ? "Save as new version" : "Save changes"}</SubmitButton>
          </FormActions>
        </CardBody>
      </Card>
    </ActionForm>
  );
}

