"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { addDays, fmtDate } from "@/lib/time";
import { Alert } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { EditIconButton } from "./section-edit";
import { changeDesignation, changeManager, changeStatus, completeExit, recordResignation, transferDepartment } from "../[id]/actions";

type Kind = "designation" | "department" | "manager" | "status" | "resign" | "exit";

export interface LifecycleProps {
  userId: string;
  name: string;
  today: string;
  status: string;
  exitStage: "none" | "notice" | "completed";
  lastWorkingDay?: string;
  currentDesignation?: string;
  currentDepartment?: string;
  currentManager?: string;
  designations: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  people: PickerOption[];
  statuses: { key: string; label: string; category: string }[];
  counts: { assets: number; reports: number; mentees: number };
}

function DateAndNote({ today, label = "Effective date" }: { today: string; label?: string }) {
  return (
    <FormGrid>
      <Field label={label} name="effectiveDate" required>
        <Input id="effectiveDate" name="effectiveDate" type="date" defaultValue={today} />
      </Field>
      <Field label="Note" name="note">
        <Input id="note" name="note" maxLength={500} placeholder="Optional" />
      </Field>
    </FormGrid>
  );
}

function Footer({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <FormActions>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <SubmitButton>{label}</SubmitButton>
    </FormActions>
  );
}

interface LifecycleCtx {
  open: (kind: Kind) => void;
  /** Exit completed: only the status can still change. */
  left: boolean;
  exitStage: LifecycleProps["exitStage"];
}

const Ctx = createContext<LifecycleCtx | null>(null);

/**
 * Holds the lifecycle dialogs (staff.edit) for a profile page so the header menu and the inline
 * section buttons open the same history-tracked forms. Render it only for users who may edit.
 */
export function LifecycleProvider({ children, ...p }: LifecycleProps & { children: ReactNode }) {
  const [kind, setKind] = useState<Kind | null>(null);
  return (
    <Ctx.Provider value={{ open: setKind, left: p.exitStage === "completed", exitStage: p.exitStage }}>
      {children}
      <LifecycleDialogs kind={kind} onClose={() => setKind(null)} {...p} />
    </Ctx.Provider>
  );
}

/** "Lifecycle action" menu: promotion, transfer, manager change, status, resignation, exit. */
export function LifecycleActions() {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const { open, left, exitStage } = ctx;
  return (
    <Menu
      label="Lifecycle actions"
      trigger={
        <Button>
          Lifecycle action <ChevronDown className="size-4" />
        </Button>
      }
      items={[
        !left && { label: "Promotion / designation change", onSelect: () => open("designation") },
        !left && { label: "Department transfer", onSelect: () => open("department") },
        !left && { label: "Change reporting manager", onSelect: () => open("manager") },
        { label: exitStage === "none" ? "Change employment status" : "Change status / withdraw exit", onSelect: () => open("status") },
        "separator",
        exitStage === "none" && { label: "Record resignation", onSelect: () => open("resign") },
        exitStage !== "completed" && { label: "Complete exit", onSelect: () => open("exit"), danger: true },
      ]}
    />
  );
}

/** Small pencil next to a value (department, designation, status, reporting manager) that opens its lifecycle form. */
export function LifecycleEditButton({ kind, label }: { kind: "designation" | "department" | "manager" | "status"; label: string }) {
  const ctx = useContext(Ctx);
  if (!ctx || (ctx.left && kind !== "status")) return null;
  return <EditIconButton label={label} onClick={() => ctx.open(kind)} />;
}

