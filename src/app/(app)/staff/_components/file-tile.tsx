import type { ReactNode } from "react";
import { ExternalLink, FilePlus2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { fileSize } from "@/lib/format";
import { fmtDate } from "@/lib/time";

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"];

/** File-type badge from the extension: PDF red, images blue, anything else grey. */
function fileKind(name: string): { label: string; className: string } {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ext === "pdf") return { label: "PDF", className: "bg-tone-red-bg text-tone-red" };
  if (IMAGE_EXT.includes(ext)) return { label: "IMG", className: "bg-tone-blue-bg text-tone-blue" };
  return { label: ext ? ext.slice(0, 4).toUpperCase() : "FILE", className: "bg-tone-gray-bg text-tone-gray" };
}

/**
 * One uploaded file on a profile: type badge, what it is, the file name (opens it), size / date / uploader, and
 * row actions. `children` adds extra lines (expiry, notes, version history).
 */
export function FileTile({
  title,
  file,
  name,
  size,
  uploadedAt,
  uploadedByName,
  meta,
  note,
  actions,
  children,
}: {
  /** What the file is (certificate / document type). Omitted when the file name says enough. */
  title?: ReactNode;
  /** Stored file id (`/api/files/<id>`). */
  file: string;
  name: string;
  size?: number;
  uploadedAt: string;
  uploadedByName?: string;
  /** Extra meta placed before the upload date (e.g. "v2"). */
  meta?: string;
  note?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const kind = fileKind(name);
  const href = `/api/files/${file}`;
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border border-line bg-white p-3 transition-colors hover:border-brand-200">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg text-[10px] font-bold tracking-wide", kind.className)} aria-hidden>
        {kind.label}
      </span>
      <div className="min-w-0 flex-1">
        {title && <div className="text-[13px] leading-5 font-semibold text-ink">{title}</div>}
        <a href={href} target="_blank" rel="noopener noreferrer" className={cn("block break-words hover:underline", title ? "text-xs text-brand-600" : "text-[13px] font-semibold text-ink hover:text-brand-600")}>
          {name}
        </a>
        <div className="mt-0.5 text-[11px] text-muted">
          {[size ? fileSize(size) : null, meta, fmtDate(uploadedAt), uploadedByName ? `by ${uploadedByName}` : null].filter(Boolean).join(" · ")}
        </div>
        {note && <div className="mt-1 text-xs break-words text-ink-2">{note}</div>}
        {children}
      </div>
      <div className="-my-1 -mr-1 flex shrink-0 items-center">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${name}`}
          title="Open"
          className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-field hover:text-ink"
        >
          <ExternalLink className="size-4" />
        </a>
        {actions}
      </div>
    </div>
  );
}

/** Placeholder for a file that is expected but not uploaded yet, with an optional upload action. */
export function MissingTile({ title, hint = "Not uploaded yet", tone = "muted", action }: { title: ReactNode; hint?: ReactNode; tone?: "muted" | "warning"; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-dashed border-line-strong bg-field p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-dashed border-line-strong bg-white text-subtle" aria-hidden>
        <FilePlus2 className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-5 font-semibold text-ink-2">{title}</div>
        <div className={cn("text-[11px]", tone === "warning" ? "font-medium text-warning" : "text-muted")}>{hint}</div>
      </div>
      {action}
    </div>
  );
}
