"use client";

import { createContext, useContext, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "./button";

export type FormAction<T = unknown> = (input: Record<string, unknown>) => Promise<ActionResult<T>>;

interface FormCtx {
  errors: Record<string, string>;
  pending: boolean;
}

const FormContext = createContext<FormCtx>({ errors: {}, pending: false });

export function useFormState(): FormCtx {
  return useContext(FormContext);
}

/**
 * Converts a form into a plain object. Repeated names and names ending in "[]" become arrays;
 * File inputs are skipped (uploads go through <FileUpload>, which posts file ids).
 */
export function formValues(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const data = new FormData(form);
  for (const [rawKey, value] of data.entries()) {
    if (typeof value !== "string") continue;
    const isArray = rawKey.endsWith("[]");
    const key = isArray ? rawKey.slice(0, -2) : rawKey;
    if (isArray) {
      out[key] = [...((out[key] as string[]) ?? []), value];
    } else if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface ActionFormProps<T> extends Omit<ComponentProps<"form">, "action" | "onSubmit"> {
  action: FormAction<T>;
  /** Extra values merged into the submitted object (e.g. a record id). */
  values?: Record<string, unknown>;
  onSuccess?: (data: T) => void;
  successMessage?: string | false;
  /** Calls router.refresh() after success (default true). */
  refresh?: boolean;
  resetOnSuccess?: boolean;
}

/** Form that submits to a server action and shows field errors + toasts. */
export function ActionForm<T>({
  action,
  values,
  onSuccess,
  successMessage = "Saved",
  refresh = true,
  resetOnSuccess = false,
  className,
  children,
  ...props
}: ActionFormProps<T>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <FormContext.Provider value={{ errors, pending }}>
      <form
        ref={formRef}
        noValidate
        className={cn("flex flex-col gap-3 sm:gap-4", className)}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const input = { ...formValues(form), ...values };
          startTransition(async () => {
            let result: ActionResult<T>;
            try {
              result = await action(input);
            } catch (error) {
              console.error(error);
              toast.error("Could not reach the server. Check your connection and try again.");
              return;
            }
            if (!result) return;
            if (result.ok) {
              setErrors({});
              const msg = result.message ?? successMessage;
              if (msg) toast.success(msg);
              if (resetOnSuccess) formRef.current?.reset();
              onSuccess?.(result.data);
              if (refresh) router.refresh();
            } else {
              setErrors(result.fieldErrors ?? {});
              toast.error(result.error);
            }
          });
        }}
        {...props}
      >
        {children}
      </form>
    </FormContext.Provider>
  );
}

/** Label + control + hint/error. The error is looked up by `name` from the surrounding ActionForm. */
export function Field({
  label,
  name,
  hint,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  name?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { errors } = useFormState();
  const error = name ? errors[name] : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 sm:gap-1.5", className)} data-invalid={error ? "" : undefined}>
      {label && (
        <label htmlFor={name} className="text-xs font-semibold text-ink-2 sm:text-[13px]">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      <div className="[&[data-invalid]_input]:border-danger" data-invalid={error ? "" : undefined}>
        {children}
      </div>
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Responsive grid for form fields. */
export function FormGrid({ cols = 2, className, children }: { cols?: 1 | 2 | 3 | 4; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:gap-4",
        cols === 1 && "grid-cols-1",
        cols === 2 && "grid-cols-1 sm:grid-cols-2",
        cols === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        cols === 4 && "grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FormSection({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("flex flex-col gap-3 border-t border-line-soft pt-4 first:border-t-0 first:pt-0 sm:gap-4 sm:pt-5", className)}>
      <div>
        <legend className="font-display text-sm font-semibold text-ink sm:text-[15px]">{title}</legend>
        {description && <p className="mt-0.5 text-xs text-muted sm:text-[13px]">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}

export function SubmitButton({ children = "Save", ...props }: ButtonProps) {
  const { pending } = useFormState();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}

export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 pt-2", className)}>{children}</div>;
}

/** Runs a server action imperatively (approve / reject / toggle buttons). */
export function useServerAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run<T>(
    fn: () => Promise<ActionResult<T>>,
    opts: { successMessage?: string | false; onSuccess?: (data: T) => void; refresh?: boolean } = {},
  ) {
    startTransition(async () => {
      let result: ActionResult<T>;
      try {
        result = await fn();
      } catch (error) {
        console.error(error);
        toast.error("Could not reach the server. Check your connection and try again.");
        return;
      }
      if (!result) return;
      if (result.ok) {
        const msg = result.message ?? opts.successMessage ?? "Done";
        if (msg) toast.success(msg);
        opts.onSuccess?.(result.data);
        if (opts.refresh !== false) router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return { pending, run };
}
