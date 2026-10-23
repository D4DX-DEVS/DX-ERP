import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline" | "success" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm",
  secondary: "border border-line-strong bg-white text-ink hover:bg-field active:bg-line-soft",
  ghost: "text-ink-2 hover:bg-field hover:text-ink",
  danger: "bg-danger text-white hover:bg-[#9b1c1c]",
  "danger-outline": "border border-[#f3c2c2] bg-white text-danger hover:bg-danger-bg",
  success: "bg-success text-white hover:bg-[#0b6647]",
  link: "text-brand-600 hover:text-brand-800 hover:underline underline-offset-2 !h-auto !px-0",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-9 px-3 text-[13px] rounded-[10px] gap-1.5 sm:h-10 sm:px-4 sm:text-sm sm:gap-2",
  lg: "h-11 px-4 text-sm rounded-xl gap-2 sm:h-12 sm:px-5 sm:text-[15px]",
  icon: "size-9 rounded-[10px] sm:size-10",
  "icon-sm": "h-8 w-8 rounded-lg",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors select-none",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function ButtonLink({ variant = "primary", size = "md", icon, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}
