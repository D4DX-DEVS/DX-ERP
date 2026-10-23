"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/ui/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Chip, Tag } from "@/components/ui/chip";
import { Field, FormGrid } from "@/components/ui/form";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { plural } from "@/lib/format";
import { fmtDate } from "@/lib/time";
import { bulkAddHolidays, deleteDepartment, deleteDesignation, deleteHoliday, deleteLeaveType, saveDepartment, saveDesignation, saveHoliday, saveLeaveType } from "./org-actions";
import { PERSON_TYPE_OPTIONS } from "./constants";
import { FormDialog, PillCheck, SettingsCard } from "./ui";

// Dialog triggers receive their click handler and ref as props, so these wrappers must forward them.
function AddButton(props: ButtonProps) {
  return <Button size="sm" icon={<Plus className="size-4" />} {...props} />;
}

function EditButton(props: ButtonProps) {
  return <Button variant="ghost" size="sm" {...props}>Edit</Button>;
}

/* ───────────────────────────── Departments ───────────────────────────── */

export interface DepartmentView {
  id: string;
  name: string;
  code?: string;
  description?: string;
  active: boolean;
  head?: { id: string; name: string };
  people: number;
  designations: number;
}

function DepartmentFields({ dept, people }: { dept?: DepartmentView; people: PickerOption[] }) {
  return (
    <FormGrid>
      <Field label="Name" name="name" required>
        <Input id="name" name="name" defaultValue={dept?.name} maxLength={80} />
      </Field>
      <Field label="Code" name="code" hint="Short code, e.g. ENG">
        <Input id="code" name="code" defaultValue={dept?.code} maxLength={10} className="uppercase" />
      </Field>
      <Field label="Department head" name="head" className="sm:col-span-2">
        <PeoplePicker name="head" options={people} defaultValue={dept?.head?.id} placeholder="No head assigned" />
      </Field>
      <Field label="Description" name="description" className="sm:col-span-2">
        <Textarea id="description" name="description" defaultValue={dept?.description} rows={2} maxLength={300} />
      </Field>
      <Switch name="active" defaultChecked={dept?.active ?? true} label="Active" description="Inactive departments can't be chosen for new records." className="sm:col-span-2" />
    </FormGrid>
  );
}

