"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, DatabaseBackup, Download, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/ui/actions";
import { Button, buttonClass } from "@/components/ui/button";
import { Chip, Tag } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, EmptyState } from "@/components/ui/page";
import { TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { fileSize } from "@/lib/format";
import { fmtDateTime } from "@/lib/time";
import type { RestoreResult } from "@/lib/backup";
import { restoreBackupAction, runBackupNow, verifyBackupAction, type VerificationView } from "./backup-actions";
import { SettingsCard } from "./ui";

export interface BackupRow {
  id: string;
  createdAt: string;
  size: number;
  trigger: "manual" | "scheduled" | "pre_restore";
  status: "completed" | "failed";
  error?: string;
  byName?: string;
  restoredAt?: string;
  restoredBy?: string;
  total: number;
  collections: { name: string; count: number }[];
}

const TRIGGER_LABEL = { manual: "Manual", scheduled: "Automatic", pre_restore: "Safety (pre-restore)" } as const;

function VerifyButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<VerificationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setOpen(true);
    setResult(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await verifyBackupAction(id);
        if (res.ok) setResult(res.data);
        else setError(res.error);
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" icon={<ShieldCheck className="size-4" />} onClick={start}>
        Verify
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Backup verification"
        description="Downloads the backup, unpacks it and checks every collection. No data is changed."
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        {pending && <p className="py-6 text-center text-sm text-muted">Downloading and checking the backup…</p>}
        {error && <Alert tone="danger">{error}</Alert>}
        {result && (
          <div className="flex flex-col gap-3">
            {result.ok ? (
              <Alert tone="success" title="Verification passed.">
                {result.total.toLocaleString("en-IN")} records in {result.collections.length} collections can be read back and match what was recorded when the backup was made.
              </Alert>
            ) : (
              <Alert tone="danger" title="Verification failed.">
                {result.issues.join("; ")}
              </Alert>
            )}
            {result.missing.length > 0 && (
              <Alert tone="warning">
                Not in this backup (left untouched on restore): {result.missing.join(", ")}.
              </Alert>
            )}
            {result.unknown.length > 0 && <Alert tone="info">Ignored on restore (not managed by this version): {result.unknown.join(", ")}.</Alert>}
            <TableWrap tablet={[1, 2, 3, 4]} className="max-h-72 rounded-xl border border-line">
              <THead>
                <Th>Collection</Th>
                <Th align="right">In file</Th>
                <Th align="right">Recorded</Th>
                <Th align="center">Match</Th>
              </THead>
              <tbody>
                {result.collections.map((c) => (
                  <Tr key={c.name}>
                    <Td className="font-mono text-xs">{c.name}</Td>
                    <Td align="right">{c.count}</Td>
                    <Td align="right">{c.expected ?? "—"}</Td>
                    <Td align="center">{c.match ? <CheckCircle2 className="mx-auto size-4 text-success" aria-label="Matches" /> : <XCircle className="mx-auto size-4 text-danger" aria-label="Mismatch" />}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Dialog>
    </>
  );
}

function RestoreButton({ row }: { row: BackupRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      if (result) router.refresh();
      setConfirmation("");
      setResult(null);
      setError(null);
    }
  }

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await restoreBackupAction(row.id, confirmation);
        if (res.ok) {
          setResult(res.data);
          toast.success(res.data.errors.length ? "Restore finished with errors" : "Restore finished");
        } else {
          setError(res.error);
        }
      } catch {
        setError("The request did not complete. Check the backup list and the audit trail before trying again.");
      }
    });
  }

  return (
    <>
      <Button variant="danger-outline" size="sm" onClick={() => setOpen(true)}>
        Restore
      </Button>
      <Dialog
        open={open}
        onOpenChange={reset}
        title="Restore this backup?"
        description={`Backup of ${fmtDateTime(row.createdAt)} · ${row.total.toLocaleString("en-IN")} records`}
        size="lg"
        footer={
          result ? (
            <Button onClick={() => reset(false)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={pending} onClick={() => reset(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={pending} disabled={confirmation.trim() !== "RESTORE"} onClick={run}>
                Restore data
              </Button>
            </>
          )
        }
      >
        {!result && (
          <div className="flex flex-col gap-4">
            <Alert tone="danger" title="This replaces live data.">
              Every business collection in the backup is deleted and re-created from the file. Anything added or changed after {fmtDateTime(row.createdAt)}, including audit trail entries, is lost. Sign-in sessions are not affected.
            </Alert>
            <p className="text-[13px] text-ink-2">A safety backup of the current data is taken first, so this can be undone by restoring that backup. Keep this window open until it finishes.</p>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              Type RESTORE to confirm
              <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} placeholder="RESTORE" disabled={pending} />
            </label>
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        )}
        {result && (
          <div className="flex flex-col gap-3">
            {result.errors.length === 0 ? (
              <Alert tone="success" title="Restore complete.">
                {result.collections.reduce((n, c) => n + c.restored, 0).toLocaleString("en-IN")} records restored across {result.collections.length} collections.
              </Alert>
            ) : (
              <Alert tone="danger" title="Restore finished with errors.">
                {result.errors.join("; ")}. A safety backup of the previous data was created; restore it to roll back.
              </Alert>
            )}
            <TableWrap phone={[1, 2, 3]} tablet={[1, 2, 3]} className="max-h-64 rounded-xl border border-line">
              <THead>
                <Th>Collection</Th>
                <Th align="right">Expected</Th>
                <Th align="right">Restored</Th>
              </THead>
              <tbody>
                {result.collections.map((c) => (
                  <Tr key={c.name}>
                    <Td className="font-mono text-xs">{c.name}</Td>
                    <Td align="right">{c.expected}</Td>
                    <Td align="right" className={c.error ? "font-semibold text-danger" : undefined}>
                      {c.restored}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Dialog>
    </>
  );
}

export function BackupPanel({ backups, storageConfigured, autoBackup, retention }: { backups: BackupRow[]; storageConfigured: boolean; autoBackup: boolean; retention: number }) {
  return (
    <SettingsCard
      title="Backup & restore"
      description="Each backup is a compressed copy of every business collection, stored privately in file storage."
      action={
        storageConfigured ? (
          <ActionButton action={runBackupNow} successMessage="Backup completed" icon={<DatabaseBackup className="size-4" />}>
            Run backup now
          </ActionButton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {!storageConfigured && (
          <Alert tone="warning" title="File storage is not configured.">
            Backups are written to DigitalOcean Spaces. Set DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT and DO_SPACES_BUCKET on the server to create, verify, download or restore backups. Existing backup records are listed below for reference.
          </Alert>
        )}
        <p className="text-[13px] text-muted">
          Automatic daily backup is <strong className="text-ink">{autoBackup ? "on" : "off"}</strong> · the newest <strong className="text-ink">{retention}</strong> backups are kept · change this under Data &amp; security. Use <em>Verify</em> regularly: it downloads the file and reads every record without touching live data.
        </p>
        {backups.length === 0 ? (
          <EmptyState icon={<DatabaseBackup className="size-5" />} title="No backups yet" description={storageConfigured ? "Run your first backup now. Automatic backups appear here too." : "Configure file storage to start creating backups."} />
        ) : (
          <TableWrap phone={[1, 5, 7]} tablet={[1, 2, 3, 5, 7]} className="-mx-5">
            <THead>
              <Th>Created</Th>
              <Th align="right">Size</Th>
              <Th>Records</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>By</Th>
              <Th align="right">
                <span className="sr-only">Actions</span>
              </Th>
            </THead>
            <tbody>
              {backups.map((b) => (
                <Tr key={b.id}>
                  <Td className="whitespace-nowrap font-medium">{fmtDateTime(b.createdAt)}</Td>
                  <Td align="right">{b.status === "completed" ? fileSize(b.size) : "—"}</Td>
                  <Td>
                    {b.status === "completed" ? (
                      <details>
                        <summary className="cursor-pointer text-ink-2 select-none">{b.total.toLocaleString("en-IN")} in {b.collections.length} collections</summary>
                        <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted">
                          {b.collections.map((c) => (
                            <li key={c.name} className="flex justify-between gap-2">
                              <span className="font-mono">{c.name}</span>
                              <span className="tabular">{c.count}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <Tag tone={b.trigger === "scheduled" ? "blue" : b.trigger === "pre_restore" ? "purple" : "gray"}>{TRIGGER_LABEL[b.trigger]}</Tag>
                  </Td>
                  <Td>
                    {b.status === "completed" ? <Chip tone="green">Completed</Chip> : <Chip tone="red">Failed</Chip>}
                    {b.error && <div className="mt-1 max-w-56 text-xs text-danger">{b.error}</div>}
                    {b.restoredAt && <div className="mt-1 text-xs text-muted">Restored {fmtDateTime(b.restoredAt)}{b.restoredBy ? ` by ${b.restoredBy}` : ""}</div>}
                  </Td>
                  <Td className="text-ink-2">{b.byName ?? "System"}</Td>
                  <Td align="right">
                    {b.status === "completed" && storageConfigured && (
                      <div className="flex justify-end gap-1.5">
                        <VerifyButton id={b.id} />
                        <a href={`/api/backup/${b.id}`} className={buttonClass("secondary", "sm")}>
                          <Download className="size-4" aria-hidden />
                          Download
                        </a>
                        <RestoreButton row={b} />
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </SettingsCard>
  );
}
