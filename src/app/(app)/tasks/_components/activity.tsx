import { Avatar } from "@/components/ui/avatar";
import { AttachmentList } from "@/components/ui/file-upload";
import { Timeline } from "@/components/ui/timeline";
import type { CommentEntry, HistoryEntry } from "@/lib/models";
import { timeAgo } from "@/lib/time";

/** Comment thread (oldest first) with attachments. */
export function CommentList({ comments, empty = "No comments yet." }: { comments: CommentEntry[]; empty?: string }) {
  if (comments.length === 0) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {comments.map((c, i) => (
        <li key={c._id?.toString() ?? i} className="flex gap-3 py-3.5 first:pt-0">
          <Avatar name={c.userName} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px]">
              <strong className="font-semibold text-ink">{c.userName}</strong> <span className="text-muted">· {timeAgo(c.at)}</span>
            </div>
            <p className="mt-0.5 text-sm leading-relaxed break-words whitespace-pre-line text-ink-2">{c.text}</p>
            {c.attachments && c.attachments.length > 0 && (
              <AttachmentList className="mt-2" files={c.attachments.map((a) => ({ file: a.file.toString(), name: a.name, size: a.size }))} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function historyTitle(h: HistoryEntry): string {
  if (h.from && h.to) return `${h.action}: ${h.from} → ${h.to}`;
  if (h.to) return `${h.action}: ${h.to}`;
  return h.action;
}

/** Change history, newest first. */
export function HistoryTimeline({ history, empty = "No history yet." }: { history: HistoryEntry[]; empty?: string }) {
  const items = [...history].reverse().map((h, i) => ({
    id: h._id?.toString() ?? String(i),
    title: historyTitle(h),
    meta: h.byName ?? "System",
    at: h.at,
    body: h.note,
  }));
  return <Timeline items={items} empty={empty} />;
}
