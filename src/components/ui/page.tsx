import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

/** Page title block: overline (section), H1, optional description and actions. */
export function PageHeader({
  overline,
  title,
  description,
  actions,
  back,
  className,
}: {
  overline?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3 sm:gap-4", className)}>
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-brand-600 sm:text-[13px]">
            ← {back.label}
          </Link>
        )}
        {overline && !back && <div className="text-xs text-muted sm:text-[13px]">{overline}</div>}
        <h1 className="mt-0.5 font-display text-lg leading-tight font-semibold text-ink sm:text-[26px]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-muted sm:text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Standard content column inside the app shell. */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 pt-4 pb-24 sm:gap-5 sm:px-6 sm:pt-5 md:pb-12 lg:px-8 lg:pt-7", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  href,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  href?: string;
  tone?: "default" | "alert" | "brand";
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted sm:text-[13px]">{label}</span>
        {icon && (
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-[9px] sm:size-8",
              tone === "alert" ? "bg-outside-bg text-outside" : "bg-brand-50 text-brand-600",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div className={cn("mt-1 font-display text-[22px] leading-none font-semibold tabular sm:text-[28px]", tone === "alert" ? "text-outside" : "text-ink")}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-muted sm:mt-2 sm:text-xs">{sub}</div>}
    </>
  );
  const cls = cn("flex min-w-0 flex-col rounded-[14px] border border-line bg-white p-3 sm:p-5", href && "transition-colors hover:border-brand-200", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Progress({ value, tone = "brand", className, size = "md" }: { value: number; tone?: "brand" | "green" | "orange" | "red"; className?: string; size?: "sm" | "md" }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = { brand: "bg-chart-1", green: "bg-chart-3", orange: "bg-chart-2", red: "bg-danger" }[tone];
  return (
    <div className={cn("w-full rounded-full bg-track", size === "md" ? "h-1.5" : "h-1", className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width]", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center sm:px-6 sm:py-12", className)}>
      {icon && <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {description && <div className="max-w-sm text-[13px] text-muted">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const ALERT_TONES = {
  info: { cls: "bg-brand-50 text-ink-2 border-brand-100", icon: Info, iconCls: "text-brand-600" },
  success: { cls: "bg-success-bg text-[#0b5c40] border-[#c5ead8]", icon: CheckCircle2, iconCls: "text-success" },
  warning: { cls: "bg-warning-bg text-[#6f4000] border-[#f6dfb2]", icon: AlertTriangle, iconCls: "text-warning" },
  danger: { cls: "bg-danger-bg text-[#8a1b1b] border-[#f6c9c9]", icon: XCircle, iconCls: "text-danger" },
  outside: { cls: "bg-outside-bg text-[#8a2f08] border-[#fcd3bd]", icon: AlertTriangle, iconCls: "text-outside" },
};

export function Alert({ tone = "info", title, children, action, className }: { tone?: keyof typeof ALERT_TONES; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const t = ALERT_TONES[tone];
  const Icon = t.icon;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs leading-relaxed sm:gap-3 sm:px-4 sm:py-3 sm:text-[13px]", t.cls, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", t.iconCls)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <strong className="font-semibold">{title} </strong>}
        {children}
      </div>
      {action}
    </div>
  );
}

/** Small metric used inside cards (e.g. "9 Active"). */
export function MiniStat({ value, label, className }: { value: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-xl bg-field px-3 py-2.5", className)}>
      <div className="font-display text-xl font-semibold text-ink tabular">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="font-display text-[17px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}
