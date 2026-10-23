import type { Metadata } from "next";
import Link from "next/link";
import {
  Bug,
  Building2,
  CheckSquare,
  FileSignature,
  FileText,
  FolderKanban,
  LogOut,
  Package,
  Receipt,
  Search,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { param, type SearchParams } from "@/lib/query";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import type { Tone } from "@/lib/config-defaults";
import { TONE_CLASSES } from "@/lib/status";
import { GROUP_SHOWN, runSearch, type SearchGroupKey } from "./search";

export const metadata: Metadata = { title: "Search" };

const STYLE: Record<SearchGroupKey, { icon: LucideIcon; tone: Tone }> = {
  people: { icon: Users, tone: "blue" },
  clients: { icon: Building2, tone: "purple" },
  leads: { icon: Target, tone: "purple" },
  projects: { icon: FolderKanban, tone: "green" },
  tasks: { icon: CheckSquare, tone: "blue" },
  issues: { icon: Bug, tone: "red" },
  invoices: { icon: Receipt, tone: "green" },
  proposals: { icon: FileText, tone: "amber" },
  contracts: { icon: FileSignature, tone: "gray" },
  movements: { icon: LogOut, tone: "orange" },
  assets: { icon: Package, tone: "gray" },
};

const MIN_LENGTH = 2;

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = param(sp, "q").slice(0, 100);
  const searched = q.length >= MIN_LENGTH;
  const groups = searched ? await runSearch(user, q) : [];
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <PageBody className="max-w-[860px]">
      <PageHeader overline="Everything you can access" title="Search" />

      <form action="/search" method="get" role="search" className="flex h-12 items-center gap-3 rounded-xl border border-line-strong bg-white px-4 text-muted focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100">
        <Search className="size-5 shrink-0" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q}
          autoFocus={!q}
          aria-label="Search people, clients, projects, tasks, invoices and more"
          placeholder="Search people, clients, projects, tasks, invoices…"
          maxLength={100}
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-subtle"
        />
        <button type="submit" className="h-8 rounded-lg bg-brand-600 px-3 text-[13px] font-semibold text-white hover:bg-brand-700">
          Search
        </button>
      </form>

      {!searched ? (
        <Card>
          <EmptyState icon={<Search className="size-5" />} title={q ? "Type at least two characters" : "Search across the ERP"} description="Find people by name or ID, clients, projects, tasks, invoices, proposals, contracts, movements (by person, number or date such as 2026-10-21) and assets. Results are limited to what your role can see." />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={<Search className="size-5" />} title={`No results for “${q}”`} description="Check the spelling, try a shorter term, or search by reference number. Results are limited to what your role can see." />
        </Card>
      ) : (
        <>
          <nav aria-label="Jump to results" className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <a key={g.key} href={`#group-${g.key}`} className="flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-white px-3 text-[13px] font-medium text-ink-2 hover:bg-field">
                {g.label}
                <span className="font-semibold text-ink tabular">{g.more ? `${GROUP_SHOWN}+` : g.items.length}</span>
              </a>
            ))}
          </nav>
          <p className="sr-only" role="status">
            {total} results shown
          </p>

          <div className="flex flex-col gap-4">
            {groups.map((g) => {
              const style = STYLE[g.key];
              const Icon = style.icon;
              const tone = TONE_CLASSES[style.tone];
              return (
                <Card key={g.key} id={`group-${g.key}`} className="scroll-mt-20 overflow-hidden">
                  <h2 className="px-5 pt-4 pb-2 font-sans text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{g.label}</h2>
                  <ul>
                    {g.items.map((item) => (
                      <li key={item.id}>
                        <Link href={item.href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-brand-50">
                          <span className={cn("flex size-[34px] shrink-0 items-center justify-center rounded-[10px]", tone.bg, tone.fg)}>
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                            {item.meta && <span className="block truncate text-xs text-muted">{item.meta}</span>}
                          </span>
                          {item.tag && <span className="max-w-[40%] shrink-0 truncate text-xs text-muted">{item.tag}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {g.more && (
                    <div className="border-t border-line-soft px-5 py-2.5">
                      <Link href={g.moreHref} className="text-[13px] font-semibold text-brand-600 hover:text-brand-800">
                        See all {g.label.toLowerCase()} matching “{q}” →
                      </Link>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <p className="text-center text-xs text-muted">Results are limited to what your role can see.</p>
        </>
      )}
    </PageBody>
  );
}
