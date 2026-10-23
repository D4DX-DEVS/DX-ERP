"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { fileSize } from "@/lib/format";

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  url?: string;
}

export interface UploadContext {
  entityType: string;
  entityId?: string;
  category?: string;
  confidential?: boolean;
  expiryDate?: string;
  isPublic?: boolean;
}

/** Uploads one file to /api/files/upload and resolves with its stored-file record. */
export async function uploadFile(file: File, ctx: UploadContext): Promise<UploadedFile> {
  const body = new FormData();
  body.set("file", file);
  body.set("entityType", ctx.entityType);
  if (ctx.entityId) body.set("entityId", ctx.entityId);
  if (ctx.category) body.set("category", ctx.category);
  if (ctx.confidential) body.set("confidential", "true");
  if (ctx.expiryDate) body.set("expiryDate", ctx.expiryDate);
  if (ctx.isPublic) body.set("public", "true");
  const res = await fetch("/api/files/upload", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; file?: UploadedFile };
  if (!res.ok || !json.ok || !json.file) throw new Error(json.error || "Upload failed");
  return json.file;
}

/**
 * Multi-file attachment input. Uploaded file ids are posted with the surrounding form as
 * `${name}[]` hidden inputs, so the server action receives `attachments: string[]`.
 */
export function FileUpload({
  name = "attachments",
  context,
  multiple = true,
  accept,
  label = "Attach files",
  hint = "PDF, images, Office documents · up to 10 MB each",
  initial = [],
  onChange,
  className,
}: {
  name?: string;
  context: UploadContext;
  multiple?: boolean;
  accept?: string;
  label?: string;
  hint?: string;
  initial?: UploadedFile[];
  onChange?: (files: UploadedFile[]) => void;
  className?: string;
}) {
  const [files, setFiles] = useState<UploadedFile[]>(initial);
  const [busy, setBusy] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (next: UploadedFile[]) => {
    setFiles(next);
    onChange?.(next);
  };

  async function handle(list: FileList | null) {
    if (!list || list.length === 0) return;
    const selected = Array.from(list);
    setBusy((n) => n + selected.length);
    const added: UploadedFile[] = [];
    for (const f of selected) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 10 MB`);
        setBusy((n) => n - 1);
        continue;
      }
      try {
        added.push(await uploadFile(f, context));
      } catch (error) {
        toast.error(`${f.name}: ${(error as Error).message}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    update(multiple ? [...files, ...added] : added.slice(-1));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {files.map((f) => (
        <input key={f.id} type="hidden" name={`${name}[]`} value={f.id} />
      ))}
      <label
        className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-line-strong bg-field px-4 py-3 text-sm text-ink-2 hover:border-brand-400 hover:bg-brand-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handle(e.dataTransfer.files);
        }}
      >
        {busy > 0 ? <Loader2 className="size-5 animate-spin text-brand-600" /> : <Paperclip className="size-5 text-brand-600" />}
        <span className="flex flex-col">
          <span className="font-semibold">{busy > 0 ? "Uploading…" : label}</span>
          <span className="text-xs text-muted">{hint}</span>
        </span>
        <input ref={inputRef} type="file" className="sr-only" multiple={multiple} accept={accept} onChange={(e) => void handle(e.target.files)} />
      </label>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
              <FileText className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted">{fileSize(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} className="text-subtle hover:text-danger" onClick={() => update(files.filter((x) => x.id !== f.id))}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Read-only list of attachments that download through the access-checked file route. */
export function AttachmentList({ files, className, empty = "No attachments" }: { files: { file: string; name: string; size?: number }[]; className?: string; empty?: string }) {
  if (!files || files.length === 0) return <p className={cn("text-[13px] text-muted", className)}>{empty}</p>;
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {files.map((f, i) => (
        <li key={`${f.file}-${i}`}>
          <a href={`/api/files/${f.file}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] hover:border-brand-200 hover:bg-brand-50">
            <FileText className="size-4 shrink-0 text-brand-600" />
            <span className="min-w-0 flex-1 truncate font-medium text-ink max-sm:break-words max-sm:whitespace-normal">{f.name}</span>
            {f.size ? <span className="text-xs text-muted">{fileSize(f.size)}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
