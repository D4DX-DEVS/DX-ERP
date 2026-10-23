"use client";

import { useState } from "react";
import { Megaphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton, useFormState, useServerAction } from "@/components/ui/form";
import { Checkbox, Input, Radio, Switch, Textarea } from "@/components/ui/input";
import { createAnnouncement, deleteAnnouncement } from "./actions";

const PERSON_TYPE_OPTIONS = [
  { value: "employee", label: "Employees" },
  { value: "trainee", label: "Trainees" },
  { value: "intern", label: "Interns" },
];

function AudienceError() {
  const { errors } = useFormState();
  return errors.audience ? <p className="text-xs font-medium text-danger">{errors.audience}</p> : null;
}

/** Dialog form for publishing an announcement (needs `announcements.manage`; enforced again in the action). */
export function NewAnnouncementButton({ roles }: { roles: { key: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "selected">("all");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setMode("all");
      }}
      title="New announcement"
      description="It appears on everyone's dashboard in the audience and sends them a notification."
      trigger={
        <Button icon={<Megaphone className="size-4" />}>
          New announcement
        </Button>
      }
    >
      <ActionForm action={createAnnouncement} successMessage="Announcement published" onSuccess={() => setOpen(false)}>
        <Field label="Title" name="title" required>
          <Input id="title" name="title" maxLength={200} placeholder="e.g. Quarterly all-hands on Friday" />
        </Field>
        <Field label="Message" name="body" required>
          <Textarea id="body" name="body" rows={5} maxLength={5000} placeholder="What do people need to know?" />
        </Field>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Audience</legend>
          <input type="hidden" name="audienceMode" value={mode} />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Radio name="audience-mode" label="Everyone" checked={mode === "all"} onChange={() => setMode("all")} />
            <Radio name="audience-mode" label="Selected roles / person types" checked={mode === "selected"} onChange={() => setMode("selected")} />
          </div>
          {mode === "selected" && (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-field p-3">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-muted">Person types</div>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {PERSON_TYPE_OPTIONS.map((t) => (
                    <Checkbox key={t.value} name="types[]" value={t.value} label={t.label} />
                  ))}
                </div>
              </div>
              {roles.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-muted">Roles</div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {roles.map((r) => (
                      <Checkbox key={r.key} name="roles[]" value={r.key} label={r.name} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <AudienceError />
        </fieldset>

        <FormGrid>
          <Field label="Expires on" name="expiresOn" hint="Optional. It disappears from dashboards after this date.">
            <Input id="expiresOn" name="expiresOn" type="date" />
          </Field>
          <div className="flex items-end pb-1">
            <Switch name="pinned" label="Pin to the top" description="Pinned announcements are listed first." />
          </div>
        </FormGrid>

        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Publish</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function DeleteAnnouncementButton({ id, title }: { id: string; title: string }) {
  const { pending, run } = useServerAction();
  const confirm = useConfirm();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({ title: "Remove announcement?", description: `"${title}" will be removed and people will no longer see it.`, confirmLabel: "Remove", tone: "danger" });
        if (ok) run(() => deleteAnnouncement(id), { successMessage: "Announcement removed" });
      }}
      aria-label={`Remove announcement: ${title}`}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle hover:bg-field hover:text-danger disabled:opacity-50"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
