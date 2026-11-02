"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff, ExternalLink, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { fmtDate } from "@/lib/time";
import { deleteCredential, revealCredential, saveCredential } from "./actions";
import { CREDENTIAL_CATEGORY_LABELS, CREDENTIAL_CATEGORY_OPTIONS } from "./meta";

export interface CredentialRow {
  id: string;
  platform: string;
  category: string;
  url?: string;
  valuesUpdatedAt: string;
}

interface Secret {
  username?: string;
  password: string;
  notes?: string;
}

async function fetchSecret(id: string, purpose: "reveal" | "copy" | "edit_open"): Promise<Secret | null> {
  try {
    const res = await revealCredential(id, purpose);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    return res.data;
  } catch {
    toast.error("Could not reach the server. Check your connection and try again.");
    return null;
  }
}

/**
 * Copies a value that is still being fetched. A ClipboardItem with a pending promise keeps the user's click
 * gesture alive in Safari; other browsers fall back to writeText once the value arrives.
 */
async function copyPending(value: Promise<string | null>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const blob = value.then((v) => {
        if (v === null) throw new Error("denied");
        return new Blob([v], { type: "text/plain" });
      });
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    }
  } catch {
    // fall through to writeText
  }
  const v = await value;
  if (v === null) return false;
  try {
    await navigator.clipboard.writeText(v);
    return true;
  } catch {
    toast.error("Your browser blocked clipboard access.");
    return false;
  }
}

export function CredentialList({ rows, filtered }: { rows: CredentialRow[]; filtered: boolean }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<KeyRound className="size-5" />}
        title={filtered ? "Nothing matches" : "No credentials stored yet"}
        description={filtered ? "Try another search or category." : "Store the company's logins — social media, email, hosting, banking portals — and open them whenever you need."}
        action={filtered ? undefined : <CredentialDialog />}
      />
    );
  }
  return (
    <ul>
      {rows.map((r) => (
        // Re-keyed when the values change, so a revealed panel never shows a stale password after an edit.
        <CredentialItem key={`${r.id}:${r.valuesUpdatedAt}`} row={r} />
      ))}
    </ul>
  );
}

