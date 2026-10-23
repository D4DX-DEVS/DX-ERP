import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import mongoose from "mongoose";
import { ActionError, type ActionResult } from "@/lib/action-result";
import { can, getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import type { Permission } from "@/lib/rbac/permissions";

export { ActionError, type ActionResult };

/**
 * Wraps a server action body: connects to the DB, converts known errors into an
 * `ActionResult`, and lets Next.js control-flow errors (redirect / notFound) propagate.
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    await connectDB();
    const data = await fn();
    return { ok: true, data, message };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ActionError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
    }
    if (error instanceof mongoose.Error.ValidationError) {
      const fieldErrors: Record<string, string> = {};
      for (const [key, e] of Object.entries(error.errors)) fieldErrors[key] = e.message;
      return { ok: false, error: "Some values are invalid.", fieldErrors };
    }
    if (typeof error === "object" && error && "code" in error && (error as { code?: number }).code === 11000) {
      const keyValue = (error as { keyValue?: Record<string, unknown> }).keyValue ?? {};
      const field = Object.keys(keyValue)[0];
      return {
        ok: false,
        error: field ? `A record with this ${field} already exists.` : "This record already exists.",
        fieldErrors: field ? { [field]: "Already in use" } : undefined,
      };
    }
    console.error("[action] unexpected error", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Throws an ActionError when not signed in. */
export async function actionUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  return user;
}

/** Throws unless the user holds at least one of the permissions. */
export async function actionPermission(...permissions: Permission[]): Promise<CurrentUser> {
  const user = await actionUser();
  if (permissions.length && !permissions.some((p) => can(user, p))) {
    throw new ActionError("You don't have permission to do this.");
  }
  return user;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ActionError(message);
}

/** Parses input with a zod schema (ZodErrors become field errors via runAction). */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  return schema.parse(input);
}
