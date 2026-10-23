"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ActionForm, Field, type FormAction } from "@/components/ui/form";
import { Input, Select, Switch } from "@/components/ui/input";
import { Alert } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import type { AppSettings, Tone } from "@/lib/config-defaults";
import { saveDocumentCategories, savePayroll, saveMovement, saveSimpleList, saveTaxesAndTerms } from "./actions";
import { PERSON_TYPE_OPTIONS, TONES } from "./constants";
import { Cell, CGrid, ColHeaders, ListRow, PillCheck, RowTools, SaveRow, SettingsCard, useRows } from "./ui";

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={onClick} className="self-start">
      {label}
    </Button>
  );
}

function NoRows({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">{children}</p>;
}

/* ───────────────────────────── Payroll ───────────────────────────── */

interface PayRow {
  key: string;
  name: string;
  type: "earning" | "deduction";
  calc: "fixed" | "percent_basic";
  value: string;
  cap: string;
  appliesTo: string[];
  active: boolean;
}

const PAY_GRID = "@3xl:grid-cols-[minmax(0,1.6fr)_7.5rem_9rem_6rem_6rem_auto]";

export function PayrollForm({ payroll }: { payroll: AppSettings["payroll"] }) {
  const list = useRows<PayRow>(
    payroll.components.map((c) => ({ key: c.key, name: c.name, type: c.type, calc: c.calc, value: String(c.value), cap: c.cap ? String(c.cap) : "", appliesTo: c.appliesTo, active: c.active })),
  );
  return (
    <SettingsCard title="Payroll & stipend components" description="Earnings and deductions applied when a payroll or stipend run is prepared.">
      <ActionForm action={savePayroll} values={{ components: list.rows }}>
        <Alert tone="warning" title="Review before production use.">
          Statutory deductions and compliance rules (for example PF, ESI, professional tax and TDS) must be reviewed and configured before this module is used for real payroll.
        </Alert>
        <CGrid cols={3}>
          <Field label="Pay day" name="payDay" required hint="Day of the month salaries are paid (1–28).">
            <Input id="payDay" name="payDay" type="number" min={1} max={28} defaultValue={payroll.payDay} />
          </Field>
          <Field label="Loss-of-pay basis" name="lopBasis" required hint="Divisor used to value an unpaid day.">
            <Select id="lopBasis" name="lopBasis" defaultValue={payroll.lopBasis}>
              <option value="working_days">Working days in the month</option>
              <option value="calendar_days">Calendar days in the month</option>
            </Select>
          </Field>
        </CGrid>

        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <ColHeaders template={PAY_GRID} labels={["Component", "Type", "Calculation", "Value", "Monthly cap", ""]} />
          {list.rows.length === 0 && <NoRows>No components yet. Add the allowances and deductions you use.</NoRows>}
          {list.rows.map((row, i) => (
            <ListRow key={i} className="flex flex-col gap-3">
              <div className={cn("grid grid-cols-1 items-end gap-3", PAY_GRID)}>
                <Cell label="Component">
                  <Input aria-label="Component name" value={row.name} maxLength={80} onChange={(e) => list.update(i, { name: e.target.value })} placeholder="e.g. House rent allowance" />
                </Cell>
                <Cell label="Type">
                  <Select aria-label="Type" value={row.type} onChange={(e) => list.update(i, { type: e.target.value as PayRow["type"] })}>
                    <option value="earning">Earning</option>
                    <option value="deduction">Deduction</option>
                  </Select>
                </Cell>
                <Cell label="Calculation">
                  <Select aria-label="Calculation" value={row.calc} onChange={(e) => list.update(i, { calc: e.target.value as PayRow["calc"] })}>
                    <option value="fixed">Fixed amount (₹)</option>
                    <option value="percent_basic">% of basic</option>
                  </Select>
                </Cell>
                <Cell label={row.calc === "fixed" ? "Amount (₹)" : "Percent"}>
                  <Input aria-label="Value" type="number" min={0} step="any" value={row.value} onChange={(e) => list.update(i, { value: e.target.value })} />
                </Cell>
                <Cell label="Monthly cap (₹)">
                  <Input aria-label="Monthly cap" type="number" min={0} step="any" value={row.cap} disabled={row.calc === "fixed"} placeholder={row.calc === "fixed" ? "n/a" : "None"} onChange={(e) => list.update(i, { cap: e.target.value })} />
                </Cell>
                <RowTools index={i} count={list.rows.length} label={row.name || "component"} onMove={(d) => list.move(i, d)} onRemove={() => list.remove(i)} />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted">Applies to</span>
                  {PERSON_TYPE_OPTIONS.map((p) => (
                    <PillCheck
                      key={p.value}
                      label={p.label}
                      className="h-8 text-xs"
                      checked={row.appliesTo.includes(p.value)}
                      onChange={(on) => list.update(i, { appliesTo: on ? [...row.appliesTo, p.value] : row.appliesTo.filter((x) => x !== p.value) })}
                    />
                  ))}
                </div>
                <Switch aria-label="Active" checked={row.active} onChange={(e) => list.update(i, { active: e.target.checked })} label="Active" />
              </div>
            </ListRow>
          ))}
          <AddRow label="Add component" onClick={() => list.add({ key: "", name: "", type: "earning", calc: "fixed", value: "0", cap: "", appliesTo: ["employee"], active: true })} />
        </div>
        <SaveRow dirty={list.dirty} />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Movement ───────────────────────────── */

interface MoveRow {
  key: string;
  label: string;
  official: boolean;
  requiresApproval: boolean;
  active: boolean;
}

const MOVE_GRID = "@3xl:grid-cols-[minmax(0,1fr)_7rem_8rem_6rem_auto]";

export function MovementForm({ movement }: { movement: AppSettings["movement"] }) {
  const list = useRows<MoveRow>(movement.categories.map((c) => ({ ...c })));
  return (
    <SettingsCard title="Movement categories & approval rules" description="Decide which categories need approval and whether they count as official time out of the office.">
      <ActionForm action={saveMovement} values={{ categories: list.rows }}>
        <div className="flex flex-col gap-3">
          <ColHeaders template={MOVE_GRID} labels={["Category", "Official", "Needs approval", "Active", ""]} />
          {list.rows.map((row, i) => (
            <ListRow key={i}>
              <div className={cn("grid grid-cols-1 items-center gap-3", MOVE_GRID)}>
                <Cell label="Category">
                  <Input aria-label="Category name" value={row.label} maxLength={60} onChange={(e) => list.update(i, { label: e.target.value })} placeholder="e.g. Client meeting" />
                  {row.key && <span className="font-mono text-[11px] text-subtle">key: {row.key}</span>}
                </Cell>
                <Cell label="Official">
                  <Switch aria-label={`${row.label || "Category"} is official`} checked={row.official} onChange={(e) => list.update(i, { official: e.target.checked })} />
                </Cell>
                <Cell label="Needs approval">
                  <Switch aria-label={`${row.label || "Category"} needs approval`} checked={row.requiresApproval} onChange={(e) => list.update(i, { requiresApproval: e.target.checked })} />
                </Cell>
                <Cell label="Active">
                  <Switch aria-label={`${row.label || "Category"} is active`} checked={row.active} onChange={(e) => list.update(i, { active: e.target.checked })} />
                </Cell>
                <RowTools index={i} count={list.rows.length} label={row.label || "category"} onMove={(d) => list.move(i, d)} onRemove={() => list.remove(i)} />
              </div>
            </ListRow>
          ))}
          <AddRow label="Add category" onClick={() => list.add({ key: "", label: "", official: true, requiresApproval: false, active: true })} />
          <p className="text-xs text-muted">Keys are generated once and never change, so renaming a category is safe. A category that movements already use can be made inactive but not removed.</p>
        </div>
        <CGrid cols={3}>
          <Field label="Overdue grace (minutes)" name="overdueGraceMinutes" required hint="A movement is flagged overdue this long after the expected return.">
            <Input id="overdueGraceMinutes" name="overdueGraceMinutes" type="number" min={0} max={240} defaultValue={movement.overdueGraceMinutes} />
          </Field>
          <Field label="Late entry allowed (days)" name="alternativeEntryMaxDays" required hint="How far back an alternative (manual) entry may be recorded.">
            <Input id="alternativeEntryMaxDays" name="alternativeEntryMaxDays" type="number" min={0} max={90} defaultValue={movement.alternativeEntryMaxDays} />
          </Field>
          <div className="flex items-end pb-1.5">
            <Switch name="requireExpectedReturn" defaultChecked={movement.requireExpectedReturn} label="Require expected return time" description="Needed to detect overdue movements." />
          </div>
        </CGrid>
        <SaveRow dirty={list.dirty} />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Status lists ───────────────────────────── */

export interface StatusRow {
  key: string;
  label: string;
  tone: Tone;
  category: string;
  probability?: string;
}

function TonePicker({ value, onChange }: { value: Tone; onChange: (t: Tone) => void }) {
  const dot: Record<Tone, string> = {
    blue: "bg-tone-blue",
    green: "bg-tone-green",
    amber: "bg-tone-amber",
    red: "bg-tone-red",
    orange: "bg-tone-orange",
    gray: "bg-tone-gray",
    purple: "bg-tone-purple",
  };
  return (
    <div role="group" aria-label="Colour" className="flex h-11 items-center gap-1.5 sm:h-10">
      {TONES.map((t) => (
        <button
          key={t}
          type="button"
          aria-label={t}
          aria-pressed={value === t}
          onClick={() => onChange(t)}
          className={cn("size-6 rounded-full border-2 border-white outline-1 outline-line-strong transition-transform", dot[t], value === t && "scale-110 outline-2 outline-ink")}
        />
      ))}
    </div>
  );
}

export function StatusEditor({
  title,
  description,
  action,
  items,
  categories,
  usage,
  noun,
  withProbability,
  addLabel = "Add status",
  note,
}: {
  title: string;
  description: string;
  action: FormAction<{ changed: number }>;
  items: StatusRow[];
  categories: { value: string; label: string }[];
  usage: Record<string, number>;
  noun: string;
  withProbability?: boolean;
  addLabel?: string;
  note?: string;
}) {
  const list = useRows<StatusRow>(items);
  const template = withProbability ? "@3xl:grid-cols-[minmax(0,1fr)_13rem_10rem_6rem_auto]" : "@3xl:grid-cols-[minmax(0,1fr)_13rem_10rem_auto]";
  return (
    <SettingsCard title={title} description={description}>
      <ActionForm action={action} values={{ items: list.rows }}>
        <div className="flex flex-col gap-3">
          <ColHeaders template={template} labels={withProbability ? ["Label", "Colour", "Category", "Win %", ""] : ["Label", "Colour", "Category", ""]} />
          {list.rows.map((row, i) => {
            const used = row.key ? (usage[row.key] ?? 0) : 0;
            return (
              <ListRow key={i}>
                <div className={cn("grid grid-cols-1 items-start gap-3", template)}>
                  <Cell label="Label">
                    <Input aria-label="Label" value={row.label} maxLength={60} onChange={(e) => list.update(i, { label: e.target.value })} placeholder="Status name" />
                    <span className="flex items-center gap-2 text-[11px] text-muted">
                      <Chip tone={row.tone} size="sm">
                        {row.label || "Preview"}
                      </Chip>
                      {used > 0 && (
                        <span>
                          {used} {noun} use this
                        </span>
                      )}
                    </span>
                  </Cell>
                  <Cell label="Colour">
                    <TonePicker value={row.tone} onChange={(tone) => list.update(i, { tone })} />
                  </Cell>
                  <Cell label="Category">
                    <Select aria-label="Category" value={row.category} onChange={(e) => list.update(i, { category: e.target.value })}>
                      {categories.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Cell>
                  {withProbability && (
                    <Cell label="Win probability %">
                      <Input aria-label="Win probability" type="number" min={0} max={100} value={row.probability ?? "0"} onChange={(e) => list.update(i, { probability: e.target.value })} />
                    </Cell>
                  )}
                  <div className="@3xl:pt-1">
                    <RowTools
                      index={i}
                      count={list.rows.length}
                      label={row.label || "status"}
                      onMove={(d) => list.move(i, d)}
                      onRemove={() => list.remove(i)}
                      removeDisabled={used > 0}
                      removeHint={`In use by ${used} ${noun}; rename it instead`}
                    />
                  </div>
                </div>
              </ListRow>
            );
          })}
          <AddRow label={addLabel} onClick={() => list.add({ key: "", label: "", tone: "gray", category: categories[0].value, ...(withProbability ? { probability: "0" } : {}) })} />
          <p className="text-xs text-muted">
            {note ?? "Order here is the order shown in filters and boards."} A status that records already use can be renamed or recoloured but not removed.
          </p>
        </div>
        <SaveRow dirty={list.dirty} />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Simple string lists ───────────────────────────── */

export function StringListEditor({
  title,
  description,
  listKey,
  items,
  usage,
  noun,
}: {
  title: string;
  description: string;
  listKey: "expenseCategories" | "assetCategories" | "leadSources";
  items: string[];
  usage: Record<string, number>;
  noun: string;
}) {
  const list = useRows<{ value: string }>(items.map((value) => ({ value })));
  return (
    <SettingsCard title={title} description={description}>
      <ActionForm action={saveSimpleList} values={{ list: listKey, items: list.rows.map((r) => r.value) }}>
        <div className="flex flex-col gap-2">
          {list.rows.map((row, i) => {
            const used = usage[row.value] ?? 0;
            return (
              <div key={i} className="flex items-center gap-2">
                <Input aria-label={`${title} entry ${i + 1}`} value={row.value} maxLength={60} onChange={(e) => list.update(i, { value: e.target.value })} className="min-w-0 flex-1" />
                {used > 0 && (
                  <span className="shrink-0 text-xs text-muted tabular">
                    {used} {noun}
                  </span>
                )}
                <RowTools index={i} count={list.rows.length} label={row.value || "entry"} onMove={(d) => list.move(i, d)} onRemove={() => list.remove(i)} />
              </div>
            );
          })}
          <AddRow label="Add entry" onClick={() => list.add({ value: "" })} />
          <p className="text-xs text-muted">Removing an entry only hides it from pick lists; existing records keep their value.</p>
        </div>
        <SaveRow dirty={list.dirty} />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Document categories ───────────────────────────── */

interface DocRow {
  key: string;
  label: string;
  required: boolean;
  appliesTo: string[];
  hasExpiry: boolean;
  confidential: boolean;
}

export function DocumentCategoriesEditor({ items, usage }: { items: AppSettings["documentCategories"]; usage: Record<string, number> }) {
  const list = useRows<DocRow>(items.map((c) => ({ ...c })));
  return (
    <SettingsCard title="Document categories" description="Categories for employee and intern documents. Required categories feed onboarding checklists.">
      <ActionForm action={saveDocumentCategories} values={{ items: list.rows }}>
        <div className="flex flex-col gap-3">
          {list.rows.map((row, i) => {
            const used = row.key ? (usage[row.key] ?? 0) : 0;
            return (
              <ListRow key={i} className="flex flex-col gap-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Input aria-label="Category name" value={row.label} maxLength={80} onChange={(e) => list.update(i, { label: e.target.value })} placeholder="Category name" />
                    {used > 0 && <span className="mt-1 block text-[11px] text-muted">{used} file(s) filed here</span>}
                  </div>
                  <RowTools
                    index={i}
                    count={list.rows.length}
                    label={row.label || "category"}
                    onMove={(d) => list.move(i, d)}
                    onRemove={() => list.remove(i)}
                    removeDisabled={used > 0}
                    removeHint={`${used} file(s) are filed under it; rename it instead`}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-muted">Applies to</span>
                    {PERSON_TYPE_OPTIONS.map((p) => (
                      <PillCheck
                        key={p.value}
                        label={p.label}
                        className="h-8 text-xs"
                        checked={row.appliesTo.includes(p.value)}
                        onChange={(on) => list.update(i, { appliesTo: on ? [...row.appliesTo, p.value] : row.appliesTo.filter((x) => x !== p.value) })}
                      />
                    ))}
                  </div>
                  <Switch aria-label="Required" checked={row.required} onChange={(e) => list.update(i, { required: e.target.checked })} label="Required" />
                  <Switch aria-label="Has expiry" checked={row.hasExpiry} onChange={(e) => list.update(i, { hasExpiry: e.target.checked })} label="Has expiry" />
                  <Switch aria-label="Confidential" checked={row.confidential} onChange={(e) => list.update(i, { confidential: e.target.checked })} label="Confidential" />
                </div>
              </ListRow>
            );
          })}
          <AddRow label="Add category" onClick={() => list.add({ key: "", label: "", required: false, appliesTo: ["employee", "trainee", "intern"], hasExpiry: false, confidential: false })} />
        </div>
        <SaveRow dirty={list.dirty} />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Taxes & payment terms ───────────────────────────── */

export function TaxesForm({ taxes, paymentTerms }: { taxes: AppSettings["taxes"]; paymentTerms: AppSettings["paymentTerms"] }) {
  const tax = useRows<{ name: string; rate: string }>(taxes.map((t) => ({ name: t.name, rate: String(t.rate) })));
  const terms = useRows<{ label: string; days: string }>(paymentTerms.map((t) => ({ label: t.label, days: String(t.days) })));
  return (
    <SettingsCard title="Taxes & payment terms" description="Offered when creating invoices and proposals.">
      <ActionForm action={saveTaxesAndTerms} values={{ taxes: tax.rows, paymentTerms: terms.rows }}>
        <div className="grid gap-6 @3xl:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold text-ink-2">Tax rates</div>
            {tax.rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input aria-label="Tax name" value={row.name} maxLength={40} placeholder="e.g. GST 18%" onChange={(e) => tax.update(i, { name: e.target.value })} className="min-w-0 flex-1" />
                <Input aria-label="Rate (%)" type="number" min={0} max={100} step="any" value={row.rate} onChange={(e) => tax.update(i, { rate: e.target.value })} className="w-24" />
                <RowTools index={i} count={tax.rows.length} label={row.name || "tax"} onMove={(d) => tax.move(i, d)} onRemove={() => tax.remove(i)} />
              </div>
            ))}
            <AddRow label="Add tax rate" onClick={() => tax.add({ name: "", rate: "0" })} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold text-ink-2">Payment terms</div>
            {terms.rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input aria-label="Term name" value={row.label} maxLength={40} placeholder="e.g. Net 30" onChange={(e) => terms.update(i, { label: e.target.value })} className="min-w-0 flex-1" />
                <Input aria-label="Days until due" type="number" min={0} max={365} value={row.days} onChange={(e) => terms.update(i, { days: e.target.value })} className="w-24" />
                <RowTools index={i} count={terms.rows.length} label={row.label || "term"} onMove={(d) => terms.move(i, d)} onRemove={() => terms.remove(i)} />
              </div>
            ))}
            <AddRow label="Add payment term" onClick={() => terms.add({ label: "", days: "0" })} />
            <p className="text-xs text-muted">Days are counted from the invoice date.</p>
          </div>
        </div>
        <SaveRow dirty={tax.dirty || terms.dirty} />
      </ActionForm>
    </SettingsCard>
  );
}
