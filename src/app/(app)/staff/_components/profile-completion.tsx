import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/page";
import type { CompletionSectionKey, ProfileCompletion } from "../_lib/completion";

const tone = (pct: number) => (pct >= 100 ? "green" : pct >= 60 ? "brand" : "orange");

/** One-line bar for the profile header; links to the detailed card. */
export function ProfileCompletionBar({ completion, href }: { completion: ProfileCompletion; href: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-[10px] text-[13px]" title={`${completion.done} of ${completion.total} items on file`}>
      <span className="shrink-0 font-medium text-muted group-hover:text-brand-600">Profile completion</span>
      <Progress value={completion.pct} tone={tone(completion.pct)} className="flex-1" />
      <span className="w-10 shrink-0 text-right font-semibold text-ink tabular">{completion.pct}%</span>
    </Link>
  );
}

/** Overall percentage, a bar per section and what is still missing (with a link to where it is added). */
export function ProfileCompletionCard({
  completion,
  links = {},
  subtitle,
}: {
  completion: ProfileCompletion;
  /** Where each section is completed; sections without a link list their gaps as plain text. */
  links?: Partial<Record<CompletionSectionKey, string>>;
  subtitle?: string;
}) {
  return (
    <Card id="completion" className="scroll-mt-20">
      <CardHeader title="Profile completion" subtitle={subtitle ?? `${completion.done} of ${completion.total} items on file`} />
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="font-display text-[28px] leading-none font-semibold text-ink tabular">{completion.pct}%</span>
          <Progress value={completion.pct} tone={tone(completion.pct)} className="flex-1" />
        </div>
        <ul className="flex flex-col gap-3.5">
          {completion.sections.map((s) => {
            const missing = s.items.filter((i) => !i.done);
            const href = links[s.key];
            return (
              <li key={s.key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="font-semibold text-ink">{s.label}</span>
                  <span className="text-muted tabular">
                    {s.done}/{s.total}
                  </span>
                </div>
                <Progress value={(s.done * 100) / s.total} tone={tone((s.done * 100) / s.total)} size="sm" />
                {missing.length === 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success">
                    <CheckCircle2 className="size-3.5" aria-hidden /> Complete
                  </span>
                ) : (
                  <div className="text-xs break-words text-muted">
                    Missing: {missing.map((i) => i.label).join(" · ")}
                    {href && (
                      <>
                        {" "}
                        <Link href={href} className="font-semibold whitespace-nowrap text-brand-600 hover:underline">
                          Add →
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
