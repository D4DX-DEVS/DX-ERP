"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NavSection } from "@/lib/nav";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm";
import { NAV_ICONS } from "./nav-icon";
import type { ShellUser } from "./types";

export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SignOutButton({ className, label = false }: { className?: string; label?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <form ref={form} action="/api/auth/logout" method="post">
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        onConfirm={() => {
          setPending(true);
          form.current?.requestSubmit();
        }}
        title="Sign out?"
        description="You'll be signed out of D4DX ERP on this device. Unsaved changes on open forms will be lost."
        confirmLabel="Sign out"
        tone="danger"
        icon="logout"
        trigger={
          <button type="button" aria-label="Sign out" className={className}>
            <LogOut className="size-[18px]" />
            {label && <span>Sign out</span>}
          </button>
        }
      />
    </form>
  );
}

/** Full navy sidebar (≥1024px). */
export function Sidebar({ sections, user }: { sections: NavSection[]; user: ShellUser }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col bg-navy px-3.5 pt-5 pb-4 text-white lg:flex">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-2 pb-4">
        <Image src="/brand/d4dx-mark-white.png" alt="" width={34} height={28} className="h-7 w-auto" priority />
        <span className="flex flex-col leading-tight">
          <span className="font-display text-lg font-bold tracking-[0.04em]">
            D4DX <span className="rounded-[5px] bg-white/15 px-1.5 py-0.5 align-[3px] text-[11px] font-semibold tracking-[0.06em]">ERP</span>
          </span>
          <span className="mt-0.5 text-[11px] text-navy-soft">Innovations LLP</span>
        </span>
      </Link>
      <div className="scrollbar-thin -mx-1 flex flex-1 flex-col gap-0.5 overflow-y-auto px-1 [scrollbar-color:rgba(255,255,255,0.15)_transparent]">
        {sections.map((section, si) => (
          <div key={si} className="mb-1.5 flex flex-col gap-0.5">
            {section.label && <div className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-navy-muted uppercase">{section.label}</div>}
            {section.items.map((it) => {
              const Icon = NAV_ICONS[it.icon];
              const active = isActive(pathname, it.href);
              return (
                <Link
                  key={it.key}
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors",
                    active ? "bg-brand-600 text-white" : "text-navy-text hover:bg-white/8 hover:text-white",
                  )}
                >
                  <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.badge ? (
                    <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold", it.badgeTone === "alert" ? "bg-outside text-white" : "bg-white/16 text-white")}>
                      {it.badge > 99 ? "99+" : it.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5 border-t border-white/10 px-2 pt-3">
        <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-2.5">
          <Avatar name={user.name} src={user.photo} size="sm" className="bg-brand-500 text-white" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-semibold">{user.name}</span>
            <span className="truncate text-xs text-navy-soft">{user.title}</span>
          </span>
        </Link>
        <SignOutButton className="flex size-8 items-center justify-center rounded-lg text-navy-text hover:bg-white/10 hover:text-white" />
      </div>
    </nav>
  );
}

/** Icon rail (768–1023px). */
export function Rail({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-dvh w-[72px] shrink-0 flex-col items-center gap-1 bg-navy py-4 md:flex lg:hidden">
      <Link href="/dashboard" className="mb-3">
        <Image src="/brand/d4dx-mark-white.png" alt="D4DX" width={34} height={28} className="h-7 w-auto" />
      </Link>
      <div className="scrollbar-thin flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
        {sections.flatMap((s) => s.items).map((it) => {
          const Icon = NAV_ICONS[it.icon];
          const active = isActive(pathname, it.href);
          return (
            <Link
              key={it.key}
              href={it.href}
              title={it.label}
              aria-label={it.label}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex size-11 shrink-0 items-center justify-center rounded-xl", active ? "bg-brand-600 text-white" : "text-navy-text hover:bg-white/10 hover:text-white")}
            >
              <Icon className="size-5" strokeWidth={1.8} />
              {it.badge ? <span className={cn("absolute top-1 right-1 size-2 rounded-full", it.badgeTone === "alert" ? "bg-outside" : "bg-white/70")} /> : null}
            </Link>
          );
        })}
      </div>
      <SignOutButton className="flex size-10 items-center justify-center rounded-lg text-navy-text hover:bg-white/10 hover:text-white" />
    </nav>
  );
}
