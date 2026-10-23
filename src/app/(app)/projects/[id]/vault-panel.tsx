"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  KeyRound,
  Lock,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/config-defaults";
import { serializeDotenv, type EnvEntry } from "@/lib/vault/dotenv";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton, useServerAction } from "@/components/ui/form";
import { Input, Radio, Select, Switch, Textarea } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { createVaultItem, deleteVaultItem, dismissRotationAdvice, revealVaultItem, updateVaultAccess, updateVaultItem } from "./vault-actions";

type Kind = "env" | "credential" | "note";

export interface VaultItemView {
  id: string;
  kind: Kind;
  name: string;
  description?: string;
  environment?: string;
  environmentLabel?: string;
  /** Variable names of an env file (values are never sent until revealed). */
  keys: string[];
  url?: string;
  username?: string;
  hasNotes: boolean;
  entryCount: number;
  audience: "team" | "selected";
  members: string[];
  audienceLabel: string;
  notifyOnReveal: boolean;
  rotateBy?: string;
  rotateByLabel?: string;
  rotationOverdue: boolean;
  rotationAdvised?: string;
  version: number;
  updatedLabel: string;
  createdBy: string;
  canManage: boolean;
  /** Set when the item can't be decrypted (wrong master key). */
  broken?: string;
}

export interface VaultEventView {
  id: string;
  who: string;
  action: string;
  tone: Tone;
  itemName: string;
  field?: string;
  when: string;
  ago: string;
  ip?: string;
}

/** Revealed values are wiped from memory after this long. */
const REVEAL_MS = 30_000;
const MASK = "••••••••••••";

const ENVIRONMENTS = [
  { value: "development", label: "Development" },
  { value: "staging", label: "Staging" },
  { value: "testing", label: "Testing" },
  { value: "production", label: "Production" },
  { value: "other", label: "Other" },
];

const ENV_TONE: Record<string, Tone> = { production: "red", staging: "amber", testing: "purple", development: "blue", other: "gray" };

const KIND_META: Record<Kind, { label: string; plural: string; icon: typeof FileCode2 }> = {
  env: { label: "Environment file", plural: "Env files", icon: FileCode2 },
  credential: { label: "Login / API credential", plural: "Credentials", icon: KeyRound },
  note: { label: "Secure note", plural: "Notes", icon: NotebookPen },
};

/* ------------------------------------------------------------------ */
/* Reveal helpers                                                      */
/* ------------------------------------------------------------------ */

async function fetchEntries(projectId: string, itemId: string, purpose: "reveal" | "copy" | "download" | "edit_open", field?: string): Promise<EnvEntry[] | null> {
  try {
    const res = await revealVaultItem(projectId, itemId, purpose, field);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    return res.data.entries;
  } catch {
    toast.error("Could not reach the server. Check your connection and try again.");
    return null;
  }
}

