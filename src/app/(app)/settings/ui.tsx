"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm, FormActions, SubmitButton, type FormAction } from "@/components/ui/form";
import { Select } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

/** Editable list state with move / remove helpers and a dirty flag (rows are keyed by index). */
export function useRows<T>(initial: T[]) {
  const [rows, setRows] = useState<T[]>(initial);
  const [baseline] = useState(() => JSON.stringify(initial));
  return {
    rows,
    dirty: JSON.stringify(rows) !== baseline,
    add: (row: T) => setRows((r) => [...r, row]),
    update: (i: number, patch: Partial<T>) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x))),
    remove: (i: number) => setRows((r) => r.filter((_, idx) => idx !== i)),
    move: (i: number, dir: -1 | 1) =>
      setRows((r) => {
        const j = i + dir;
        if (j < 0 || j >= r.length) return r;
        const next = [...r];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
  };
}

/** Reorder + remove buttons for one list row. */
export function RowTools({
  index,
  count,
  label,
  onMove,
  onRemove,
  removeDisabled,
  removeHint,
}: {
  index: number;
  count: number;
  label: string;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  removeDisabled?: boolean;
  removeHint?: string;
}) {
  const btn = "flex size-8 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" className={btn} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>
        <ArrowUp className="size-4" />
      </button>
      <button type="button" className={btn} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>
        <ArrowDown className="size-4" />
      </button>
      <button
        type="button"
        className={cn(btn, "hover:bg-danger-bg hover:text-danger")}
        disabled={removeDisabled}
        title={removeDisabled ? removeHint : `Remove ${label}`}
        onClick={onRemove}
        aria-label={removeDisabled && removeHint ? `${label}: ${removeHint}` : `Remove ${label}`}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

/** Label shown above a control on phones; hidden on wider screens where a header row is used. */
export function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-semibold text-muted @3xl:sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Column captions for list editors (desktop only). */
export function ColHeaders({ labels, template }: { labels: string[]; template: string }) {
  return (
    <div className={cn("hidden gap-3 px-3 text-xs font-semibold text-muted @3xl:grid", template)}>
      {labels.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  );
}

export function ListRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-line bg-field/50 p-3", className)}>{children}</div>;
}

/** Form grid whose columns depend on the width of the card it sits in (not the viewport). Needs an `@container` ancestor. */
export function CGrid({ cols = 2, className, children }: { cols?: 2 | 3; className?: string; children: ReactNode }) {
  return <div className={cn("grid grid-cols-1 gap-4 @lg:grid-cols-2", cols === 3 && "@3xl:grid-cols-3", className)}>{children}</div>;
}

/** Card with a titled header used by every settings section. */
export function SettingsCard({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={description} action={action} className="pt-5" />
      <CardBody className="@container pt-1">{children}</CardBody>
    </Card>
  );
}

/** Footer with an "unsaved changes" hint and the submit button. */
export function SaveRow({ dirty, label = "Save changes" }: { dirty?: boolean; label?: string }) {
  return (
    <FormActions className="border-t border-line-soft pt-4">
      {dirty && <span className="mr-auto text-[13px] font-semibold text-warning">Unsaved changes</span>}
      <SubmitButton>{label}</SubmitButton>
    </FormActions>
  );
}

/** Toggle pill backed by a native checkbox (posts `name` with `value` when checked). */
export function PillCheck({
  name,
  value,
  label,
  defaultChecked,
  checked,
  onChange,
  className,
}: {
  name?: string;
  value?: string;
  label: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className="relative inline-flex cursor-pointer">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        checked={checked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex h-10 min-w-14 items-center justify-center rounded-[10px] border border-line-strong bg-white px-3 text-[13px] font-semibold text-muted transition-colors",
          "peer-checked:border-brand-600 peer-checked:bg-brand-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2",
          className,
        )}
      >
        {label}
      </span>
    </label>
  );
}

/** Dialog containing an ActionForm that closes itself on success. Remounts the form on every open. */
export function FormDialog<T>({
  trigger,
  title,
  description,
  action,
  successMessage = "Saved",
  values,
  size = "md",
  submitLabel = "Save",
  submitVariant,
  onSuccess,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  action: FormAction<T>;
  successMessage?: string | false;
  values?: Record<string, unknown>;
  size?: "sm" | "md" | "lg" | "xl";
  submitLabel?: string;
  submitVariant?: "primary" | "danger";
  onSuccess?: (data: T) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={title} description={description} size={size}>
      <ActionForm
        action={action}
        values={values}
        successMessage={successMessage}
        onSuccess={(data) => {
          setOpen(false);
          onSuccess?.(data);
        }}
      >
        {children}
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** Phone-friendly section switcher: a select that navigates to the chosen item's URL. */
export function LinkSelect({ items, value, label, className }: { items: { value: string; label: string; href: string }[]; value: string; label: string; className?: string }) {
  const router = useRouter();
  return (
    <Select
      aria-label={label}
      className={className}
      value={value}
      onChange={(e) => {
        const item = items.find((i) => i.value === e.target.value);
        if (item) router.push(item.href);
      }}
    >
      {items.map((i) => (
        <option key={i.value} value={i.value}>
          {i.label}
        </option>
      ))}
    </Select>
  );
}
