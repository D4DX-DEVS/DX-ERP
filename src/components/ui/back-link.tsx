"use client";

import { useEffect, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

// Pathnames of this tab's last two in-app pages (module state survives client-side navigation, not reloads).
const visited: { previous: string | null; current: string | null } = { previous: null, current: null };

/** Mounted once in the app shell: remembers the page the user came from, for `BackLink`. */
export function NavigationTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === visited.current) return;
    visited.previous = visited.current;
    visited.current = pathname;
  }, [pathname]);
  return null;
}

/**
 * "← Back": returns to the previous in-app page (keeping its filters, page and scroll), or opens `href` when the page
 * was opened directly or the previous page was a create / edit form that has just been saved.
 */
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const from = visited.previous;
    if (!from || /\/(new|edit|import)$/.test(from)) return;
    e.preventDefault();
    router.back();
  };
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={`Back (${label})`}
      className={cn("inline-flex w-fit items-center gap-1 text-xs font-medium text-muted hover:text-brand-600 sm:text-[13px]", className)}
    >
      ← Back
    </Link>
  );
}
