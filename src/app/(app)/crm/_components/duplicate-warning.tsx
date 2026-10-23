"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { formValues, useServerAction } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import type { DuplicateReport } from "../_lib/duplicates";

/**
 * Warning shown when a new lead / client looks like an existing record. Creation requires an
 * explicit "Create anyway", which re-submits the form values with `confirmDuplicates`.
 */
export function DuplicateWarning<T extends { id: string } | { duplicates: DuplicateReport }>({
  report,
  submit,
  onCreated,
  noun,
}: {
  report: DuplicateReport;
  submit: (values: Record<string, unknown>) => Promise<ActionResult<T>>;
  onCreated: (id: string) => void;
  noun: string;
}) {
  const { pending, run } = useServerAction();
  return (
    <Alert
      tone="warning"
      title="Possible duplicate."
      action={
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={pending}
          onClick={(e) => {
            const form = e.currentTarget.closest("form");
            if (!form) return;
            run(() => submit({ ...formValues(form), confirmDuplicates: "true" }), {
              successMessage: false,
              refresh: false,
              onSuccess: (data) => {
                if ("id" in data) onCreated(data.id);
              },
            });
          }}
        >
          Create anyway
        </Button>
      }
    >
      <span>
        Existing records share an email, phone number or company name with this {noun}. Check them before creating another.
      </span>
      <ul className="mt-2 flex flex-col gap-1.5">
        {report.matches.map((m) => (
          <li key={`${m.kind}-${m.id}`} className="flex flex-wrap items-center gap-x-2 text-[13px]">
            <Link href={m.href} target="_blank" className="font-semibold underline underline-offset-2">
              {m.title}
            </Link>
            <span className="text-[#6f4000]/80">
              {m.kind === "client" ? "Client" : "Open lead"} · {m.subtitle}
            </span>
            <span className="rounded bg-white/60 px-1.5 text-[11px] font-semibold">{m.reasons.join(" · ")}</span>
          </li>
        ))}
        {report.restricted > 0 && <li className="text-[13px]">{report.restricted} more matching record{report.restricted === 1 ? " is" : "s are"} restricted and can&apos;t be shown.</li>}
      </ul>
    </Alert>
  );
}
