import "server-only";
import { getTableColumns } from "drizzle-orm";
import { User } from "@/lib/models";

const HIDDEN = ["salary", "salaryHistory", "bank", "googleSub"] as const;

/**
 * Every User column except the confidential ones (salary, salary history, bank details) and the Google
 * subject — the projection of staff profile pages, which render for people without `staff.confidential`.
 */
export const personProfileColumns = Object.fromEntries(
  Object.entries(getTableColumns(User)).filter(([key]) => !(HIDDEN as readonly string[]).includes(key)),
) as Omit<(typeof User)["_"]["columns"], (typeof HIDDEN)[number]>;
