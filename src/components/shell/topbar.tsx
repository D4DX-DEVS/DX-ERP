"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import type { Presence, ShellUser } from "./types";

const PRESENCE_STYLE: Record<Presence["state"], { cls: string; dot: string }> = {
  in: { cls: "bg-success-bg text-[#0e6b4b]", dot: "bg-[#12935f]" },
  out: { cls: "bg-outside-bg text-tone-orange", dot: "bg-outside" },
  not_in: { cls: "bg-track text-tone-gray", dot: "bg-subtle" },
  checked_out: { cls: "bg-track text-tone-gray", dot: "bg-subtle" },
  leave: { cls: "bg-brand-100 text-brand-600", dot: "bg-brand-600" },
  holiday: { cls: "bg-track text-tone-gray", dot: "bg-subtle" },
  none: { cls: "", dot: "" },
};

function useUnreadCount(initial: number) {
  const [count, setCount] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setCount(initial);
  }
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { count: number };
          if (alive) setCount(json.count);
        }
      } catch {
        // offline — keep the last known count
      }
    };
    const id = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return count;
}

export function Topbar({ user, presence, unread }: { user: ShellUser; presence: Presence; unread: number }) {
  const router = useRouter();
  const count = useUnreadCount(unread);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const style = PRESENCE_STYLE[presence.state];

  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="flex h-12 items-center gap-2 px-4 sm:h-14 sm:gap-3 sm:px-6 md:h-16 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
          <Image src="/brand/d4dx-mark.png" alt="D4DX" width={30} height={24} className="h-6 w-auto" />
          <span className="font-display text-base font-bold tracking-[0.04em] text-ink">D4DX</span>
        </Link>
        <form
          role="search"
          className="hidden h-10 max-w-[440px] flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-field px-3 text-muted focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100 md:flex"
          onSubmit={(e) => {
            e.preventDefault();
            const term = q.trim();
            if (term) router.push(`/search?q=${encodeURIComponent(term)}`);
          }}
        >
          <Search className="size-[18px] shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search people, projects, clients, invoices"
            placeholder="Search people, projects, clients, invoices…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle"
          />
          <kbd className="hidden rounded-[5px] border border-line-strong px-1.5 py-0.5 text-[11px] font-semibold text-muted xl:inline">Ctrl K</kbd>
        </form>
        <div className="flex-1" />
        {user.isStaff && presence.state !== "none" && (
          <Link href="/attendance" className={cn("hidden h-9 items-center gap-2 rounded-full px-3 text-[13px] font-semibold sm:inline-flex", style.cls)}>
            <span className={cn("size-2 rounded-full", style.dot)} />
            {presence.label}
          </Link>
        )}
        {user.isStaff && (
          <Link href="/movement/new" className="hidden h-9 items-center gap-2 rounded-[10px] border border-line-strong px-3.5 text-[13px] font-semibold text-ink hover:bg-field xl:inline-flex">
            <LogOut className="size-4" />
            Record movement
          </Link>
        )}
        <Link href="/search" className="flex size-10 items-center justify-center rounded-[10px] text-ink-2 hover:bg-field md:hidden" aria-label="Search">
          <Search className="size-5" />
        </Link>
        <Link href="/notifications" aria-label={`Notifications, ${count} unread`} className="relative flex size-10 items-center justify-center rounded-[10px] text-ink-2 hover:bg-field">
          <Bell className="size-5" />
          {count > 0 && (
            <span className="absolute top-1 right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-white bg-outside px-1 text-[10px] font-bold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Link>
        <Link href="/profile" aria-label="My profile" className="rounded-full">
          <Avatar name={user.name} src={user.photo} size="sm" className="size-9 bg-brand-600 text-white" />
        </Link>
      </div>
    </header>
  );
}
