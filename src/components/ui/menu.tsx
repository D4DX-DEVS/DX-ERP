"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DropdownMenu as M } from "radix-ui";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Opens in a new tab / downloads (for export links). */
  external?: boolean;
}

/** Overflow / action menu. Pass `trigger` for a custom button; defaults to a "⋯" icon button. */
export function Menu({ items, trigger, align = "end", label = "More actions" }: { items: (MenuItem | "separator" | null | false)[]; trigger?: ReactNode; align?: "start" | "end"; label?: string }) {
  const visible = items.filter(Boolean) as (MenuItem | "separator")[];
  if (visible.length === 0) return null;
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>
        {trigger ?? (
          <button type="button" aria-label={label} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink">
            <MoreHorizontal className="size-[18px]" />
          </button>
        )}
      </M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className="z-50 min-w-48 animate-fade-in rounded-xl border border-line bg-white p-1 shadow-popover">
          {visible.map((item, i) =>
            item === "separator" ? (
              <M.Separator key={i} className="my-1 h-px bg-line-soft" />
            ) : (
              <M.Item
                key={i}
                disabled={item.disabled}
                asChild={Boolean(item.href)}
                onSelect={item.onSelect}
                className={cn(
                  "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium outline-none select-none",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-field",
                  item.danger ? "text-danger" : "text-ink",
                )}
              >
                {item.href ? (
                  item.external ? (
                    <a href={item.href} target="_blank" rel="noopener noreferrer">
                      {item.icon}
                      {item.label}
                    </a>
                  ) : (
                    <Link href={item.href}>
                      {item.icon}
                      {item.label}
                    </Link>
                  )
                ) : (
                  <>
                    {item.icon}
                    {item.label}
                  </>
                )}
              </M.Item>
            ),
          )}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