function CredentialItem({ row }: { row: CredentialRow }) {
  const [secret, setSecret] = useState<Secret | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (secret) {
      setSecret(null);
      return;
    }
    setBusy(true);
    setSecret(await fetchSecret(row.id, "reveal"));
    setBusy(false);
  }

  async function copy(field: "username" | "password") {
    const value = secret ? Promise.resolve(secret[field] ?? "") : fetchSecret(row.id, "copy").then((s) => (s ? (s[field] ?? "") : null));
    if (await copyPending(value)) toast.success(field === "password" ? "Password copied" : "Username copied");
  }

  return (
    <li className="flex flex-col gap-2.5 border-t border-line-soft px-4 py-3.5 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <KeyRound className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-semibold break-words text-ink">{row.platform}</span>
            <Tag>{CREDENTIAL_CATEGORY_LABELS[row.category] ?? row.category}</Tag>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            {row.url && (
              <a href={/^https?:\/\//i.test(row.url) ? row.url : `https://${row.url}`} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 break-all text-brand-600 hover:underline">
                {row.url}
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            )}
            <span>Values updated {fmtDate(row.valuesUpdatedAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => void toggle()} disabled={busy} icon={secret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}>
            {secret ? "Hide" : "Reveal"}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Copy password for ${row.platform}`} title="Copy password" onClick={() => void copy("password")}>
            <Copy className="size-4 text-subtle" />
          </Button>
          <CredentialDialog row={row} />
          <ActionButton
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${row.platform}`}
            title="Delete"
            action={() => deleteCredential(row.id)}
            confirmTone="danger"
            confirmTitle="Delete credential"
            confirmLabel="Delete"
            confirm={`Delete the stored login for “${row.platform}”? This can't be undone.`}
            successMessage="Credential deleted"
          >
            <Trash2 className="size-4 text-subtle" />
          </ActionButton>
        </div>
      </div>
      {secret && (
        <dl className="grid gap-2 rounded-xl bg-field p-3 text-[13px] sm:grid-cols-2">
          <SecretField label="Username" value={secret.username} onCopy={() => void copy("username")} />
          <SecretField label="Password" value={secret.password} onCopy={() => void copy("password")} mono />
          {secret.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-muted">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-ink">{secret.notes}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

function SecretField({ label, value, onCopy, mono }: { label: string; value?: string; onCopy: () => void; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5">
        <span className={mono ? "min-w-0 font-mono break-all text-ink" : "min-w-0 break-all text-ink"}>{value || "—"}</span>
        {value && (
          <button type="button" onClick={onCopy} className="shrink-0 rounded-md p-1 text-subtle hover:bg-white hover:text-brand-600" aria-label={`Copy ${label.toLowerCase()}`} title={`Copy ${label.toLowerCase()}`}>
            <Copy className="size-3.5" />
          </button>
        )}
      </dd>
    </div>
  );
}

/** Add (no `row`) or edit a stored credential. Editing decrypts the current values first (logged). */
export function CredentialDialog({ row }: { row?: CredentialRow }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Secret | null>(null);
  const [show, setShow] = useState(false);

  async function onOpenChange(next: boolean) {
    if (next && row) {
      const s = await fetchSecret(row.id, "edit_open");
      if (!s) return;
      setCurrent(s);
    }
    if (!next) {
      setCurrent(null);
      setShow(false);
    }
    setOpen(next);
  }

  return (
    <>
      {row ? (
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.platform}`} title="Edit" onClick={() => void onOpenChange(true)}>
          <Pencil className="size-4 text-subtle" />
        </Button>
      ) : (
        <Button icon={<Plus className="size-4" />} onClick={() => void onOpenChange(true)}>
          Add credential
        </Button>
      )}
      <Dialog open={open} onOpenChange={(v) => void onOpenChange(v)} size="lg" title={row ? `Edit ${row.platform}` : "Add credential"} description="Stored encrypted. Only the Super Admin can open credential storage; every reveal is logged.">
        {open && (
          <ActionForm action={saveCredential} values={row ? { id: row.id } : undefined} successMessage="Credential saved" onSuccess={() => void onOpenChange(false)} className="gap-4">
            <FormGrid>
              <Field label="Platform" name="platform" required>
                <Input id="platform" name="platform" maxLength={120} defaultValue={row?.platform} placeholder="e.g. Instagram — @d4dx" autoComplete="off" />
              </Field>
              <Field label="Category" name="category" required>
                <Select id="category" name="category" defaultValue={row?.category ?? "social"}>
                  {CREDENTIAL_CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Login URL" name="url" className="sm:col-span-2">
                <Input id="url" name="url" maxLength={500} defaultValue={row?.url} placeholder="https://…" inputMode="url" autoComplete="off" />
              </Field>
              <Field label="Username / email" name="username">
                <Input id="username" name="username" maxLength={300} defaultValue={current?.username} autoComplete="off" spellCheck={false} />
              </Field>
              <Field label="Password" name="password" required={!row} hint={row ? "Leave empty to keep the current password" : undefined}>
                <div className="relative">
                  <Input id="password" name="password" type={show ? "text" : "password"} maxLength={2000} defaultValue={current?.password} autoComplete="new-password" spellCheck={false} className="pr-10 font-mono" />
                  <button type="button" onClick={() => setShow((v) => !v)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-subtle hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Notes" name="notes" className="sm:col-span-2" hint="Recovery codes, security questions, 2FA device… (encrypted)">
                <Textarea id="notes" name="notes" rows={3} maxLength={5000} defaultValue={current?.notes} />
              </Field>
            </FormGrid>
            <FormActions>
              <Button variant="secondary" onClick={() => void onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton>{row ? "Save changes" : "Store credential"}</SubmitButton>
            </FormActions>
          </ActionForm>
        )}
      </Dialog>
    </>
  );
}
