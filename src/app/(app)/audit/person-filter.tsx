"use client";

import { useSetParams } from "@/components/ui/filters";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";

/** Person picker that drives a URL search parameter (used by the audit and asset filters). */
export function PersonFilter({ param, options, placeholder }: { param: string; options: PickerOption[]; placeholder: string }) {
  const { set, params } = useSetParams();
  const value = params.get(param);
  return <PeoplePicker key={value ?? "none"} name={param} options={options} defaultValue={value} placeholder={placeholder} onChange={(ids) => set({ [param]: ids[0] ?? null })} className="w-full sm:w-60" />;
}
