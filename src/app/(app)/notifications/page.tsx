import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { can, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Notification } from "@/lib/models";
import { NOTIFICATION_EVENTS } from "@/lib/config-defaults";
import { pageParam, PAGE_SIZE, param, withParams, type SearchParams } from "@/lib/query";
import { addDays, dateKey, fmtDate, fmtTime, todayKey } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { SelectFilter, Pagination } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { AnnouncementPanel } from "./announcement-panel";
import { loadAnnouncements } from "./data";
import { INBOX_TABS, NOTIFICATION_TYPES, safeLink, type InboxTab, type NotificationGroup, type NotificationView } from "./meta";
import { InboxProvider, InboxTabs, MarkAllReadButton, NotificationList } from "./notification-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab: InboxTab = (INBOX_TABS as readonly string[]).includes(param(sp, "tab")) ? (param(sp, "tab") as InboxTab) : "all";
  const type = param(sp, "type");
  const page = pageParam(sp);
  const today = todayKey();
  const canManage = can(user, "announcements.manage");

  const filter = and(
    eq(Notification.user, user._id),
    Object.hasOwn(NOTIFICATION_TYPES, type) ? eq(Notification.type, type) : undefined,
    tab === "unread" ? eq(Notification.read, false) : undefined,
    tab === "approvals" ? eq(Notification.actionable, true) : undefined,
  );

  const [docs, total, unread, pendingApprovals, announcements] = await Promise.all([
    db()
      .select({
        _id: Notification._id,
        type: Notification.type,
        title: Notification.title,
        body: Notification.body,
        link: Notification.link,
        priority: Notification.priority,
        read: Notification.read,
        actionable: Notification.actionable,
        createdAt: Notification.createdAt,
      })
      .from(Notification)
      .where(filter)
      .orderBy(desc(Notification.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().$count(Notification, filter),
    db().$count(Notification, and(eq(Notification.user, user._id), eq(Notification.read, false))),
    db().$count(Notification, and(eq(Notification.user, user._id), eq(Notification.actionable, true), eq(Notification.read, false))),
    loadAnnouncements(user, today, { limit: canManage ? 30 : 8, all: canManage }),
  ]);

  const yesterday = addDays(today, -1);
  const groups: NotificationGroup[] = [];
  for (const n of docs) {
    const day = dateKey(n.createdAt);
    const label = day === today ? "Today" : day === yesterday ? "Yesterday" : fmtDate(day, "EEEE, d MMMM yyyy");
    const view: NotificationView = {
      id: n._id,
      type: n.type,
      title: n.title,
      body: n.body || undefined,
      link: safeLink(n.link),
      read: n.read,
      actionable: n.actionable,
      high: n.priority === "high",
      time: fmtTime(n.createdAt),
    };
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(view);
    else groups.push({ label, items: [view] });
  }

  const tabHref = (t: InboxTab) => withParams("/notifications", sp, { tab: t === "all" ? null : t });

  return (
    <PageBody>
      <InboxProvider unread={unread} approvals={pendingApprovals}>
        <PageHeader overline="Inbox" title="Notifications & announcements" actions={<MarkAllReadButton />} />

        <div className="grid items-start gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="flex flex-wrap items-end justify-between gap-2 px-3 pt-2 sm:px-4">
              <InboxTabs tab={tab} hrefs={{ all: tabHref("all"), unread: tabHref("unread"), approvals: tabHref("approvals") }} />
              <div className="pb-2">
                <SelectFilter param="type" label="Filter by category" allLabel="All categories" options={NOTIFICATION_EVENTS.map((e) => ({ value: e.key, label: NOTIFICATION_TYPES[e.key]?.label ?? e.label }))} className="h-9 text-[13px]" />
              </div>
            </div>
            <div className="border-t border-line">
              {groups.length === 0 ? (
                <EmptyState
                  icon={<Bell className="size-5" />}
                  title={tab === "unread" ? "You're all caught up" : tab === "approvals" ? "Nothing is waiting for your approval" : "No notifications yet"}
                  description={tab === "all" && !type ? "Alerts about your tasks, leave, movements and approvals will appear here." : "Try another tab or category."}
                />
              ) : (
                <NotificationList groups={groups} />
              )}
            </div>
            {total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={total} />}
          </Card>

          <AnnouncementPanel items={announcements} canManage={canManage} />
        </div>
      </InboxProvider>
    </PageBody>
  );
}
