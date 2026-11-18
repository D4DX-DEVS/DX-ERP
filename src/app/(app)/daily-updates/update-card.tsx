import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { fmtDate, timeAgo } from "@/lib/time";

export interface DayUpdate {
  key: string;
  date: string;
  person?: { name: string; photo?: string };
  projects: { id: string; label: string; points: string[] }[];
  updatedAt: Date;
}

/** One person's update for one day: each project with its points. */
export function DayUpdateCard({ update, action }: { update: DayUpdate; action?: ReactNode }) {
  const day = fmtDate(update.date, "EEE, d MMM yyyy");
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3 pb-2 sm:px-5 sm:pt-4">
        {update.person ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={update.person.name} src={update.person.photo} size="sm" />
            <div className="min-w-0">
              <div className="text-sm font-semibold break-words text-ink">{update.person.name}</div>
              <div className="text-xs text-muted">{day}</div>
            </div>
          </div>
        ) : (
          <h3 className="font-display text-[15px] font-semibold text-ink">{day}</h3>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Updated {timeAgo(update.updatedAt)}</span>
          {action}
        </div>
      </div>
      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        {update.projects.map((p) => (
          <div key={p.id} className="min-w-0">
            <div className="text-[13px] font-semibold break-words text-brand-700">{p.label}</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2 marker:text-subtle">
              {p.points.map((point, i) => (
                <li key={i} className="break-words whitespace-pre-wrap">
                  {point}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
