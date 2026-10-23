"use client";

import type { ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Modal dialog. Controlled (`open` + `onOpenChange`) or uncontrolled with a `trigger`.
 * On phones it becomes a bottom sheet.
 */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[#0a1450]/40 backdrop-blur-[1px]" />
        <D.Content
          className={cn(
            "fixed z-50 flex max-h-[92dvh] w-full flex-col bg-white shadow-modal focus:outline-none",
            "inset-x-0 bottom-0 animate-slide-up rounded-t-[20px]",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]",
            size === "sm" && "sm:max-w-md",
            size === "md" && "sm:max-w-lg",
            size === "lg" && "sm:max-w-2xl",
            size === "xl" && "sm:max-w-4xl",
          )}
          onOpenAutoFocus={(e) => {
            // Let the first form field take focus naturally rather than the close button.
            const target = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea");
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line-soft px-4 pt-4 pb-3 sm:gap-4 sm:px-5 sm:pt-5 sm:pb-4">
            <div className="min-w-0">
              <D.Title className="font-display text-base font-semibold text-ink sm:text-lg">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-xs text-muted sm:text-[13px]">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>
              )}
            </div>
            <D.Close className="-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink" aria-label="Close">
              <X className="size-[18px]" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-4 py-2.5 sm:px-5 sm:py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const DialogClose = D.Close;