/**
 * Copies a value that is still being fetched. A ClipboardItem with a pending promise keeps the user's
 * click gesture alive in Safari; other browsers fall back to writeText once the value arrives.
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

function fileNameFor(name: string): string {
  const clean = name.trim().replace(/[^\w.-]+/g, "-");
  return clean.startsWith(".env") || clean.endsWith(".env") ? clean : `${clean || "secrets"}.env`;
}

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function generatePassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
  const out: string[] = [];
  const buf = new Uint32Array(length * 2);
  crypto.getRandomValues(buf);
  // Rejection sampling avoids modulo bias.
  const limit = Math.floor(0x1_0000_0000 / alphabet.length) * alphabet.length;
  for (const n of buf) {
    if (n < limit) out.push(alphabet[n % alphabet.length]);
    if (out.length === length) break;
  }
  return out.length === length ? out.join("") : generatePassword(length);
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function VaultPanel({
  projectId,
  role,
  items,
  events,
  teamOptions,
  whoCanSee,
  empty,
}: {
  projectId: string;
  role: "owner" | "member";
  items: VaultItemView[];
  events: VaultEventView[];
  teamOptions: PickerOption[];
  whoCanSee: string;
  empty: ReactNode;
}) {
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [creating, setCreating] = useState<Kind | null>(null);
  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);
  const attention = items.filter((i) => i.rotationAdvised || i.rotationOverdue).length;

  const addMenu = (
    <Menu
      label="Add secret"
      trigger={
        <Button size="sm" icon={<Plus className="size-4" aria-hidden />}>
          Add secret
        </Button>
      }
      items={(Object.keys(KIND_META) as Kind[]).map((k) => {
        const Icon = KIND_META[k].icon;
        return { label: KIND_META[k].label, icon: <Icon className="size-4 text-muted" aria-hidden />, onSelect: () => setCreating(k) };
      })}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Secrets vault" subtitle="Environment files, logins and notes shared with the project team" action={addMenu} />
        <CardBody className="flex flex-col gap-4 pt-0">
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-[13px] text-ink-2">
            <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-brand-600" aria-hidden />
            <p className="min-w-0 flex-1 leading-relaxed">
              Encrypted with AES-256-GCM using a key unique to this project. Visible to {whoCanSee} — not to anyone else, whatever their role. Every view, copy and download is logged.
            </p>
          </div>

          {attention > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-[#f6dfb2] bg-warning-bg px-4 py-3 text-[13px] text-[#6f4000]">
              <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-warning" aria-hidden />
              <p>
                {attention} {attention === 1 ? "secret needs" : "secrets need"} rotating — change the value at the provider, then update it here.
              </p>
            </div>
          )}

          {items.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter secrets">
              {(["all", "env", "credential", "note"] as const).map((k) => {
                const count = k === "all" ? items.length : items.filter((i) => i.kind === k).length;
                if (k !== "all" && count === 0) return null;
                const on = filter === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilter(k)}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                      on ? "bg-brand-600 font-semibold text-white" : "border border-line-strong bg-white font-medium text-ink-2 hover:bg-field",
                    )}
                  >
                    {k === "all" ? "All" : KIND_META[k].plural}
                    <span className="opacity-80 tabular">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {items.length === 0 ? (
            empty
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((item) => (
                <li key={item.id}>
                  <VaultItemCard projectId={projectId} item={item} teamOptions={teamOptions} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {role === "owner" && <AccessLog events={events} />}

      {creating && (
        <ItemDialog
          key={creating}
          open
          onOpenChange={(o) => !o && setCreating(null)}
          projectId={projectId}
          kind={creating}
          teamOptions={teamOptions}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Item card                                                           */
/* ------------------------------------------------------------------ */

