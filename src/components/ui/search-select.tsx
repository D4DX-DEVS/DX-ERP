"use client";

import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/cn";

interface Option {
  value: string;
  label: string;
  disabled: boolean;
  hidden: boolean;
}

/** Visible text of an `<option>`'s children. */
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : ""))
    .join("");
}

/** The `<option>`s among the children (inside fragments and `<optgroup>`s too), in order. */
function optionsOf(children: ReactNode): Option[] {
  const out: Option[] = [];
  const walk = (node: ReactNode) =>
    Children.forEach(node, (child) => {
      if (!isValidElement<ComponentProps<"option">>(child)) return;
      if (child.type === Fragment || child.type === "optgroup") return walk(child.props.children);
      if (child.type !== "option") return;
      const label = textOf(child.props.children);
      out.push({ value: child.props.value === undefined ? label : String(child.props.value), label, disabled: Boolean(child.props.disabled), hidden: Boolean(child.props.hidden) });
    });
  walk(children);
  return out;
}

/**
 * Drop-in for a native `<select>` (same props, `<option>` children) whose list opens with a search box.
 * A hidden native select holds the value, so `name`, `defaultValue`, form reset and
 * `onChange={(e) => e.target.value}` work as before. `className` styles the visible button.
 */
export function SearchSelect({
  className,
  children,
  id,
  title,
  disabled,
  onChange,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: Omit<ComponentProps<"select">, "ref">) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string>();
  // A native select keeps its first default (later changes are ignored) and returns to it on form reset.
  const [initial] = useState(props.defaultValue);

  const options = optionsOf(children);
  const has = (v: unknown) => v !== undefined && v !== null && options.some((o) => o.value === String(v));
  const fallback = options.find((o) => !o.disabled)?.value ?? "";
  const current = props.value !== undefined ? String(props.value) : has(picked) ? picked! : has(initial) ? String(initial) : fallback;
  const selected = options.find((o) => o.value === current);
  const visible = options.filter((o) => !o.hidden);
  const q = query.trim().toLowerCase();
  const shown = q ? visible.filter((o) => o.label.toLowerCase().includes(q)) : visible;

  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form) return;
    const reset = () => setPicked(undefined);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, []);

  const openList = (seed = "") => {
    setQuery(seed);
    setActive(seed ? 0 : Math.max(0, visible.findIndex((o) => o.value === current)));
    setOpen(true);
  };

  const pick = (o: Option | undefined) => {
    if (!o || o.disabled) return;
    setOpen(false);
    const el = selectRef.current;
    if (!el || el.value === o.value) return;
    // Set the native value and fire a real change event, so React's onChange (and form listeners) run.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(el, o.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const move = (e: KeyboardEvent, dir: 1 | -1) => {
    e.preventDefault();
    if (shown.length === 0) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + dir + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
    listRef.current?.children[i]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <>
      <select
        {...props}
        ref={selectRef}
        disabled={disabled}
        aria-hidden
        tabIndex={-1}
        className="sr-only"
        onChange={(e) => {
          setPicked(e.target.value);
          onChange?.(e);
        }}
      >
        {children}
      </select>
      <Popover.Root open={open} onOpenChange={(o) => (o ? openList() : setOpen(false))}>
        <Popover.Trigger asChild disabled={disabled}>
          <button
            type="button"
            id={id}
            title={title}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid}
            aria-required={props.required}
            aria-describedby={ariaDescribedBy}
            aria-haspopup="listbox"
            className={cn("grid grid-cols-[minmax(0,1fr)] content-center text-left", className)}
            onKeyDown={(e) => {
              if (open) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                openList();
              } else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Typing on the closed dropdown starts a search.
                e.preventDefault();
                openList(e.key);
              }
            }}
          >
            <span className="col-start-1 row-start-1 truncate">{selected?.label}</span>
            {/* Invisible copies of the options keep the button as wide as its longest option, like a native select. */}
            {visible.map((o, i) => (
              <span key={i} aria-hidden className="invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap">
                {o.label}
              </span>
            ))}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              // Phones and tablets: keep the keyboard closed until the search box is tapped.
              if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
              listRef.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
            }}
            className="z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] min-w-56 animate-fade-in flex-col rounded-xl border border-line bg-white p-1.5 shadow-popover"
          >
            <label className="mb-1 flex h-9 shrink-0 items-center gap-2 rounded-lg bg-field px-2.5 text-muted">
              <Search className="size-4 shrink-0" aria-hidden />
              <input
                ref={inputRef}
                role="combobox"
                aria-label="Search options"
                aria-controls={listId}
                aria-expanded
                aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") move(e, 1);
                  else if (e.key === "ArrowUp") move(e, -1);
                  else if (e.key === "Enter") {
                    e.preventDefault();
                    pick(shown[active]);
                  }
                }}
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none sm:text-sm"
              />
            </label>
            <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              {shown.map((o, i) => (
                <li
                  key={`${i}:${o.value}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={o.value === current}
                  aria-disabled={o.disabled || undefined}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink",
                    i === active && "bg-field",
                    o.value === current && "font-semibold text-brand-600",
                    o.disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span className="min-w-0 flex-1 break-words">{o.label || " "}</span>
                  {o.value === current && <Check className="size-4 shrink-0" aria-hidden />}
                </li>
              ))}
              {shown.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-muted">No matches</li>}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
