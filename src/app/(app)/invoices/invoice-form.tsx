"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton, useFormState } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { TaxRate } from "@/lib/config-defaults";
import { inr } from "@/lib/format";
import { addDays, fmtDate } from "@/lib/time";
import { saveInvoice } from "./actions";
import { computeTotals, CUSTOM_TERM } from "./totals";

export interface ClientOption {
  id: string;
  name: string;
  clientNo: string;
  state?: string;
}

export interface MilestoneOption {
  id: string;
  title: string;
  amount: number;
}

export interface ProjectOption {
  id: string;
  client: string;
  label: string;
  contract?: string;
  milestones: MilestoneOption[];
}

export interface ContractOption {
  id: string;
  client: string;
  label: string;
}

export interface InvoiceFormInitial {
  id?: string;
  client: string;
  project: string;
  contract: string;
  milestone: string;
  issueDate: string;
  paymentTerm: string;
  dueDate: string;
  discount: string;
  placeOfSupply: string;
  notes: string;
  terms: string;
  /** `tax` is the Settings tax name ("" on lines saved before names were kept: `taxRate` / `taxSplit` then describe it). */
  items: { description: string; quantity: string; rate: string; tax: string; taxRate?: number; taxSplit?: boolean }[];
}

interface Line {
  description: string;
  quantity: string;
  rate: string;
  /** Name of the chosen tax option. */
  tax: string;
}

/** A tax a draft line was saved with that Settings no longer offers; `legacy` when it predates tax names. */
type TaxOption = TaxRate & { legacy?: boolean };

/** Tax choices for the line selects: Settings → Taxes plus any tax a saved line still uses, so editing never changes it silently. */
function taxChoices(taxes: TaxRate[], items: InvoiceFormInitial["items"]): { options: TaxOption[]; keys: string[] } {
  const options: TaxOption[] = [...taxes];
  const keys = items.map((it) => {
    if (it.tax && taxes.some((t) => t.name === it.tax)) return it.tax;
    const rate = it.taxRate ?? 0;
    const none = taxes.find((t) => t.rate === 0);
    if (!it.tax && rate === 0 && none) return none.name;
    const name = it.tax || `${rate}%`;
    if (!options.some((o) => o.name === name)) options.push({ name, rate, split: it.taxSplit, legacy: !it.tax });
    return name;
  });
  return { options, keys };
}

