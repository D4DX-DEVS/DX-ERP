import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

const PALETTE = [
  "bg-brand-100 text-brand-600",
  "bg-tone-orange-bg text-tone-orange",
  "bg-tone-green-bg text-tone-green",
  "bg-tone-purple-bg text-tone-purple",
  "bg-tone-amber-bg text-tone-amber",
];

function paletteFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-[13px]",
  lg: "size-14 text-lg",
  xl: "size-20 text-2xl",
};

export function Avatar({ name, src, size = "sm", className, ring }: { name: string; src?: string | null; size?: keyof typeof SIZES; className?: string; ring?: boolean }) {
  const base = cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold", SIZES[size], ring && "border-2 border-white", className);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cn(base, "object-cover")} referrerPolicy="no-referrer" />;
  }
  return (
    <span className={cn(base, paletteFor(name))} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 3, size = "xs" }: { people: { name: string; photo?: string | null }[]; max?: number; size?: keyof typeof SIZES }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center pl-1.5" title={people.map((p) => p.name).join(", ")}>
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} src={p.photo} size={size} ring className="-ml-1.5" />
      ))}
      {rest > 0 && <span className={cn("-ml-1.5 inline-flex items-center justify-center rounded-full border-2 border-white bg-track font-bold text-tone-gray", SIZES[size])}>+{rest}</span>}
    </span>
  );
}

/** Avatar + name + secondary line, optionally linked. */
export function PersonCell({ name, sub, photo, href, extra }: { name: string; sub?: ReactNode; photo?: string | null; href?: string; extra?: ReactNode }) {
  const content = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} src={photo} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink max-sm:whitespace-normal">
          <span className="truncate max-sm:break-words max-sm:whitespace-normal">{name}</span>
          {extra}
        </span>
        {sub && <span className="truncate text-xs text-muted max-sm:break-words max-sm:whitespace-normal">{sub}</span>}
      </span>
    </span>
  );
  return href ? (
    <Link href={href} className="block min-w-0 hover:[&_span.font-semibold]:text-brand-600">
      {content}
    </Link>
  ) : (
    content
  );
}
