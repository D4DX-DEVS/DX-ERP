"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { Bell, CheckSquare, Clock, Home, LayoutGrid, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NavSection } from "@/lib/nav";
import { Avatar } from "@/components/ui/avatar";
import { NAV_ICONS } from "./nav-icon";
import { isActive, SignOutButton } from "./sidebar";
import type { ShellUser } from "./types";

/** Bottom tab bar for phones (<768px): Home · Time · Tasks · Inbox · More. */
export function TabBar({ sections, user, unread }: { sections: NavSection[]; user: ShellUser; unread: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const tabs = [
    { key: "home", label: "Home", href: "/dashboard", icon: Home },
    { key: "time", label: "Time", href: "/attendance", icon: Clock },
    { key: "tasks", label: "Tasks", href: "/tasks", icon: CheckSquare },
    { key: "inbox", label: "Inbox", href: "/notifications", icon: Bell, badge: unread },
  ];
  const tabClass = (active: boolean) =>
    cn("flex flex-1 flex-col items-center justify-center gap-1 rounded-[10px] text-[11px] font-semibold", active ? "text-brand-600" : "text-muted");

  return (
    <>
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-40 flex h-[calc(64px+env(safe-area-inset-bottom))] border-t border-line bg-white px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)] md:hidden">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = isActive(pathname, t.href);
          return (
            <Link key={t.key} href={t.href} className={tabClass(active)} aria-current={active ? "page" : undefined}>
              <span className="relative">
                <Icon className="size-[22px]" strokeWidth={1.8} />
                {t.badge ? (
                  <span className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-outside px-1 text-[10px] font-bold text-white">{t.badge > 99 ? "99+" : t.badge}</span>
                ) : null}
              </span>
              {t.label}
            </Link>
          );
        })}
        <button type="button" className={tabClass(open)} onClick={() => setOpen(true)} aria-haspopup="dialog">
          <LayoutGrid className="size-[22px]" strokeWidth={1.8} />
          More
        </button>
      </nav>

      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[#0a1450]/40 md:hidden" />
          <D.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] animate-slide-up flex-col rounded-t-[20px] bg-white md:hidden">
            <div className="flex items-center gap-3 border-b border-line-soft px-5 py-4">
              <Avatar name={user.name} src={user.photo} size="md" />
              <div className="min-w-0 flex-1">
                <D.Title className="truncate font-display text-base font-semibold text-ink">{user.name}</D.Title>
                <D.Description className="truncate text-xs text-muted">{user.title}</D.Description>
              </div>
              <D.Close className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-field" aria-label="Close menu">
                <X className="size-5" />
              </D.Close>
            </div>
            <div className="overflow-y-auto px-4 pt-2 pb-[max(env(safe-area-inset-bottom),16px)]">
              {sections.map((s, i) => (
                <div key={i} className="py-2">
                  {s.label && <div className="px-1 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{s.label}</div>}
                  <div className="grid grid-cols-3 gap-2">
                    {s.items.map((it) => {
                      const Icon = NAV_ICONS[it.icon];
                      const active = isActive(pathname, it.href);
                      return (
                        <Link
                          key={it.key}
                          href={it.href}
                          onClick={() => setOpen(false)}
                          className={cn("relative flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center text-xs font-medium", active ? "border-brand-200 bg-brand-50 text-brand-700" : "border-line text-ink-2")}
                        >
                          <Icon className="size-5" strokeWidth={1.8} />
                          <span className="line-clamp-2">{it.label}</span>
                          {it.badge ? <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-outside px-1 text-[10px] font-bold text-white">{it.badge}</span> : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="mt-2 flex gap-2 border-t border-line-soft pt-3">
                <Link href="/profile" onClick={() => setOpen(false)} className="flex h-11 flex-1 items-center justify-center rounded-xl border border-line text-sm font-semibold text-ink">
                  My profile
                </Link>
                <SignOutButton label className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold text-danger" />
              </div>
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}
