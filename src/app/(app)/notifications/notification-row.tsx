"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { requestUnreadPoll, shiftUnread } from "@/lib/unread";
import { markNotificationRead } from "./actions";

/** Dashboard "Latest notifications" row: opening it marks the notification read (also when opened in a new tab). */
export function NotificationRow({ id, href, title, meta, read }: { id: string; href: string; title: string; meta: string; read: boolean }) {
  const [seen, setSeen] = useState(read);
  const markRead = () => {
    if (seen) return;
    setSeen(true);
    shiftUnread(-1);
    markNotificationRead(id).then(
      (r) => {
        if (!r.ok) requestUnreadPoll();
      },
      () => requestUnreadPoll(),
    );
  };
  return (
    <Link href={href} onClick={markRead} onAuxClick={(e) => e.button === 1 && markRead()} className="flex items-center gap-3 border-t border-line-soft px-5 py-2.5 hover:bg-[#fafbfe]">
      <span className={cn("size-2 shrink-0 rounded-full", seen ? "bg-transparent" : "bg-brand-600")} role="img" aria-label={seen ? "Read" : "Unread"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
        <span className="block truncate text-xs text-muted">{meta}</span>
      </span>
    </Link>
  );
}
