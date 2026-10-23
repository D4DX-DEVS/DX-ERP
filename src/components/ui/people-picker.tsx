"use client";

import { useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "./avatar";

export interface PickerOption {
  id: string;
  name: string;
  employeeId?: string;
  designation?: string;
  personType?: string;
  photo?: string;
}

/**
 * Searchable person picker. Single mode posts `name`; multiple mode posts `name[]` values.
 * Works inside <ActionForm> (hidden inputs) or controlled via `onChange`.
 */
export function PeoplePicker({
  name,
  options,
  multiple = false,
  defaultValue,
  placeholder = "Select person",
  onChange,
  className,
  disabled,
  allowClear = true,
}: {
  name: string;
  options: PickerOption[];
  multiple?: boolean;
  defaultValue?: string | string[] | null;
  placeholder?: string;
  onChange?: (ids: string[]) => void;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const initial = Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : [];
  const [selected, setSelected] = useState<string[]>(initial.filter(Boolean));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 200);
    return options.filter((o) => `${o.name} ${o.employeeId ?? ""} ${o.designation ?? ""}`.toLowerCase().includes(q)).slice(0, 200);
  }, [options, query]);

  const commit = (next: string[]) => {
    setSelected(next);
    onChange?.(next);
  };

  const toggle = (id: string) => {
    if (multiple) commit(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      commit([id]);
      setOpen(false);
    }
  };

  const chosen = selected.map((id) => byId.get(id)).filter(Boolean) as PickerOption[];

  return (
    <div className={cn("min-w-0", className)}>
      {multiple ? selected.map((id) => <input key={id} type="hidden" name={`${name}[]`} value={id} />) : <input type="hidden" name={name} value={selected[0] ?? ""} />}
      <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <Popover.Trigger asChild disabled={disabled}>
          <button
            type="button"
            id={name}
            className="flex min-h-10 w-full items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 py-1.5 text-left text-sm text-ink focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 focus:outline-none disabled:bg-field disabled:text-muted "
          >
            <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {chosen.length === 0 && <span className="text-subtle">{placeholder}</span>}
              {!multiple && chosen[0] && (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={chosen[0].name} src={chosen[0].photo} size="xs" />
                  <span className="truncate">{chosen[0].name}</span>
                </span>
              )}
              {multiple &&
                chosen.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2 text-xs font-medium text-brand-700">
                    {p.name}
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remove ${p.name}`}
                      className="rounded-full p-0.5 hover:bg-brand-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        commit(selected.filter((x) => x !== p.id));
                      }}
                    >
                      <X className="size-3" />
                    </span>
                  </span>
                ))}
            </span>
            {!multiple && allowClear && chosen[0] ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                className="text-subtle hover:text-ink"
                onClick={(e) => {
                  e.stopPropagation();
                  commit([]);
                }}
              >
                <X className="size-4" />
              </span>
            ) : (
              <ChevronDown className="size-4 shrink-0 text-muted" />
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-64 animate-fade-in rounded-xl border border-line bg-white p-1.5 shadow-popover">
            <label className="mb-1 flex h-9 items-center gap-2 rounded-lg bg-field px-2.5 text-muted">
              <Search className="size-4" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or ID" className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none sm:text-sm" />
            </label>
            <ul className="scrollbar-thin max-h-64 overflow-y-auto" role="listbox" aria-multiselectable={multiple}>
              {filtered.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-muted">No matches</li>}
              {filtered.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <li key={o.id} role="option" aria-selected={on}>
                    <button type="button" onClick={() => toggle(o.id)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-field", on && "bg-brand-50")}>
                      <Avatar name={o.name} src={o.photo} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-ink">{o.name}</span>
                        <span className="truncate text-xs text-muted">{[o.employeeId, o.designation].filter(Boolean).join(" · ")}</span>
                      </span>
                      {on && <Check className="size-4 text-brand-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
