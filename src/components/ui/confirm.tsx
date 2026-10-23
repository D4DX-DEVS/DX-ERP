"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertDialog as A } from "radix-ui";
import { AlertTriangle, HelpCircle, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export type ConfirmTone = "danger" | "warning" | "primary";

const TONES: Record<ConfirmTone, { wrap: string; button: "danger" | "primary" }> = {
  danger: { wrap: "bg-danger-bg text-danger", button: "danger" },
  warning: { wrap: "bg-warning-bg text-warning", button: "primary" },
  primary: { wrap: "bg-brand-50 text-brand-600", button: "primary" },
};

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** Icon override (defaults to a warning triangle for danger / warning, a question mark otherwise). */
  icon?: "logout";
}

/**
 * Modal confirmation (role="alertdialog"): used for sign-out, deletes, cancellations and every other
 * irreversible step. Never use `window.confirm` / `alert` — they block the page and ignore the design system.
 * Stays open while `pending` so the user sees the action finish.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  trigger,
  onConfirm,
  pending,
  children,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  icon,
}: ConfirmOptions & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  onConfirm: () => void;
  pending?: boolean;
  children?: ReactNode;
}) {
  const t = TONES[tone];
  const Icon = icon === "logout" ? LogOut : tone === "primary" ? HelpCircle : AlertTriangle;
  return (
    <A.Root open={open} onOpenChange={(o) => !pending && onOpenChange?.(o)}>
      {trigger && <A.Trigger asChild>{trigger}</A.Trigger>}
      <A.Portal>
        <A.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[#0a1450]/40 backdrop-blur-[1px]" />
        <A.Content
          className={cn(
            "fixed z-50 flex w-full flex-col bg-white shadow-modal focus:outline-none",
            "inset-x-0 bottom-0 animate-slide-up rounded-t-[20px]",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]",
          )}
        >
          <div className="flex gap-3 px-4 pt-4 pb-3 sm:gap-4 sm:px-5 sm:pt-5 sm:pb-4">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", t.wrap)} aria-hidden>
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <A.Title className="font-display text-base font-semibold text-ink sm:text-lg">{title}</A.Title>
              {description ? (
                <A.Description className="mt-1 text-[13px] text-ink-2 sm:mt-1.5 sm:text-sm">{description}</A.Description>
              ) : (
                <A.Description className="sr-only">{typeof title === "string" ? title : "Please confirm"}</A.Description>
              )}
              {children && <div className="mt-3">{children}</div>}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-4 py-2.5 sm:px-5 sm:py-3">
            <A.Cancel asChild>
              <Button variant="secondary" disabled={pending}>
                {cancelLabel}
              </Button>
            </A.Cancel>
            <Button variant={t.button} loading={pending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

/** Hosts one shared confirmation dialog for `useConfirm()`. Mounted once in the root layout. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((opts) => {
    resolver.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <ConfirmDialog
        open={options !== null}
        onOpenChange={(o) => !o && settle(false)}
        onConfirm={() => settle(true)}
        title={options?.title ?? ""}
        description={options?.description}
        confirmLabel={options?.confirmLabel}
        cancelLabel={options?.cancelLabel}
        tone={options?.tone}
        icon={options?.icon}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * Promise-based confirmation for event handlers and menu items:
 * `if (await confirm({ title: "Delete?", tone: "danger" })) run(...)`.
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ask;
}
