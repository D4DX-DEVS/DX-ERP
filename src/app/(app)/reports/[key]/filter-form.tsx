import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { ResolvedFilter } from "@/lib/reports/filters";

/** Plain GET form: filters live in the URL so a report view is bookmarkable and exportable. */
export function FilterForm({ action, filters }: { action: string; filters: ResolvedFilter[] }) {
  return (
    <form method="get" action={action} className="flex flex-col gap-4 rounded-[14px] border border-line bg-white p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {filters.map(({ def, value, options }) => {
          const id = `filter-${def.key}`;
          return (
            <div key={def.key} className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
                {def.label}
              </label>
              {def.type === "date" || def.type === "month" ? (
                <Input id={id} name={def.key} type={def.type} defaultValue={value} />
              ) : (
                <Select id={id} name={def.key} defaultValue={value}>
                  {!def.defaultValue && <option value="">{def.type === "select" ? "All" : def.type === "person" ? "Everyone" : `All ${def.type === "department" ? "departments" : def.type === "project" ? "projects" : "clients"}`}</option>}
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={action} className={buttonClass("ghost", "md")}>
          Reset
        </Link>
        <button type="submit" className={buttonClass("primary", "md")}>
          Apply filters
        </button>
      </div>
    </form>
  );
}
