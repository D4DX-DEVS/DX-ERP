"use client";

import { useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button, type ButtonProps } from "./button";
import { ConfirmDialog, type ConfirmTone } from "./confirm";
import { Dialog } from "./dialog";
import { Textarea } from "./input";
import { useServerAction } from "./form";

/** Button that runs a server action directly (optionally after a confirmation modal). */
export function ActionButton<T>({
  action,
  successMessage,
  confirm,
  confirmTitle,
  confirmLabel,
  confirmTone,
  onSuccess,
  children,
  ...props
}: Omit<ButtonProps, "onClick" | "action"> & {
  action: () => Promise<ActionResult<T>>;
  successMessage?: string | false;
  /** If set, a confirmation modal with this text is shown first. */
  confirm?: string;
  /** Modal heading (defaults to the button text, or "Are you sure?" for icon buttons). */
  confirmTitle?: string;
  /** Confirm button text (defaults to the button text). */
  confirmLabel?: string;
  /** Defaults to "danger" for danger buttons, else "primary". */
  confirmTone?: ConfirmTone;
  onSuccess?: (data: T) => void;
}) {
  const { pending, run } = useServerAction();
  const [open, setOpen] = useState(false);
  const execute = () => run(action, { successMessage, onSuccess: (d) => { setOpen(false); onSuccess?.(d); } });

  if (!confirm) {
    return (
      <Button loading={pending} onClick={execute} {...props}>
        {children}
      </Button>
    );
  }
  const text = typeof children === "string" ? children : undefined;
  const danger = props.variant === "danger" || props.variant === "danger-outline";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      pending={pending}
      onConfirm={execute}
      title={confirmTitle ?? (text ? `${text}?` : "Are you sure?")}
      description={confirm}
      confirmLabel={confirmLabel ?? text ?? "Confirm"}
      tone={confirmTone ?? (danger ? "danger" : "primary")}
      trigger={
        <Button {...props} loading={pending}>
          {children}
        </Button>
      }
    />
  );
}

/**
 * Button that opens a dialog asking for a note / reason, then runs the action with it.
 * Used for reject, request correction, cancel with reason, etc.
 */
export function ReasonAction<T>({
  action,
  title,
  description,
  label = "Reason",
  placeholder,
  required = true,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
  successMessage,
  trigger,
}: {
  action: (reason: string) => Promise<ActionResult<T>>;
  title: string;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  required?: boolean;
  confirmLabel?: string;
  confirmVariant?: ButtonProps["variant"];
  successMessage?: string | false;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const { pending, run } = useServerAction();
  const invalid = required && reason.trim().length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setReason("");
          setTouched(false);
        }
      }}
      size="sm"
      title={title}
      description={description}
      trigger={trigger}
      footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            loading={pending}
            onClick={() => {
              setTouched(true);
              if (invalid) return;
              run(() => action(reason.trim()), { successMessage, onSuccess: () => setOpen(false) });
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
        {label}
        {required && <span className="sr-only">(required)</span>}
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder ?? (required ? "Required" : "Optional")} rows={3} aria-invalid={touched && invalid} />
      </label>
      {touched && invalid && <p className="mt-1.5 text-xs font-medium text-danger">{label} is required.</p>}
    </Dialog>
  );
}
