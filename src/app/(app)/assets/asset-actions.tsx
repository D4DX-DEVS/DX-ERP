"use client";

import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton, type FormAction } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Alert } from "@/components/ui/page";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { statusLabel } from "@/lib/status";
import { backFromRepair, issueAsset, markDamaged, markLost, recordService, restoreAsset, retireAsset, returnAsset, sendToRepair, transferAsset } from "./actions";
import { ASSET_CONDITIONS } from "./meta";

type Kind = "issue" | "return" | "transfer" | "repair" | "back" | "damaged" | "lost" | "retire" | "restore" | "service";

const BY_STATUS: Record<string, { primary: Kind[]; more: Kind[] }> = {
  available: { primary: ["issue", "repair", "service"], more: ["transfer", "damaged", "lost", "retire"] },
  assigned: { primary: ["return", "transfer", "repair"], more: ["service", "damaged", "lost"] },
  in_repair: { primary: ["back", "service"], more: ["damaged", "lost", "retire"] },
  damaged: { primary: ["repair", "restore"], more: ["service", "lost", "retire"] },
  lost: { primary: ["restore", "retire"], more: [] },
  retired: { primary: [], more: [] },
};

const DANGER: Kind[] = ["damaged", "lost", "retire"];

function label(kind: Kind, status: string): string {
  switch (kind) {
    case "issue":
      return "Issue to person";
    case "return":
      return "Record return";
    case "transfer":
      return "Transfer";
    case "repair":
      return "Send to repair";
    case "back":
      return "Back from repair";
    case "damaged":
      return "Mark damaged";
    case "lost":
      return "Mark lost";
    case "retire":
      return "Retire";
    case "restore":
      return status === "lost" ? "Found: return to stock" : "Return to stock";
    case "service":
      return "Record service";
  }
}

const DESCRIPTION: Record<Kind, string> = {
  issue: "Hand the asset to a team member. They are notified.",
  return: "Record that the asset came back from its holder.",
  transfer: "Move the asset to another person and/or department.",
  repair: "The asset leaves the office for repair and is no longer assigned to anyone.",
  back: "The repaired asset returns to stock.",
  damaged: "Take the asset out of use. Any holder is unassigned and notified.",
  lost: "Record that the asset is lost. Any holder is unassigned and notified.",
  retire: "Write the asset off. This is the end of its life and can't be undone.",
  restore: "Put the asset back into available stock.",
  service: "Log routine servicing and schedule the next one.",
};

