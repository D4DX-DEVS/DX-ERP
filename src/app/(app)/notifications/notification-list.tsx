"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useOptimistic, useTransition, type ComponentType, type ReactNode } from "react";
import {
  Banknote,
  Bell,
  Briefcase,
  Bug,
  CalendarDays,
  CheckCheck,
  CheckSquare,
  Clock,
  FileText,
  GraduationCap,
  LogOut,
  Mail,
  MailOpen,
  Megaphone,
  Package,
  Receipt,
  ShieldAlert,
  Trash2,
  Wallet,
  type LucideProps,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { TONE_CLASSES } from "@/lib/status";
import { onUnreadEvents, requestUnreadPoll, shiftUnread } from "@/lib/unread";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm";
import { LinkTabs } from "@/components/ui/tabs";
import { deleteNotification, markAllNotificationsRead, markNotificationRead, markNotificationUnread } from "./actions";
import { notificationType, type InboxTab, type NotificationGroup, type NotificationView } from "./meta";

const ICONS: Record<string, ComponentType<LucideProps>> = {
  task: CheckSquare,
  leave: CalendarDays,
  attendance: Clock,
  movement: LogOut,
  timesheet: Clock,
  project: Briefcase,
  crm: Briefcase,
  contract: FileText,
  invoice: Receipt,
  payroll: Banknote,
  document: FileText,
  internship: GraduationCap,
  expense: Wallet,
  asset: Package,
  qa: Bug,
  announcement: Megaphone,
  system: ShieldAlert,
};

const OFFLINE = "Could not reach the server. Check your connection and try again.";

interface InboxCounts {
  unread: number;
  approvals: number;
}

interface Inbox {
  counts: InboxCounts;
  /** "Mark all read" is in flight. */
  allRead: boolean;
  markingAll: boolean;
  /** Call inside a transition: moves the tab counts until the server's numbers arrive. */
  shift: (delta: number, actionable: boolean) => void;
  markAll: () => void;
}

const InboxContext = createContext<Inbox | null>(null);

function useInbox(): Inbox {
  const inbox = useContext(InboxContext);
  if (!inbox) throw new Error("useInbox must be used inside <InboxProvider>");
  return inbox;
}

/**
 * Client read state for the inbox: reading, un-reading, deleting and "mark all read" show at once. The actions
 * re-render the page in the same round trip, so the optimistic values settle into server data (or roll back when
 * a save fails). While the inbox is open it also polls for new notifications and reloads the list when the unread
 * count changes elsewhere (a new notification arrived, or one was read on another device).
 */
export function InboxProvider({ unread, approvals, children }: InboxCounts & { children: ReactNode }) {
  const router = useRouter();
  const [counts, adjust] = useOptimistic<InboxCounts, InboxCounts>({ unread, approvals }, (c, d) => ({
    unread: Math.max(0, c.unread + d.unread),
    approvals: Math.max(0, c.approvals + d.approvals),
  }));
  const [allRead, setAllRead] = useOptimistic(false);
  const [markingAll, startAll] = useTransition();

  useEffect(() => {
    const id = setInterval(requestUnreadPoll, 20_000);
    const off = onUnreadEvents({ polled: (count) => count !== unread && router.refresh() });
    return () => {
      clearInterval(id);
      off();
    };
  }, [router, unread]);

  const shift = (delta: number, actionable: boolean) => adjust({ unread: delta, approvals: actionable ? delta : 0 });

  // The top-bar badge moves outside the transition, so it repaints now rather than when the save finishes.
  const markAll = () => {
    shiftUnread(-counts.unread);
    startAll(async () => {
      setAllRead(true);
      adjust({ unread: -counts.unread, approvals: -counts.approvals });
      const result = await markAllNotificationsRead().catch(() => null);
      if (result?.ok) toast.success(result.message ?? "All notifications marked as read");
      else toast.error(result?.error ?? OFFLINE);
      requestUnreadPoll();
    });
  };

  return <InboxContext value={{ counts, allRead, markingAll, shift, markAll }}>{children}</InboxContext>;
}

export function InboxTabs({ tab, hrefs }: { tab: InboxTab; hrefs: Record<InboxTab, string> }) {
  const { counts } = useInbox();
  return (
    <LinkTabs
      className="flex-1 border-b-0"
      items={[
        { href: hrefs.all, label: "All", active: tab === "all" },
        { href: hrefs.unread, label: "Unread", active: tab === "unread", count: counts.unread },
        { href: hrefs.approvals, label: "Approvals", active: tab === "approvals", count: counts.approvals },
      ]}
    />
  );
}

export function MarkAllReadButton() {
  const { counts, markingAll, markAll } = useInbox();
  return (
    <Button variant="secondary" icon={<CheckCheck className="size-4" />} loading={markingAll} disabled={counts.unread === 0} onClick={markAll}>
      Mark all read
    </Button>
  );
}

function Row({ item }: { item: NotificationView }) {
  const router = useRouter();
  const inbox = useInbox();
  const [opening, startOpen] = useTransition();
  const [busy, startRow] = useTransition();
  const [read, setRead] = useOptimistic(item.read || inbox.allRead);
  const [removed, setRemoved] = useOptimistic(false);
  const confirm = useConfirm();
  const type = notificationType(item.type);
  const Icon = ICONS[item.type] ?? Bell;
  const tone = TONE_CLASSES[type.tone];

  // Run inside a transition: the row and tab counts change at once; a failed save rolls back when the transition ends.
  const saveRead = async (next: boolean) => {
    setRead(next);
    inbox.shift(next ? -1 : 1, item.actionable);
    const result = await (next ? markNotificationRead : markNotificationUnread)(item.id).catch(() => null);
    if (!result?.ok) {
      toast.error(result?.error ?? OFFLINE);
      requestUnreadPoll();
    }
  };

  // The badge update stays outside the transition so it repaints immediately too.
  const setReadState = (next: boolean) => {
    shiftUnread(next ? -1 : 1);
    startRow(() => saveRead(next));
  };

  // Opening marks the notification read, then follows its link.
  const open = () => {
    if (!read) shiftUnread(-1);
    startOpen(async () => {
      if (!read) await saveRead(true);
      if (item.link) router.push(item.link);
    });
  };

  const remove = async () => {
    const ok = await confirm({ title: "Delete notification?", description: `"${item.title}" will be removed from your notifications.`, confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    if (!read) shiftUnread(-1);
    startRow(async () => {
      setRemoved(true);
      if (!read) inbox.shift(-1, item.actionable);
      const result = await deleteNotification(item.id).catch(() => null);
      if (result?.ok) toast.success(result.message ?? "Notification removed");
      else {
        toast.error(result?.error ?? OFFLINE);
        requestUnreadPoll();
      }
    });
  };

  if (removed) return null;

  const body = (
    <>
      <span className={cn("flex size-[38px] shrink-0 items-center justify-center rounded-[11px]", tone.bg, tone.fg)}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start justify-between gap-3">
          <span className={cn("text-sm text-ink", read ? "font-medium" : "font-semibold")}>{item.title}</span>
          <span className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-muted tabular">{item.time}</span>
        </span>
        {item.body && <span className="text-[13px] leading-relaxed text-ink-2">{item.body}</span>}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Chip tone={type.tone} size="sm" dot={false}>
            {type.label}
          </Chip>
          {item.actionable && (
            <Chip tone="amber" size="sm">
              Needs your action
            </Chip>
          )}
          {item.high && (
            <Chip tone="red" size="sm">
              Important
            </Chip>
          )}
          {item.link && <span className="text-[13px] font-semibold text-brand-600">Open →</span>}
        </span>
      </span>
    </>
  );

  const rowClass = cn("flex min-w-0 flex-1 items-start gap-3.5 py-3.5 pl-5 text-left", opening && "opacity-60");
  const iconButton = "flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-field disabled:opacity-50";
  const toggleLabel = read ? "Mark as unread" : "Mark as read";

  return (
    <li className={cn("flex items-start border-b border-line-soft transition-colors last:border-b-0", !read && "bg-[#fbfcff]")}>
      {item.link ? (
        <Link
          href={item.link}
          className={rowClass}
          onClick={(e) => {
            // Opened in a new tab or window: mark it read here and let the browser open the link.
            if (e.metaKey || e.ctrlKey || e.shiftKey) {
              if (!read) setReadState(true);
              return;
            }
            e.preventDefault();
            open();
          }}
          onAuxClick={(e) => {
            if (e.button === 1 && !read) setReadState(true);
          }}
        >
          {body}
        </Link>
      ) : (
        <button type="button" className={rowClass} onClick={open}>
          {body}
        </button>
      )}
      <span className="flex shrink-0 items-center gap-0.5 pt-3 pr-3 pl-2">
        <span className="flex size-4 items-center justify-center">{!read && <span className="size-2 rounded-full bg-brand-600" role="img" aria-label="Unread" />}</span>
        <button type="button" disabled={busy || opening} onClick={() => setReadState(!read)} title={toggleLabel} aria-label={`${toggleLabel}: ${item.title}`} className={cn(iconButton, "hover:text-brand-600")}>
          {read ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
        </button>
        <button type="button" disabled={busy || opening} onClick={remove} title="Delete" aria-label={`Delete notification: ${item.title}`} className={cn(iconButton, "hover:text-danger")}>
          <Trash2 className="size-4" />
        </button>
      </span>
    </li>
  );
}

export function NotificationList({ groups }: { groups: NotificationGroup[] }) {
  return (
    <div className="flex flex-col">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="border-y border-line-soft bg-field px-5 py-2.5 font-sans text-xs font-semibold tracking-[0.08em] text-muted uppercase first:border-t-0">{g.label}</h3>
          <ul>
            {g.items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
