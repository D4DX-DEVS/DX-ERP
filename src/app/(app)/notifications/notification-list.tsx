"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type ComponentType } from "react";
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
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm";
import { useServerAction } from "@/components/ui/form";
import { deleteNotification, markAllNotificationsRead, markNotificationRead } from "./actions";
import { notificationType, type NotificationGroup, type NotificationView } from "./meta";

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

/**
 * The shell's unread badge refreshes on tab focus; asking it to re-poll right after a change keeps
 * the badge in step without an extra endpoint.
 */
function refreshUnreadBadge() {
  document.dispatchEvent(new Event("visibilitychange"));
}

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const { pending, run } = useServerAction();
  return (
    <Button variant="secondary" icon={<CheckCheck className="size-4" />} loading={pending} disabled={disabled} onClick={() => run(markAllNotificationsRead, { onSuccess: refreshUnreadBadge })}>
      Mark all read
    </Button>
  );
}

function Row({ item }: { item: NotificationView }) {
  const router = useRouter();
  const [opening, startOpen] = useTransition();
  const { pending, run } = useServerAction();
  const confirm = useConfirm();
  const type = notificationType(item.type);
  const Icon = ICONS[item.type] ?? Bell;
  const tone = TONE_CLASSES[type.tone];

  // Clicking marks the notification read, then follows its link.
  const open = () => {
    startOpen(async () => {
      if (!item.read) {
        const result = await markNotificationRead(item.id);
        if (!result.ok) toast.error(result.error);
        else refreshUnreadBadge();
      }
      if (item.link) router.push(item.link);
      else router.refresh();
    });
  };

  const body = (
    <>
      <span className={cn("flex size-[38px] shrink-0 items-center justify-center rounded-[11px]", tone.bg, tone.fg)}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start justify-between gap-3">
          <span className={cn("text-sm text-ink", item.read ? "font-medium" : "font-semibold")}>{item.title}</span>
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

  return (
    <li className={cn("flex items-start border-b border-line-soft last:border-b-0", !item.read && "bg-[#fbfcff]")}>
      {item.link ? (
        <Link
          href={item.link}
          className={rowClass}
          onClick={(e) => {
            if (item.read || e.metaKey || e.ctrlKey || e.shiftKey) return;
            // Mark read in the background while the link navigates normally.
            e.preventDefault();
            open();
          }}
        >
          {body}
        </Link>
      ) : (
        <button type="button" className={rowClass} onClick={open}>
          {body}
        </button>
      )}
      <span className="flex shrink-0 items-start gap-1 pt-4 pr-3 pl-2">
        {!item.read && <span className="mt-2 size-2 rounded-full bg-brand-600" role="img" aria-label="Unread" />}
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            const ok = await confirm({ title: "Delete notification?", description: `"${item.title}" will be removed from your notifications.`, confirmLabel: "Delete", tone: "danger" });
            if (ok) run(() => deleteNotification(item.id), { onSuccess: refreshUnreadBadge });
          }}
          aria-label={`Delete notification: ${item.title}`}
          className="flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-field hover:text-danger disabled:opacity-50"
        >
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