function ConditionSelect({ name = "condition", defaultValue, label: text = "Condition" }: { name?: string; defaultValue: string; label?: string }) {
  return (
    <Field label={text} name={name} required>
      <Select id={name} name={name} defaultValue={defaultValue}>
        {ASSET_CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {statusLabel("assetCondition", c)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function NoteField({ label: text = "Note", required, placeholder }: { label?: string; required?: boolean; placeholder?: string }) {
  return (
    <Field label={text} name="note" required={required} className="sm:col-span-2">
      <Textarea id="note" name="note" rows={3} maxLength={500} placeholder={placeholder} />
    </Field>
  );
}

export function AssetActions({
  id,
  status,
  condition,
  holder,
  people,
  departments,
  today,
}: {
  id: string;
  status: string;
  condition: string;
  holder?: string;
  people: PickerOption[];
  departments: { id: string; name: string }[];
  /** Today's date in the company time zone (yyyy-MM-dd), computed on the server. */
  today: string;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const config = BY_STATUS[status] ?? { primary: [], more: [] };

  if (config.primary.length === 0 && config.more.length === 0) {
    return <span className="text-[13px] text-muted">Retired assets are read-only.</span>;
  }

  const actions: Record<Kind, FormAction<null>> = {
    issue: (input) => issueAsset(id, input),
    return: (input) => returnAsset(id, input),
    transfer: (input) => transferAsset(id, input),
    repair: (input) => sendToRepair(id, input),
    back: (input) => backFromRepair(id, input),
    damaged: (input) => markDamaged(id, input),
    lost: (input) => markLost(id, input),
    retire: (input) => retireAsset(id, input),
    restore: (input) => restoreAsset(id, input),
    service: (input) => recordService(id, input),
  };
  const success: Record<Kind, string> = {
    issue: "Asset issued",
    return: "Return recorded",
    transfer: "Asset transferred",
    repair: "Sent for repair",
    back: "Marked as back from repair",
    damaged: "Marked as damaged",
    lost: "Marked as lost",
    retire: "Asset retired",
    restore: "Returned to stock",
    service: "Service recorded",
  };

  const date = (name = "date", text = "Date") => (
    <Field label={text} name={name} required>
      <Input id={name} name={name} type="date" defaultValue={today} max={today} />
    </Field>
  );

  const fields: Record<Kind, ReactNode> = {
    issue: (
      <FormGrid>
        <Field label="Issue to" name="person" required className="sm:col-span-2">
          <PeoplePicker name="person" options={people} placeholder="Select person" allowClear={false} />
        </Field>
        {date("date", "Issue date")}
        <ConditionSelect defaultValue={condition === "damaged" ? "fair" : condition} label="Condition at issue" />
        <NoteField label="Note (optional)" placeholder="Accessories handed over, charger, bag…" />
      </FormGrid>
    ),
    return: (
      <FormGrid>
        {holder && <p className="text-sm text-ink-2 sm:col-span-2">Returned by <strong>{holder}</strong>.</p>}
        {date("date", "Return date")}
        <ConditionSelect defaultValue={condition} label="Condition on return" />
        <p className="text-xs text-muted sm:col-span-2">A returned asset in “Damaged” condition is marked damaged instead of available.</p>
        <NoteField label="Note (optional)" />
      </FormGrid>
    ),
    transfer: (
      <FormGrid>
        {status === "assigned" ? (
          <Field label="Transfer to person" name="toPerson" hint={holder ? `Currently with ${holder}.` : undefined} className="sm:col-span-2">
            <PeoplePicker name="toPerson" options={people} placeholder="Keep with current holder" />
          </Field>
        ) : (
          <Alert tone="info" className="sm:col-span-2">
            This asset is in stock, so it can only be moved to another department. To hand it to a person, use Issue.
          </Alert>
        )}
        <Field label="Transfer to department" name="toDepartment" className="sm:col-span-2" hint="Leave as “No change” to keep the current department.">
          <Select id="toDepartment" name="toDepartment" defaultValue="">
            <option value="">No change</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        {date("date", "Transfer date")}
        <NoteField label="Note (optional)" />
      </FormGrid>
    ),
    repair: (
      <FormGrid>
        <Field label="Service provider" name="provider">
          <Input id="provider" name="provider" maxLength={150} placeholder="Repair shop or vendor" />
        </Field>
        {date("date", "Date sent")}
        <NoteField label="What is wrong?" required placeholder="e.g. Battery swelling, screen flicker" />
      </FormGrid>
    ),
    back: (
      <FormGrid>
        {date("date", "Date back")}
        <ConditionSelect defaultValue={condition === "damaged" ? "good" : condition} label="Condition after repair" />
        <NoteField label="Repair notes (optional)" />
      </FormGrid>
    ),
    damaged: (
      <FormGrid>
        <NoteField label="What happened?" required placeholder="Describe the damage and how it happened" />
      </FormGrid>
    ),
    lost: (
      <FormGrid>
        <NoteField label="Circumstances" required placeholder="When and where was it last seen?" />
      </FormGrid>
    ),
    retire: (
      <FormGrid>
        <Field label="Reason" name="reason" required className="sm:col-span-2">
          <Textarea id="reason" name="reason" rows={3} maxLength={500} placeholder="e.g. Beyond economical repair, end of life, sold" />
        </Field>
      </FormGrid>
    ),
    restore: (
      <FormGrid>
        <ConditionSelect defaultValue={condition === "damaged" ? "fair" : condition} label="Condition now" />
        <NoteField label="Note (optional)" />
      </FormGrid>
    ),
    service: (
      <FormGrid>
        {date("date", "Service date")}
        <Field label="Service provider" name="provider">
          <Input id="provider" name="provider" maxLength={150} />
        </Field>
        <Field label="Next service date" name="nextServiceDate" hint="Leave blank if none is scheduled; this clears the current due date." className="sm:col-span-2">
          <Input id="nextServiceDate" name="nextServiceDate" type="date" min={today} />
        </Field>
        <NoteField label="What was done (optional)" />
      </FormGrid>
    ),
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {config.primary.map((k, i) => (
          <Button key={k} variant={i === 0 ? "primary" : "secondary"} onClick={() => setKind(k)}>
            {label(k, status)}
          </Button>
        ))}
        {config.more.length > 0 && (
          <Menu
            label="More asset actions"
            trigger={
              <Button variant="secondary" icon={<MoreHorizontal className="size-4" />}>
                More
              </Button>
            }
            items={config.more.map((k) => ({ label: label(k, status), onSelect: () => setKind(k), danger: DANGER.includes(k) }))}
          />
        )}
      </div>
      <Dialog open={kind !== null} onOpenChange={(open) => !open && setKind(null)} title={kind ? label(kind, status) : ""} description={kind ? DESCRIPTION[kind] : undefined}>
        {kind && (
          <ActionForm key={kind} action={actions[kind]} successMessage={success[kind]} onSuccess={() => setKind(null)}>
            {fields[kind]}
            <FormActions>
              <Button variant="secondary" onClick={() => setKind(null)}>
                Cancel
              </Button>
              <SubmitButton variant={DANGER.includes(kind) ? "danger" : "primary"}>{label(kind, status)}</SubmitButton>
            </FormActions>
          </ActionForm>
        )}
      </Dialog>
    </>
  );
}