export function DepartmentsCard({ departments, people }: { departments: DepartmentView[]; people: PickerOption[] }) {
  return (
    <SettingsCard
      title="Departments"
      description="A department can be deleted only when nobody is assigned to it."
      action={
        <FormDialog trigger={<AddButton>Add department</AddButton>} title="Add department" action={saveDepartment} successMessage="Department added">
          <DepartmentFields people={people} />
        </FormDialog>
      }
    >
      <TableWrap phone={[1, 3, 5]} tablet={[1, 2, 3, 4, 5]} className="-mx-5">
        <THead>
          <Th>Department</Th>
          <Th>Head</Th>
          <Th align="right">People</Th>
          <Th>Status</Th>
          <Th align="right">
            <span className="sr-only">Actions</span>
          </Th>
        </THead>
        <tbody>
          {departments.length === 0 && <EmptyRow colSpan={5}>No departments yet.</EmptyRow>}
          {departments.map((d) => (
            <Tr key={d.id}>
              <Td>
                <div className="font-semibold">{d.name}</div>
                <div className="text-xs text-muted">{[d.code, d.designations ? plural(d.designations, "designation") : null].filter(Boolean).join(" · ") || "—"}</div>
              </Td>
              <Td>{d.head?.name ?? <span className="text-muted">—</span>}</Td>
              <Td align="right">{d.people}</Td>
              <Td>{d.active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>}</Td>
              <Td align="right" className="whitespace-nowrap">
                <FormDialog trigger={<EditButton />} title={`Edit ${d.name}`} action={saveDepartment} values={{ id: d.id }} successMessage="Department updated">
                  <DepartmentFields dept={d} people={people} />
                </FormDialog>
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-bg hover:text-danger"
                  action={() => deleteDepartment(d.id)}
                  confirmTone="danger" confirmTitle="Delete department" confirmLabel="Delete" confirm={`Delete the ${d.name} department? This can't be undone.`}
                >
                  Delete
                </ActionButton>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </SettingsCard>
  );
}

/* ───────────────────────────── Designations ───────────────────────────── */

export interface DesignationView {
  id: string;
  name: string;
  department?: { id: string; name: string };
  level?: number;
  active: boolean;
  people: number;
}

function DesignationFields({ item, departments }: { item?: DesignationView; departments: { id: string; name: string }[] }) {
  return (
    <FormGrid>
      <Field label="Name" name="name" required className="sm:col-span-2">
        <Input id="name" name="name" defaultValue={item?.name} maxLength={80} />
      </Field>
      <Field label="Department" name="department" hint="Optional; leave empty for company-wide titles.">
        <Select id="department" name="department" defaultValue={item?.department?.id ?? ""}>
          <option value="">Any department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Level" name="level" hint="1 = most senior. Used to order lists.">
        <Input id="level" name="level" type="number" min={1} max={99} defaultValue={item?.level} />
      </Field>
      <Switch name="active" defaultChecked={item?.active ?? true} label="Active" className="sm:col-span-2" />
    </FormGrid>
  );
}

export function DesignationsCard({ designations, departments }: { designations: DesignationView[]; departments: { id: string; name: string }[] }) {
  return (
    <SettingsCard
      title="Designations"
      description="Job titles. A designation can be deleted only when nobody holds it."
      action={
        <FormDialog trigger={<AddButton>Add designation</AddButton>} title="Add designation" action={saveDesignation} successMessage="Designation added">
          <DesignationFields departments={departments} />
        </FormDialog>
      }
    >
      <TableWrap phone={[1, 4, 6]} tablet={[1, 2, 4, 5, 6]} className="-mx-5">
        <THead>
          <Th>Designation</Th>
          <Th>Department</Th>
          <Th align="right">Level</Th>
          <Th align="right">People</Th>
          <Th>Status</Th>
          <Th align="right">
            <span className="sr-only">Actions</span>
          </Th>
        </THead>
        <tbody>
          {designations.length === 0 && <EmptyRow colSpan={6}>No designations yet.</EmptyRow>}
          {designations.map((d) => (
            <Tr key={d.id}>
              <Td className="font-semibold">{d.name}</Td>
              <Td>{d.department?.name ?? <span className="text-muted">Any</span>}</Td>
              <Td align="right">{d.level ?? "—"}</Td>
              <Td align="right">{d.people}</Td>
              <Td>{d.active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>}</Td>
              <Td align="right" className="whitespace-nowrap">
                <FormDialog trigger={<EditButton />} title={`Edit ${d.name}`} action={saveDesignation} values={{ id: d.id }} successMessage="Designation updated">
                  <DesignationFields item={d} departments={departments} />
                </FormDialog>
                <ActionButton variant="ghost" size="sm" className="text-danger hover:bg-danger-bg hover:text-danger" action={() => deleteDesignation(d.id)} confirmTone="danger" confirmTitle="Delete designation" confirmLabel="Delete" confirm={`Delete the designation ${d.name}? This can't be undone.`}>
                  Delete
                </ActionButton>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </SettingsCard>
  );
}

/* ───────────────────────────── Holidays ───────────────────────────── */

export interface HolidayView {
  id: string;
  date: string;
  name: string;
  optional: boolean;
}

function HolidayFields({ holiday, defaultDate }: { holiday?: HolidayView; defaultDate?: string }) {
  return (
    <FormGrid>
      <Field label="Date" name="date" required>
        <Input id="date" name="date" type="date" defaultValue={holiday?.date ?? defaultDate} />
      </Field>
      <Field label="Name" name="name" required>
        <Input id="name" name="name" defaultValue={holiday?.name} maxLength={100} />
      </Field>
      <Switch name="optional" defaultChecked={holiday?.optional ?? false} label="Optional holiday" description="People may choose to take it; the office stays open." className="sm:col-span-2" />
    </FormGrid>
  );
}

export function HolidaysCard({ year, holidays }: { year: string; holidays: HolidayView[] }) {
  return (
    <SettingsCard
      title={`Holidays ${year}`}
      description={`${plural(holidays.filter((h) => !h.optional).length, "company holiday")}${holidays.some((h) => h.optional) ? ` and ${holidays.filter((h) => h.optional).length} optional` : ""} in ${year}.`}
      action={
        <div className="flex flex-wrap gap-2">
          <FormDialog
            trigger={
              <Button variant="secondary" size="sm">
                Bulk add
              </Button>
            }
            title="Add several holidays"
            description='One per line as "yyyy-mm-dd, Holiday name". Add ", optional" to mark an optional holiday. Dates that already exist are skipped.'
            action={bulkAddHolidays}
            successMessage={false}
            submitLabel="Add holidays"
            onSuccess={(r) => {
              toast.success(`${plural(r.added, "holiday")} added${r.skipped.length ? `, ${r.skipped.length} skipped (already exist)` : ""}`);
            }}
          >
            <Field label="Holidays" name="text" required>
              <Textarea id="text" name="text" rows={8} placeholder={`${year}-01-26, Republic Day\n${year}-08-15, Independence Day\n${year}-10-02, Gandhi Jayanti, optional`} className="font-mono text-[13px]" />
            </Field>
          </FormDialog>
          <FormDialog trigger={<AddButton>Add holiday</AddButton>} title="Add holiday" action={saveHoliday} successMessage="Holiday added">
            <HolidayFields defaultDate={`${year}-01-01`} />
          </FormDialog>
        </div>
      }
    >
      <TableWrap phone={[1, 2, 4]} tablet={[1, 2, 3, 4]} className="-mx-5">
        <THead>
          <Th>Date</Th>
          <Th>Holiday</Th>
          <Th>Type</Th>
          <Th align="right">
            <span className="sr-only">Actions</span>
          </Th>
        </THead>
        <tbody>
          {holidays.length === 0 && <EmptyRow colSpan={4}>No holidays recorded for {year}.</EmptyRow>}
          {holidays.map((h) => (
            <Tr key={h.id}>
              <Td className="whitespace-nowrap font-medium">{fmtDate(h.date, "EEE, d MMM yyyy")}</Td>
              <Td>{h.name}</Td>
              <Td>{h.optional ? <Tag tone="amber">Optional</Tag> : <Tag tone="blue">Company</Tag>}</Td>
              <Td align="right" className="whitespace-nowrap">
                <FormDialog trigger={<EditButton />} title="Edit holiday" action={saveHoliday} values={{ id: h.id }} successMessage="Holiday updated">
                  <HolidayFields holiday={h} />
                </FormDialog>
                <ActionButton variant="ghost" size="sm" className="text-danger hover:bg-danger-bg hover:text-danger" action={() => deleteHoliday(h.id)} confirmTone="danger" confirmTitle="Remove holiday" confirmLabel="Remove" confirm={`Remove ${h.name} (${fmtDate(h.date)}) from the holiday list?`}>
                  Remove
                </ActionButton>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </SettingsCard>
  );
}

/* ───────────────────────────── Leave types ───────────────────────────── */

export interface LeaveTypeView {
  id: string;
  name: string;
  code: string;
  color?: string;
  annualQuota: number;
  accrual: "upfront" | "monthly";
  carryForward: boolean;
  maxCarryForward: number;
  paid: boolean;
  allowHalfDay: boolean;
  requiresHrApproval: boolean;
  requiresAttachmentAfterDays?: number;
  applicableTo: string[];
  active: boolean;
  order: number;
  /** Requests or adjusted balances exist: deleting deactivates instead. */
  inUse: boolean;
}

function LeaveTypeFields({ type }: { type?: LeaveTypeView }) {
  const [carry, setCarry] = useState(type?.carryForward ?? false);
  const applies = type?.applicableTo ?? ["employee", "trainee", "intern"];
  return (
    <div className="flex flex-col gap-4">
      <FormGrid>
        <Field label="Name" name="name" required>
          <Input id="name" name="name" defaultValue={type?.name} maxLength={60} />
        </Field>
        <Field label="Code" name="code" required hint="Short unique code, e.g. CL">
          <Input id="code" name="code" defaultValue={type?.code} maxLength={8} className="uppercase" />
        </Field>
        <Field label="Annual quota (days)" name="annualQuota" required>
          <Input id="annualQuota" name="annualQuota" type="number" min={0} max={366} step="0.5" defaultValue={type?.annualQuota ?? 0} />
        </Field>
        <Field label="Accrual" name="accrual" required hint="Monthly releases one-twelfth of the quota each month.">
          <Select id="accrual" name="accrual" defaultValue={type?.accrual ?? "upfront"}>
            <option value="upfront">Full quota at the start of the year</option>
            <option value="monthly">Accrues monthly</option>
          </Select>
        </Field>
        <Field label="Colour" name="color">
          <Input id="color" name="color" type="color" defaultValue={type?.color ?? "#284CC7"} className="p-1" />
        </Field>
        <Field label="Display order" name="order" hint="Lower numbers are listed first. Blank adds it at the end.">
          <Input id="order" name="order" type="number" min={0} max={999} defaultValue={type?.order} />
        </Field>
        <Field label="Attachment required after (days)" name="requiresAttachmentAfterDays" hint="Leave blank if never required.">
          <Input id="requiresAttachmentAfterDays" name="requiresAttachmentAfterDays" type="number" min={0} max={60} defaultValue={type?.requiresAttachmentAfterDays} />
        </Field>
      </FormGrid>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold text-ink-2">Applies to</legend>
        <div className="flex flex-wrap gap-2">
          {PERSON_TYPE_OPTIONS.map((p) => (
            <PillCheck key={p.value} name="applicableTo[]" value={p.value} label={p.label} defaultChecked={applies.includes(p.value)} />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 border-t border-line-soft pt-4 sm:grid-cols-2">
        <Switch name="paid" defaultChecked={type?.paid ?? true} label="Paid leave" />
        <Switch name="allowHalfDay" defaultChecked={type?.allowHalfDay ?? true} label="Allow half days" />
        <Switch name="requiresHrApproval" defaultChecked={type?.requiresHrApproval ?? false} label="Needs HR approval" description="In addition to the reporting manager." />
        <Switch name="active" defaultChecked={type?.active ?? true} label="Active" description="Inactive types can't be requested." />
        <Switch name="carryForward" checked={carry} onChange={(e) => setCarry(e.target.checked)} label="Carry forward unused leave" />
        {carry && (
          <Field label="Maximum carried forward (days)" name="maxCarryForward">
            <Input id="maxCarryForward" name="maxCarryForward" type="number" min={0} max={366} step="0.5" defaultValue={type?.maxCarryForward ?? 0} />
          </Field>
        )}
      </div>
    </div>
  );
}

export function LeaveTypesCard({ types }: { types: LeaveTypeView[] }) {
  return (
    <SettingsCard
      title="Leave categories"
      description="A category that has requests or adjusted balances is deactivated instead of deleted."
      action={
        <FormDialog trigger={<AddButton>Add category</AddButton>} title="Add leave category" size="lg" action={saveLeaveType} successMessage="Leave category added">
          <LeaveTypeFields />
        </FormDialog>
      }
    >
      <TableWrap phone={[1, 2, 8]} tablet={[1, 2, 3, 7, 8]} className="-mx-5">
        <THead>
          <Th>Category</Th>
          <Th align="right">Quota</Th>
          <Th>Accrual</Th>
          <Th>Carry forward</Th>
          <Th>Rules</Th>
          <Th>Applies to</Th>
          <Th>Status</Th>
          <Th align="right">
            <span className="sr-only">Actions</span>
          </Th>
        </THead>
        <tbody>
          {types.length === 0 && <EmptyRow colSpan={8}>No leave categories yet.</EmptyRow>}
          {types.map((t) => (
            <Tr key={t.id}>
              <Td>
                <div className="flex items-center gap-2 font-semibold">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color ?? "#8A93B2" }} aria-hidden />
                  {t.name}
                </div>
                <div className="font-mono text-xs text-muted">{t.code}</div>
              </Td>
              <Td align="right">{t.annualQuota} d</Td>
              <Td>{t.accrual === "monthly" ? "Monthly" : "Upfront"}</Td>
              <Td>{t.carryForward ? `Up to ${t.maxCarryForward} d` : "No"}</Td>
              <Td className="text-xs text-ink-2">
                {[t.paid ? "Paid" : "Unpaid", t.allowHalfDay ? "half days" : null, t.requiresHrApproval ? "HR approval" : null, t.requiresAttachmentAfterDays !== undefined ? `attachment > ${t.requiresAttachmentAfterDays} d` : null].filter(Boolean).join(" · ")}
              </Td>
              <Td className="text-xs capitalize">{t.applicableTo.join(", ")}</Td>
              <Td>{t.active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>}</Td>
              <Td align="right" className="whitespace-nowrap">
                <FormDialog trigger={<EditButton />} title={`Edit ${t.name}`} size="lg" action={saveLeaveType} values={{ id: t.id }} successMessage="Leave category updated">
                  <LeaveTypeFields type={t} />
                </FormDialog>
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-bg hover:text-danger"
                  action={() => deleteLeaveType(t.id)}
                  successMessage={t.inUse ? "Leave category deactivated" : "Leave category deleted"}
                  confirmTone="danger" confirmTitle="Delete leave type" confirm={t.inUse ? `${t.name} has leave requests or balance history, so it will be deactivated rather than deleted.` : `Delete ${t.name}? This can't be undone.`}
                >
                  {t.inUse ? "Deactivate" : "Delete"}
                </ActionButton>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </SettingsCard>
  );
}