function VaultItemCard({ projectId, item, teamOptions }: { projectId: string; item: VaultItemView; teamOptions: PickerOption[] }) {
  const [revealed, setRevealed] = useState<{ values: Record<string, string>; stamp: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(item.keys.length <= 8);
  const [dialog, setDialog] = useState<"edit" | "access" | null>(null);
  const confirm = useConfirm();
  const { run } = useServerAction();
  const Icon = KIND_META[item.kind].icon;

  // Wipe revealed values after REVEAL_MS; each new reveal (new stamp) restarts the timer.
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  const merge = (entries: EnvEntry[]) =>
    setRevealed((prev) => ({ values: { ...(prev?.values ?? {}), ...Object.fromEntries(entries.map((e) => [e.key, e.value])) }, stamp: (prev?.stamp ?? 0) + 1 }));

  const reveal = async (field?: string) => {
    setBusy(field ?? "*");
    const entries = await fetchEntries(projectId, item.id, "reveal", field);
    setBusy(null);
    if (entries) merge(entries);
  };

  const copy = async (field?: string) => {
    setBusy(`copy:${field ?? "*"}`);
    const value = fetchEntries(projectId, item.id, "copy", field).then((entries) =>
      entries ? (field ? (entries[0]?.value ?? "") : item.kind === "env" ? serializeDotenv(entries) : entries.map((e) => `${e.key}: ${e.value}`).join("\n")) : null,
    );
    const ok = await copyPending(value);
    setBusy(null);
    if (ok) toast.success(field ? `${field} copied` : "Copied to clipboard");
  };

  const download = async () => {
    setBusy("download");
    const entries = await fetchEntries(projectId, item.id, "download");
    setBusy(null);
    if (!entries) return;
    downloadText(serializeDotenv(entries), fileNameFor(item.name));
    toast.success("Downloaded — delete the file when you no longer need it");
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${item.name}?`,
      description: "The secret is permanently removed from the vault for everyone. Make sure nothing still depends on it.",
      confirmLabel: "Delete secret",
      tone: "danger",
    });
    if (ok) run(() => deleteVaultItem(projectId, item.id), { successMessage: "Secret deleted" });
  };

  const menu: (MenuItem | "separator" | false)[] = item.canManage
    ? [
        { label: "Edit values", icon: <Pencil className="size-4 text-muted" aria-hidden />, onSelect: () => setDialog("edit"), disabled: Boolean(item.broken) },
        { label: "Sharing & alerts", icon: <Users className="size-4 text-muted" aria-hidden />, onSelect: () => setDialog("access") },
        Boolean(item.rotationAdvised) && {
          label: "Dismiss rotation advice",
          icon: <RefreshCw className="size-4 text-muted" aria-hidden />,
          onSelect: () => run(() => dismissRotationAdvice(projectId, item.id), { successMessage: "Rotation advice dismissed" }),
        },
        "separator",
        { label: "Delete", icon: <Trash2 className="size-4" aria-hidden />, danger: true, onSelect: remove },
      ]
    : [];

  const values = revealed?.values ?? {};
  const allShown = item.kind === "env" ? item.keys.length > 0 && item.keys.every((k) => k in values) : "password" in values || "content" in values;
  const visibleKeys = expanded ? item.keys : item.keys.slice(0, 6);

  return (
    <article className={cn("relative overflow-hidden rounded-xl border bg-white", item.environment === "production" ? "border-[#f3c2c2]" : "border-line")}>
      {revealed && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-line-soft" aria-hidden>
          <div
            key={revealed.stamp}
            className="h-full origin-left bg-warning"
            ref={(el) => {
              el?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: REVEAL_MS, fill: "forwards" });
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-start gap-3 px-4 pt-4 pb-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[10px]", item.environment === "production" ? "bg-danger-bg text-danger" : "bg-brand-50 text-brand-600")}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-[14px] font-semibold break-all text-ink">{item.name}</h3>
            {item.environmentLabel && (
              <Chip tone={ENV_TONE[item.environment ?? "other"]} size="sm">
                {item.environmentLabel}
              </Chip>
            )}
            {item.kind === "env" && (
              <Chip tone="gray" size="sm" dot={false}>
                {item.entryCount} {item.entryCount === 1 ? "variable" : "variables"}
              </Chip>
            )}
            <Chip tone={item.audience === "team" ? "blue" : "purple"} size="sm" dot={false}>
              {item.audience === "team" ? <Users className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
              {item.audienceLabel}
            </Chip>
            {item.notifyOnReveal && (
              <span title="The project manager is notified when someone opens this" className="text-subtle">
                <Bell className="size-3.5" aria-label="Access alerts on" />
              </span>
            )}
          </div>
          {item.description && <p className="mt-1 text-[13px] text-muted">{item.description}</p>}
          <p className="mt-1 text-xs text-subtle">
            v{item.version} · updated {item.updatedLabel} · added by {item.createdBy}
            {item.rotateByLabel && (
              <span className={cn("ml-1.5 inline-flex items-center gap-1", item.rotationOverdue && "font-semibold text-danger")}>
                <CalendarClock className="size-3" aria-hidden />
                {item.rotationOverdue ? `Rotation overdue (${item.rotateByLabel})` : `Rotate by ${item.rotateByLabel}`}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!item.broken && (
            <>
              {allShown ? (
                <Button size="sm" variant="secondary" icon={<EyeOff className="size-4" aria-hidden />} onClick={() => setRevealed(null)}>
                  Hide
                </Button>
              ) : (
                <Button size="sm" variant="secondary" loading={busy === "*"} icon={<Eye className="size-4" aria-hidden />} onClick={() => reveal(item.kind === "credential" ? "password" : undefined)}>
                  {item.kind === "env" ? "Reveal all" : "Reveal"}
                </Button>
              )}
              <Button size="sm" variant="secondary" loading={busy === "copy:*"} icon={<Copy className="size-4" aria-hidden />} onClick={() => copy(item.kind === "credential" ? "password" : undefined)}>
                {item.kind === "env" ? "Copy .env" : item.kind === "credential" ? "Copy password" : "Copy"}
              </Button>
              {item.kind === "env" && (
                <Button size="icon-sm" variant="secondary" loading={busy === "download"} aria-label={`Download ${item.name}`} title="Download .env" onClick={download}>
                  {busy === "download" ? null : <Download className="size-4" aria-hidden />}
                </Button>
              )}
            </>
          )}
          <Menu items={menu} />
        </div>
      </div>

      {item.rotationAdvised && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-2 text-xs text-[#6f4000]">
          <RefreshCw className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Rotate this secret.</strong> {item.rotationAdvised}.
          </span>
        </div>
      )}

      {item.broken ? (
        <p className="mx-4 mb-4 rounded-lg bg-danger-bg px-3 py-2 text-xs text-[#8a1b1b]">{item.broken}</p>
      ) : item.kind === "env" ? (
        <div className="border-t border-line-soft">
          <dl className="divide-y divide-line-soft">
            {visibleKeys.map((k) => (
              <SecretRow key={k} label={k} mono value={values[k]} busy={busy} onReveal={() => reveal(k)} onCopy={() => copy(k)} />
            ))}
          </dl>
          {item.keys.length > 6 && (
            <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full border-t border-line-soft px-4 py-2 text-left text-[13px] font-semibold text-brand-600 hover:bg-field">
              {expanded ? "Show fewer" : `Show all ${item.keys.length} variables`}
            </button>
          )}
        </div>
      ) : item.kind === "credential" ? (
        <dl className="divide-y divide-line-soft border-t border-line-soft">
          {item.url && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <dt className="w-28 shrink-0 text-xs font-semibold tracking-wide text-muted uppercase">URL</dt>
              <dd className="min-w-0 flex-1 truncate text-[13px]">
                {/^https?:\/\//i.test(item.url) ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
                    {item.url}
                  </a>
                ) : (
                  item.url
                )}
              </dd>
            </div>
          )}
          {item.username && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <dt className="w-28 shrink-0 text-xs font-semibold tracking-wide text-muted uppercase">Username</dt>
              <dd className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{item.username}</span>
                <IconButton label="Copy username" onClick={() => navigator.clipboard.writeText(item.username ?? "").then(() => toast.success("Username copied"), () => toast.error("Your browser blocked clipboard access."))}>
                  <Copy className="size-4" aria-hidden />
                </IconButton>
              </dd>
            </div>
          )}
          <SecretRow label="Password" value={values.password} busy={busy} field="password" onReveal={() => reveal("password")} onCopy={() => copy("password")} />
          {item.hasNotes && <SecretRow label="Notes" value={values.notes} busy={busy} field="notes" onReveal={() => reveal("notes")} onCopy={() => copy("notes")} multiline />}
        </dl>
      ) : (
        <dl className="border-t border-line-soft">
          <SecretRow label="Note" value={values.content} busy={busy} field="content" onReveal={() => reveal("content")} onCopy={() => copy("content")} multiline />
        </dl>
      )}

      {dialog === "edit" && <ItemDialog open onOpenChange={(o) => !o && setDialog(null)} projectId={projectId} kind={item.kind} item={item} teamOptions={teamOptions} />}
      {dialog === "access" && <AccessDialog open onOpenChange={(o) => !o && setDialog(null)} projectId={projectId} item={item} teamOptions={teamOptions} />}
    </article>
  );
}

function IconButton({ label, onClick, loading, children }: { label: string; onClick: () => void; loading?: boolean; children: ReactNode }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={label} loading={loading} onClick={onClick}>
      {loading ? null : children}
    </Button>
  );
}

function SecretRow({
  label,
  value,
  field,
  busy,
  mono,
  multiline,
  onReveal,
  onCopy,
}: {
  label: string;
  value: string | undefined;
  field?: string;
  busy: string | null;
  mono?: boolean;
  multiline?: boolean;
  onReveal: () => void;
  onCopy: () => void;
}) {
  const key = field ?? label;
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5">
      <dt className={cn("shrink-0 pt-1", mono ? "w-full font-mono text-[12.5px] font-semibold break-all text-ink sm:w-64" : "w-28 text-xs font-semibold tracking-wide text-muted uppercase")}>{label}</dt>
      <dd className="flex min-w-0 flex-1 items-start gap-1">
        <span
          className={cn(
            "min-w-0 flex-1 rounded-md px-2 py-1 font-mono text-[12.5px]",
            value === undefined ? "tracking-[0.15em] text-subtle select-none" : "bg-warning-bg/60 text-ink",
            value !== undefined && (multiline ? "break-words whitespace-pre-wrap" : "break-all"),
          )}
        >
          {value === undefined ? MASK : value === "" ? <em className="font-sans text-subtle not-italic">(empty)</em> : value}
        </span>
        {value === undefined && (
          <IconButton label={`Reveal ${label}`} loading={busy === key} onClick={onReveal}>
            <Eye className="size-4" aria-hidden />
          </IconButton>
        )}
        <IconButton label={`Copy ${label}`} loading={busy === `copy:${key}`} onClick={onCopy}>
          <Copy className="size-4" aria-hidden />
        </IconButton>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit dialog                                                */
/* ------------------------------------------------------------------ */

function ItemDialog({
  open,
  onOpenChange,
  projectId,
  kind,
  item,
  teamOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  kind: Kind;
  item?: VaultItemView;
  teamOptions: PickerOption[];
}) {
  const editing = Boolean(item);
  // When editing, current values are fetched (and logged) once the dialog opens.
  const [current, setCurrent] = useState<Record<string, string> | null>(editing ? null : {});
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);

  useEffect(() => {
    if (!item || loading.current) return;
    loading.current = true;
    fetchEntries(projectId, item.id, "edit_open").then((entries) => {
      if (!entries) {
        setFailed(true);
        return;
      }
      setCurrent(kind === "env" ? { content: serializeDotenv(entries) } : Object.fromEntries(entries.map((e) => [e.key, e.value])));
    });
  }, [item, projectId, kind]);

  const title = `${editing ? "Edit" : "Add"} ${KIND_META[kind].label.toLowerCase()}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={title} description={editing ? "Saving new values creates a new version and clears any rotation advice." : "Values are encrypted before they are stored."}>
      {failed ? (
        <p className="text-sm text-danger">The current values could not be loaded.</p>
      ) : current === null ? (
        <p className="py-6 text-center text-sm text-muted">Decrypting…</p>
      ) : (
        <ItemForm projectId={projectId} kind={kind} item={item} current={current} teamOptions={teamOptions} onDone={() => onOpenChange(false)} />
      )}
    </Dialog>
  );
}

function ItemForm({
  projectId,
  kind,
  item,
  current,
  teamOptions,
  onDone,
}: {
  projectId: string;
  kind: Kind;
  item?: VaultItemView;
  current: Record<string, string>;
  teamOptions: PickerOption[];
  onDone: () => void;
}) {
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const action = item ? updateVaultItem.bind(null, projectId, item.id) : createVaultItem.bind(null, projectId);

  const importFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 64 * 1024) {
      toast.error("That file is larger than 64 KB.");
      return;
    }
    file.text().then((text) => {
      if (contentRef.current) contentRef.current.value = text;
    });
  };

  return (
    <ActionForm action={action} values={{ kind }} successMessage={item ? "Secret updated" : "Secret saved"} onSuccess={onDone} autoComplete="off">
      <FormGrid>
        <Field label="Name" name="name" required hint={kind === "env" ? "e.g. .env.production, api/.env.local" : kind === "credential" ? "e.g. AWS console, Stripe live key" : "e.g. Server SSH access"}>
          <Input id="name" name="name" defaultValue={item?.name ?? (kind === "env" ? ".env" : "")} maxLength={120} autoComplete="off" />
        </Field>
        {kind === "env" ? (
          <Field label="Environment" name="environment" required>
            <Select id="environment" name="environment" defaultValue={item?.environment ?? "development"}>
              {ENVIRONMENTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Rotate by" name="rotateBy" hint="Optional reminder date">
            <Input id="rotateBy" name="rotateBy" type="date" defaultValue={item?.rotateBy ?? ""} />
          </Field>
        )}
      </FormGrid>

      {kind === "env" && (
        <Field
          label="Variables"
          name="content"
          required
          hint="Paste the .env file. Comments and blank lines are ignored; quote multi-line values with double quotes."
        >
          <div className="flex flex-col gap-2">
            <Textarea
              id="content"
              name="content"
              ref={contentRef}
              rows={12}
              spellCheck={false}
              autoComplete="off"
              defaultValue={current.content ?? ""}
              placeholder={"DATABASE_URL=postgres://user:pass@host:5432/db\nAPI_KEY=sk_live_…\n# comments are ignored"}
              className="font-mono text-[13px] sm:text-[13px]"
            />
            <div>
              <input ref={fileRef} type="file" accept=".env,text/plain,*/*" className="sr-only" tabIndex={-1} onChange={(e) => importFile(e.target.files?.[0])} />
              <Button size="sm" variant="secondary" icon={<Upload className="size-4" aria-hidden />} onClick={() => fileRef.current?.click()}>
                Import .env file
              </Button>
            </div>
          </div>
        </Field>
      )}

      {kind === "credential" && (
        <>
          <FormGrid>
            <Field label="URL" name="url">
              <Input id="url" name="url" defaultValue={current.url ?? ""} placeholder="https://console.aws.amazon.com" autoComplete="off" />
            </Field>
            <Field label="Username / key ID" name="username">
              <Input id="username" name="username" defaultValue={current.username ?? ""} autoComplete="off" />
            </Field>
          </FormGrid>
          <Field label="Password / secret" name="password" required={!item} hint={item ? "Leave blank to keep the current password." : undefined}>
            <div className="flex gap-2">
              <Input
                id="password"
                name="password"
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                spellCheck={false}
                className="font-mono"
                placeholder={item ? "Unchanged" : ""}
              />
              <Button size="icon" variant="secondary" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((s) => !s)}>
                {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </Button>
              <Button
                size="icon"
                variant="secondary"
                aria-label="Generate a strong password"
                title="Generate a strong password"
                onClick={() => {
                  if (!passwordRef.current) return;
                  passwordRef.current.value = generatePassword();
                  setShowPassword(true);
                }}
              >
                <Wand2 className="size-4" aria-hidden />
              </Button>
            </div>
          </Field>
          <Field label="Notes" name="notes" hint="Recovery codes, 2FA owner, extra steps — encrypted like the password.">
            <Textarea id="notes" name="notes" rows={3} defaultValue={current.notes ?? ""} />
          </Field>
        </>
      )}

      {kind === "note" && (
        <Field label="Note" name="content" required>
          <Textarea id="content" name="content" rows={8} spellCheck={false} defaultValue={current.content ?? ""} className="font-mono text-[13px] sm:text-[13px]" />
        </Field>
      )}

      <FormGrid>
        <Field label="Description" name="description" hint="Optional, not encrypted — don't put secrets here.">
          <Input id="description" name="description" defaultValue={item?.description ?? ""} maxLength={300} />
        </Field>
        {kind === "env" && (
          <Field label="Rotate by" name="rotateBy" hint="Optional reminder date">
            <Input id="rotateBy" name="rotateBy" type="date" defaultValue={item?.rotateBy ?? ""} />
          </Field>
        )}
      </FormGrid>

      {!item && <AccessFields teamOptions={teamOptions} audience="team" members={[]} notifyOnReveal={false} />}

      <FormActions>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton icon={<Lock className="size-4" aria-hidden />}>{item ? "Save new version" : "Encrypt & save"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Sharing                                                             */
/* ------------------------------------------------------------------ */

function AccessFields({ teamOptions, audience, members, notifyOnReveal }: { teamOptions: PickerOption[]; audience: "team" | "selected"; members: string[]; notifyOnReveal: boolean }) {
  const [mode, setMode] = useState(audience);
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <legend className="px-1 text-[13px] font-semibold text-ink-2">Who can see it</legend>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        <Radio name="audience" value="team" checked={mode === "team"} onChange={() => setMode("team")} label="Whole project team" />
        <Radio name="audience" value="selected" checked={mode === "selected"} onChange={() => setMode("selected")} label="Only selected team members" />
      </div>
      {mode === "selected" && (
        <Field name="members" hint="The project manager and the person who added it always have access. Leave empty for the project manager only.">
          <PeoplePicker name="members" multiple options={teamOptions} defaultValue={members} placeholder="Choose team members" />
        </Field>
      )}
      <Switch name="notifyOnReveal" defaultChecked={notifyOnReveal} label="Alert on access" description="Notify the project manager and the owner whenever someone views, copies or downloads it." />
    </fieldset>
  );
}

function AccessDialog({ open, onOpenChange, projectId, item, teamOptions }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; item: VaultItemView; teamOptions: PickerOption[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Sharing · ${item.name}`} description="Access is limited to this project's team. Changes apply immediately.">
      <ActionForm action={updateVaultAccess.bind(null, projectId, item.id)} successMessage="Sharing updated" onSuccess={() => onOpenChange(false)}>
        <AccessFields teamOptions={teamOptions} audience={item.audience} members={item.members} notifyOnReveal={item.notifyOnReveal} />
        <FormActions>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton>Save sharing</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Access log                                                          */
/* ------------------------------------------------------------------ */

function AccessLog({ events }: { events: VaultEventView[] }) {
  return (
    <Card>
      <CardHeader title="Vault access log" subtitle="Last 60 events · visible to the project manager and the super admin" />
      <CardBody className="pt-0">
        {events.length === 0 ? (
          <p className="text-[13px] text-muted">No activity yet.</p>
        ) : (
          <ol className="flex flex-col">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft py-2.5 text-[13px] first:border-t-0">
                <Chip tone={e.tone} size="sm">
                  {e.action}
                </Chip>
                <span className="min-w-0 flex-1">
                  <strong className="font-semibold text-ink">{e.who}</strong> <span className="text-muted">·</span> <span className="font-mono text-[12.5px] text-ink-2">{e.itemName}</span>
                  {e.field && <span className="font-mono text-[12.5px] text-muted"> → {e.field}</span>}
                </span>
                <span className="text-xs text-subtle" title={e.when}>
                  {e.ago}
                  {e.ip ? ` · ${e.ip}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
