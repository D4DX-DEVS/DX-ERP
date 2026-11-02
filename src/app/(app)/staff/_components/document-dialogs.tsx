"use client";

import { useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, SubmitButton, useServerAction } from "@/components/ui/form";
import { Checkbox, Input, Select, Switch } from "@/components/ui/input";
import { deleteDocument, registerDocument, setDocumentUploadOpen } from "../[id]/actions";

export interface CategoryOption {
  key: string;
  label: string;
  hasExpiry: boolean;
  confidential: boolean;
}

/** Upload a new document (category → file → expiry) or a new version of an existing one. */
export function UploadDocumentButton({
  personId,
  categories,
  replace,
  label = "Upload document",
  variant = "secondary",
  size = "md",
  iconOnly = false,
}: {
  personId: string;
  categories: CategoryOption[];
  replace?: { id: string; category: string; name: string };
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Small ghost icon button (row action); `label` becomes its tooltip and accessible name. */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(replace?.category ?? "");
  const cat = categories.find((c) => c.key === category);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={replace ? "Upload new version" : "Upload document"}
      description={replace ? `Replaces “${replace.name}”. The previous version stays in the history.` : "Choose the category first, then attach the file."}
      trigger={
        iconOnly ? (
          <Button variant="ghost" size="icon-sm" aria-label={replace ? `${label}: ${replace.name}` : label} title={label}>
            <Upload className="size-4 text-subtle" />
          </Button>
        ) : (
          <Button variant={variant} size={size} icon={<Upload className="size-4" />}>
            {label}
          </Button>
        )
      }
    >
      <ActionForm
        action={registerDocument}
        values={{ personId, ...(replace ? { replaces: replace.id } : {}) }}
        successMessage="Document saved"
        onSuccess={() => setOpen(false)}
      >
        {replace ? (
          <input type="hidden" name="category" value={replace.category} />
        ) : (
          <Field label="Category" name="category" required>
            <Select id="category" name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Select a category</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                  {c.confidential ? " · restricted" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {cat ? (
          <>
            <Field label="File" name="fileId" required>
              <FileUpload name="fileId" multiple={false} label="Choose file" context={{ entityType: "user", entityId: personId, confidential: cat.confidential }} />
            </Field>
            {cat.hasExpiry && (
              <Field label="Expiry date" name="expiryDate" hint="Reminders are sent before it expires">
                <Input id="expiryDate" name="expiryDate" type="date" />
              </Field>
            )}
            <Field label="Notes" name="notes">
              <Input id="notes" name="notes" maxLength={500} placeholder="Optional" />
            </Field>
            <Checkbox key={cat.key} name="confidential" defaultChecked={cat.confidential} disabled={cat.confidential} label="Restricted — only people with access to confidential records can see it" />
            <FormActions>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton>{replace ? "Upload version" : "Save document"}</SubmitButton>
            </FormActions>
          </>
        ) : (
          <FormActions>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </FormActions>
        )}
      </ActionForm>
    </Dialog>
  );
}

export function DeleteDocumentButton({ personId, fileId, name }: { personId: string; fileId: string; name: string }) {
  return (
    <ActionButton
      variant="ghost"
      size="icon-sm"
      aria-label={`Delete ${name}`}
      title="Delete"
      action={() => deleteDocument(personId, fileId)}
      confirmTone="danger" confirmTitle="Delete document" confirmLabel="Delete" confirm={`Delete “${name}”? It is removed from the record; if an older version exists it becomes current again.`}
      successMessage="Document deleted"
    >
      <Trash2 className="size-4 text-subtle" />
    </ActionButton>
  );
}

/** HR switch: lets the person upload restricted document categories (ID, PAN, bank proof…) from their own profile. */
export function DocumentAccessSwitch({ personId, name, open }: { personId: string; name: string; open: boolean }) {
  const { run, pending } = useServerAction();
  return (
    <Switch
      checked={open}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.checked;
        run(() => setDocumentUploadOpen(personId, next));
      }}
      label={`Let ${name} upload restricted documents`}
      description={
        open
          ? "On — they can upload every category from My profile (files stay restricted: only they and authorised HR can open them)."
          : "Off — restricted categories (ID, PAN, address, bank proof…) can only be uploaded by HR."
      }
    />
  );
}
