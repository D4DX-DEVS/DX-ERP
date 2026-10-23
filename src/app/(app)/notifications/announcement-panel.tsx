import { Megaphone, Pin } from "lucide-react";
import { assignableRoles } from "@/lib/rbac/roles";
import { fmtDate, timeAgo } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, Tag } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/page";
import { DeleteAnnouncementButton, NewAnnouncementButton } from "./announcement-controls";
import type { AnnouncementView } from "./data";

const PERSON_TYPE_KEYS = ["employee", "trainee", "intern"];

/** Announcements card for /notifications. Managers also get the composer and delete buttons. */
export async function AnnouncementPanel({ items, canManage }: { items: AnnouncementView[]; canManage: boolean }) {
  const roles = canManage ? (await assignableRoles()).filter((r) => !PERSON_TYPE_KEYS.includes(r.key)) : [];
  return (
    <Card>
      <CardHeader title="Announcements" subtitle={canManage ? "Everything published, newest first" : "From management and HR"} action={canManage ? <NewAnnouncementButton roles={roles} /> : undefined} />
      {items.length === 0 ? (
        <EmptyState icon={<Megaphone className="size-5" />} title="No announcements" description="Company notices will appear here." className="py-8" />
      ) : (
        <ul>
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-2 border-t border-line-soft px-5 py-3.5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.pinned && <Pin className="size-3.5 text-brand-600" aria-label="Pinned" />}
                  <h3 className="font-sans text-sm font-semibold text-ink">{a.title}</h3>
                  {a.expired && (
                    <Chip tone="gray" size="sm" dot={false}>
                      Expired
                    </Chip>
                  )}
                </div>
                <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{a.body}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span>
                    {a.publishedByName} · {timeAgo(a.createdAt)}
                  </span>
                  {canManage && <Tag tone="blue">{a.audience}</Tag>}
                  {a.expiresOn && !a.expired && <span>until {fmtDate(a.expiresOn)}</span>}
                </div>
              </div>
              {canManage && <DeleteAnnouncementButton id={a.id} title={a.title} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