function LifecycleDialogs({ kind, onClose: close, ...p }: LifecycleProps & { kind: Kind | null; onClose: () => void }) {
  return (
    <>
      <Dialog open={kind === "designation"} onOpenChange={(o) => !o && close()} title="Promotion / designation change" description={p.currentDesignation ? `Current: ${p.currentDesignation}` : undefined}>
        <ActionForm action={changeDesignation} values={{ userId: p.userId }} successMessage="Designation updated" onSuccess={close}>
          <FormGrid>
            <Field label="Change type" name="kind" required>
              <Select id="kind" name="kind" defaultValue="promotion">
                <option value="promotion">Promotion</option>
                <option value="designation_change">Designation change</option>
              </Select>
            </Field>
            <Field label="New designation" name="designation" required>
              <Select id="designation" name="designation" defaultValue="">
                <option value="">Select designation</option>
                {p.designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <DateAndNote today={p.today} />
          <Footer onClose={close} label="Save" />
        </ActionForm>
      </Dialog>

      <Dialog open={kind === "department"} onOpenChange={(o) => !o && close()} title="Department transfer" description={p.currentDepartment ? `Current: ${p.currentDepartment}` : undefined}>
        <ActionForm action={transferDepartment} values={{ userId: p.userId }} successMessage="Department updated" onSuccess={close}>
          <Field label="New department" name="department" required>
            <Select id="department" name="department" defaultValue="">
              <option value="">Select department</option>
              {p.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <DateAndNote today={p.today} />
          <Footer onClose={close} label="Transfer" />
        </ActionForm>
      </Dialog>

      <Dialog open={kind === "manager"} onOpenChange={(o) => !o && close()} title="Change reporting manager" description={p.currentManager ? `Current: ${p.currentManager}` : "No manager assigned"}>
        <ActionForm action={changeManager} values={{ userId: p.userId }} successMessage="Reporting manager updated" onSuccess={close}>
          <Field label="New reporting manager" name="reportingManager" hint="Leave empty to remove the manager">
            <PeoplePicker name="reportingManager" options={p.people.filter((o) => o.id !== p.userId)} placeholder="Select reporting manager" />
          </Field>
          <DateAndNote today={p.today} />
          <Footer onClose={close} label="Save" />
        </ActionForm>
      </Dialog>

      <Dialog open={kind === "status"} onOpenChange={(o) => !o && close()} title="Change employment status" description="Resigned and terminated are set through “Complete exit”; notice periods through “Record resignation”.">
        <ActionForm action={changeStatus} values={{ userId: p.userId }} successMessage="Status updated" onSuccess={close}>
          <Field label="New status" name="status" required>
            <Select id="status" name="status" defaultValue="">
              <option value="">Select status</option>
              {p.statuses
                .filter((s) => s.category !== "exited" && s.category !== "notice" && s.key !== p.status)
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
            </Select>
          </Field>
          {p.exitStage === "notice" && <Alert tone="info">Choosing an active status withdraws the recorded resignation.</Alert>}
          {p.exitStage === "completed" && <Alert tone="warning">Re-activating clears the exit. Login access stays off until someone with access rights enables it.</Alert>}
          <DateAndNote today={p.today} />
          <Footer onClose={close} label="Update status" />
        </ActionForm>
      </Dialog>

      <ResignDialog open={kind === "resign"} onClose={close} {...p} />

      <Dialog open={kind === "exit"} onOpenChange={(o) => !o && close()} title="Complete exit" description={`Closes ${p.name}'s employment and revokes login access.`}>
        <ActionForm action={completeExit} values={{ userId: p.userId }} successMessage="Exit completed" onSuccess={close}>
          <Notes counts={p.counts} />
          <FormGrid>
            <Field label="Outcome" name="status" required>
              <Select id="status" name="status" defaultValue="">
                <option value="">Select outcome</option>
                {p.statuses
                  .filter((s) => s.category === "exited")
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Exit date" name="exitDate" required hint={p.lastWorkingDay ? `Last working day recorded: ${fmtDate(p.lastWorkingDay)}` : undefined}>
              <Input id="exitDate" name="exitDate" type="date" defaultValue={p.lastWorkingDay ?? p.today} />
            </Field>
          </FormGrid>
          <Field label="Clearance note" name="clearanceNote" hint="Handover, assets returned, dues settled…">
            <Textarea id="clearanceNote" name="clearanceNote" rows={3} maxLength={1000} />
          </Field>
          <Footer onClose={close} label="Complete exit" />
        </ActionForm>
      </Dialog>
    </>
  );
}

function Notes({ counts }: { counts: LifecycleProps["counts"] }): ReactNode {
  const items: string[] = [];
  if (counts.assets > 0) items.push(`${counts.assets} asset${counts.assets === 1 ? "" : "s"} still assigned`);
  if (counts.reports > 0) items.push(`${counts.reports} direct report${counts.reports === 1 ? "" : "s"} to reassign`);
  if (counts.mentees > 0) items.push(`${counts.mentees} mentee${counts.mentees === 1 ? "" : "s"} to reassign`);
  if (items.length === 0) return null;
  return (
    <Alert tone="warning" title="Before you finish:">
      {items.join(" · ")}.
    </Alert>
  );
}

function ResignDialog({ open, onClose, userId, today, name, counts }: LifecycleProps & { open: boolean; onClose: () => void }) {
  const [date, setDate] = useState(today);
  const [days, setDays] = useState("30");
  const n = Number(days);
  const last = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(n) && n >= 0 ? addDays(date, Math.round(n)) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Record resignation" description={`Starts ${name}'s notice period.`}>
      <ActionForm action={recordResignation} values={{ userId }} successMessage="Resignation recorded" onSuccess={onClose}>
        <Notes counts={counts} />
        <FormGrid>
          <Field label="Resignation date" name="resignationDate" required>
            <Input id="resignationDate" name="resignationDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Notice period (days)" name="noticeDays" required>
            <Input id="noticeDays" name="noticeDays" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </FormGrid>
        <p className="text-[13px] text-ink-2">
          Last working day: <strong>{last ? fmtDate(last) : "—"}</strong>
        </p>
        <Field label="Reason" name="reason">
          <Textarea id="reason" name="reason" rows={3} maxLength={1000} placeholder="Optional" />
        </Field>
        <Footer onClose={onClose} label="Record resignation" />
      </ActionForm>
    </Dialog>
  );
}