export function InvoiceForm({
  initial,
  clients,
  projects,
  contracts,
  taxes,
  paymentTerms,
}: {
  initial: InvoiceFormInitial;
  clients: ClientOption[];
  projects: ProjectOption[];
  /** null when the user cannot see contracts. */
  contracts: ContractOption[] | null;
  taxes: TaxRate[];
  paymentTerms: { label: string; days: number }[];
}) {
  const router = useRouter();
  const defaultTax = (taxes.find((t) => t.rate > 0) ?? taxes[0]).name;
  const [choices] = useState(() => taxChoices(taxes, initial.items));
  const taxOf = (name: string): TaxOption => choices.options.find((o) => o.name === name) ?? choices.options[0];
  const lineItem = (l: Line) => {
    const t = taxOf(l.tax);
    return { description: l.description, quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0, taxRate: t.rate, taxName: t.legacy ? undefined : t.name, taxSplit: Boolean(t.split) };
  };
  const [client, setClient] = useState(initial.client);
  const [project, setProject] = useState(initial.project);
  const [contract, setContract] = useState(initial.contract);
  const [milestone, setMilestone] = useState(initial.milestone);
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [term, setTerm] = useState(initial.paymentTerm);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [discount, setDiscount] = useState(initial.discount);
  const [placeOfSupply, setPlaceOfSupply] = useState(initial.placeOfSupply);
  const [lines, setLines] = useState<Line[]>(() =>
    initial.items.length ? initial.items.map((it, i) => ({ description: it.description, quantity: it.quantity, rate: it.rate, tax: choices.keys[i] })) : [{ description: "", quantity: "1", rate: "", tax: defaultTax }],
  );

  const clientProjects = projects.filter((p) => p.client === client);
  const clientContracts = (contracts ?? []).filter((c) => c.client === client);
  const selectedProject = clientProjects.find((p) => p.id === project);
  const milestones = selectedProject?.milestones ?? [];

  const totals = computeTotals(lines.map(lineItem), Number(discount) || 0);
  const termDays = term === CUSTOM_TERM ? null : Number(term);
  const computedDue = termDays !== null && issueDate ? addDays(issueDate, termDays) : null;

  const updateLine = (index: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  function pickClient(id: string) {
    setClient(id);
    setProject("");
    setContract("");
    setMilestone("");
    if (!placeOfSupply) setPlaceOfSupply(clients.find((c) => c.id === id)?.state ?? "");
  }

  function pickProject(id: string) {
    setProject(id);
    setMilestone("");
    const p = clientProjects.find((x) => x.id === id);
    if (p?.contract && clientContracts.some((c) => c.id === p.contract)) setContract(p.contract);
  }

  function pickMilestone(id: string) {
    setMilestone(id);
    const m = milestones.find((x) => x.id === id);
    if (!m) return;
    const line: Line = { description: m.title, quantity: "1", rate: m.amount ? String(m.amount) : "", tax: defaultTax };
    setLines((ls) => (ls.length === 1 && !ls[0].description && !ls[0].rate ? [line] : [...ls, line]));
  }

  return (
    <ActionForm
      action={saveInvoice}
      values={{
        id: initial.id,
        items: lines.map(lineItem),
      }}
      onSuccess={(d) => router.push(`/invoices/${d.id}`)}
      successMessage="Draft saved"
      refresh={false}
      className="gap-5"
    >
      <Card>
        <CardHeader title="Billing details" subtitle="Who is being billed and what the invoice relates to." />
        <CardBody>
          <FormGrid>
            <Field label="Client" name="client" required>
              <Select id="client" name="client" value={client} onChange={(e) => pickClient(e.target.value)}>
                <option value="">Select client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.clientNo}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Project" name="project" hint={client && clientProjects.length === 0 ? "This client has no projects yet." : undefined}>
              <Select id="project" name="project" value={project} onChange={(e) => pickProject(e.target.value)} disabled={!client}>
                <option value="">No project</option>
                {clientProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            {contracts && (
              <Field label="Contract" name="contract">
                <Select id="contract" name="contract" value={contract} onChange={(e) => setContract(e.target.value)} disabled={!client}>
                  <option value="">No contract</option>
                  {clientContracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Milestone" name="milestone" hint={project && milestones.length === 0 ? "No un-invoiced milestones on this project." : "Picking one adds a line with its title and amount."}>
              <Select id="milestone" name="milestone" value={milestone} onChange={(e) => pickMilestone(e.target.value)} disabled={!project}>
                <option value="">No milestone</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                    {m.amount ? ` · ${inr(m.amount)}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Issue date" name="issueDate" required>
              <Input id="issueDate" name="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </Field>
            <Field
              label="Payment term"
              name="paymentTerm"
              required
              hint={computedDue ? `Due on ${fmtDate(computedDue)}` : undefined}
            >
              <Select id="paymentTerm" name="paymentTerm" value={term} onChange={(e) => setTerm(e.target.value)}>
                {paymentTerms.map((t, i) => (
                  <option key={i} value={String(t.days)}>
                    {t.label}
                  </option>
                ))}
                <option value={CUSTOM_TERM}>Custom due date</option>
              </Select>
            </Field>
            {term === CUSTOM_TERM && (
              <Field label="Due date" name="dueDate" required>
                <Input id="dueDate" name="dueDate" type="date" value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            )}
            <Field label="Place of supply" name="placeOfSupply" hint="State used for GST, e.g. Kerala.">
              <Input id="placeOfSupply" name="placeOfSupply" value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} maxLength={100} />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Line items"
          subtitle="Amounts are before tax. Totals are recalculated on the server when you save."
          action={
            <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, { description: "", quantity: "1", rate: "", tax: defaultTax }])}>
              Add line
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-4">
          <LineEditor lines={lines} computed={totals.items.map((i) => i.amount)} onChange={updateLine} onRemove={(i) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))} taxes={choices.options} />

          <div className="grid gap-5 border-t border-line-soft pt-4 xl:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">
              <Field label="Notes" name="notes">
                <Textarea id="notes" name="notes" defaultValue={initial.notes} rows={3} maxLength={2000} />
              </Field>
              <Field label="Terms" name="terms">
                <Textarea id="terms" name="terms" defaultValue={initial.terms} rows={3} maxLength={4000} />
              </Field>
            </div>
            <dl className="flex flex-col gap-2 self-start rounded-xl bg-field p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="tabular">{inr(totals.subtotal, true)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">
                  <label htmlFor="discount">Discount (₹)</label>
                </dt>
                <dd className="w-32">
                  <DiscountInput value={discount} onChange={setDiscount} />
                </dd>
              </div>
              {totals.taxLines.map((t) => (
                <div key={t.label} className="flex justify-between">
                  <dt className="text-muted">{t.label}</dt>
                  <dd className="tabular">{inr(t.amount, true)}</dd>
                </div>
              ))}
              {totals.taxLines.length === 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">Tax</dt>
                  <dd className="tabular">{inr(0, true)}</dd>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-line pt-3 text-[15px] font-bold text-ink">
                <dt>Total</dt>
                <dd className="tabular">{inr(totals.total, true)}</dd>
              </div>
            </dl>
          </div>
        </CardBody>
      </Card>

      <FormActions>
        <Link href={initial.id ? `/invoices/${initial.id}` : "/invoices"} className={buttonClass("secondary")}>
          Cancel
        </Link>
        <SubmitButton>Save draft</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

function DiscountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { errors } = useFormState();
  return (
    <>
      <Input id="discount" name="discount" type="number" inputMode="decimal" min={0} step="0.01" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 text-right" aria-invalid={Boolean(errors.discount)} />
      {errors.discount && <p className="mt-1 text-xs font-medium text-danger">{errors.discount}</p>}
    </>
  );
}

function LineEditor({
  lines,
  computed,
  onChange,
  onRemove,
  taxes,
}: {
  lines: Line[];
  computed: number[];
  onChange: (index: number, patch: Partial<Line>) => void;
  onRemove: (index: number) => void;
  taxes: TaxOption[];
}) {
  const { errors } = useFormState();
  const err = (i: number, key: string) => errors[`items.${i}.${key}`];
  return (
    <div className="flex flex-col gap-3">
      {errors.items && <p className="text-xs font-medium text-danger">{errors.items}</p>}
      <div className="hidden grid-cols-[minmax(0,1fr)_76px_112px_180px_110px_36px] gap-2 px-1 text-xs font-semibold text-muted md:grid">
        <span>Description</span>
        <span>Qty</span>
        <span>Rate (₹)</span>
        <span>Tax</span>
        <span className="text-right">Amount</span>
        <span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-line-soft p-3 md:grid-cols-[minmax(0,1fr)_76px_112px_180px_110px_36px] md:items-start md:border-0 md:p-0">
          <div className="col-span-2 md:col-span-1">
            <Input aria-label={`Line ${i + 1} description`} placeholder="Description" value={l.description} onChange={(e) => onChange(i, { description: e.target.value })} maxLength={500} aria-invalid={Boolean(err(i, "description"))} />
            {err(i, "description") && <p className="mt-1 text-xs font-medium text-danger">{err(i, "description")}</p>}
          </div>
          <div>
            <Input aria-label={`Line ${i + 1} quantity`} type="number" inputMode="decimal" min={0} step="0.01" value={l.quantity} onChange={(e) => onChange(i, { quantity: e.target.value })} aria-invalid={Boolean(err(i, "quantity"))} />
            {err(i, "quantity") && <p className="mt-1 text-xs font-medium text-danger">{err(i, "quantity")}</p>}
          </div>
          <div>
            <Input aria-label={`Line ${i + 1} rate`} type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={l.rate} onChange={(e) => onChange(i, { rate: e.target.value })} aria-invalid={Boolean(err(i, "rate"))} />
            {err(i, "rate") && <p className="mt-1 text-xs font-medium text-danger">{err(i, "rate")}</p>}
          </div>
          <div>
            <Select aria-label={`Line ${i + 1} tax`} value={l.tax} onChange={(e) => onChange(i, { tax: e.target.value })}>
              {taxes.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex h-10 items-center justify-end text-sm font-semibold text-ink tabular">{inr(computed[i] ?? 0, true)}</div>
          <button
            type="button"
            aria-label={`Remove line ${i + 1}`}
            disabled={lines.length === 1}
            onClick={() => onRemove(i)}
            className="flex size-10 items-center justify-center justify-self-end rounded-lg text-muted hover:bg-danger-bg hover:text-danger disabled:pointer-events-none disabled:opacity-40 md:size-9"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
