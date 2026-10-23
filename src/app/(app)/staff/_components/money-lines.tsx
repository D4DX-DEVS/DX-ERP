"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Line {
  key: number;
  name: string;
  amount: string;
}

/**
 * Repeater for named amounts (salary allowances / deductions). Posts `${prefix}Name[]` and
 * `${prefix}Amount[]`, which the server zips with `parseMoneyLines`.
 */
export function MoneyLines({
  label,
  prefix,
  initial = [],
  suggestions = [],
}: {
  label: string;
  prefix: string;
  initial?: { name: string; amount: number }[];
  suggestions?: string[];
}) {
  const nextKey = useRef(initial.length);
  const [lines, setLines] = useState<Line[]>(initial.map((l, i) => ({ key: i, name: l.name, amount: String(l.amount) })));
  const listId = `${prefix}-suggestions`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink-2">{label}</span>
        <Button type="button" size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setLines((l) => [...l, { key: nextKey.current++, name: "", amount: "" }])}>
          Add line
        </Button>
      </div>
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {lines.length === 0 && <p className="text-[13px] text-muted">None added.</p>}
      {lines.map((line) => (
        <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_2.25rem] items-center gap-2">
          <Input
            name={`${prefix}Name[]`}
            list={suggestions.length > 0 ? listId : undefined}
            aria-label={`${label} name`}
            placeholder="Name"
            value={line.name}
            onChange={(e) => setLines((all) => all.map((l) => (l.key === line.key ? { ...l, name: e.target.value } : l)))}
          />
          <Input
            name={`${prefix}Amount[]`}
            inputMode="decimal"
            aria-label={`${label} amount`}
            placeholder="₹ / month"
            value={line.amount}
            onChange={(e) => setLines((all) => all.map((l) => (l.key === line.key ? { ...l, amount: e.target.value } : l)))}
          />
          <button type="button" aria-label="Remove line" className="flex size-9 items-center justify-center rounded-lg text-subtle hover:bg-field hover:text-danger" onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}>
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
