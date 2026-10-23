"use client";

import { useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { removeContact, saveContact } from "../clients/actions";

export interface ContactRow {
  id: string;
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
}

function ContactDialog({ clientId, contact, trigger }: { clientId: string; contact?: ContactRow; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} size="sm" title={contact ? "Edit contact" : "Add contact"} description="Additional people at this client.">
      <ActionForm action={(input) => saveContact(clientId, contact?.id ?? null, input)} onSuccess={() => setOpen(false)} successMessage="Contact saved">
        <FormGrid cols={1}>
          <Field label="Name" name="name" required>
            <Input id="contact-name" name="name" defaultValue={contact?.name} maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Designation" name="designation">
            <Input id="contact-designation" name="designation" defaultValue={contact?.designation} maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Email" name="email">
            <Input id="contact-email" name="email" type="email" defaultValue={contact?.email} autoComplete="off" />
          </Field>
          <Field label="Phone" name="phone">
            <Input id="contact-phone" name="phone" type="tel" defaultValue={contact?.phone} autoComplete="off" />
          </Field>
        </FormGrid>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>{contact ? "Save contact" : "Add contact"}</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** Primary contact (from the client profile) plus additional contacts with add / edit / remove. */
export function ContactsCard({ clientId, primary, contacts, canManage }: { clientId: string; primary?: Omit<ContactRow, "id">; contacts: ContactRow[]; canManage: boolean }) {
  const line = (c: Omit<ContactRow, "id">) => [c.designation, c.email, c.phone].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-3">
      {!primary && contacts.length === 0 && <p className="text-[13px] text-muted">No contacts recorded yet.</p>}
      {primary && (
        <div className="flex items-center gap-3">
          <Avatar name={primary.name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <span className="min-w-0 break-words">{primary.name}</span>
              <Tag tone="green">PRIMARY</Tag>
            </div>
            <div className="text-xs break-words text-muted">{line(primary) || "No details"}</div>
          </div>
        </div>
      )}
      {contacts.map((c) => (
        <div key={c.id} className="flex items-center gap-3">
          <Avatar name={c.name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold break-words text-ink">{c.name}</div>
            <div className="text-xs break-words text-muted">{line(c) || "No details"}</div>
          </div>
          {canManage && (
            <div className="flex shrink-0 items-center">
              <ContactDialog
                clientId={clientId}
                contact={c}
                trigger={
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                }
              />
              <ActionButton
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${c.name}`}
                confirmTone="danger" confirmTitle="Remove contact" confirmLabel="Remove" confirm={`Remove ${c.name} from this client's contacts?`}
                action={() => removeContact(clientId, c.id)}
                successMessage="Contact removed"
              >
                <Trash2 className="size-4" aria-hidden />
              </ActionButton>
            </div>
          )}
        </div>
      ))}
      {canManage && (
        <ContactDialog
          clientId={clientId}
          trigger={
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" aria-hidden />} className="self-start">
              Add contact
            </Button>
          }
        />
      )}
    </div>
  );
}
