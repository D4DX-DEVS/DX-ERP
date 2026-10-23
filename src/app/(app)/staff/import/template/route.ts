import { can, getCurrentUser } from "@/lib/auth/session";
import { IMPORT_COLUMNS } from "../../_lib/import";

/** CSV template for the people import. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "staff.create")) return new Response("You don't have permission to import people.", { status: 403 });

  const lines = [
    IMPORT_COLUMNS.join(","),
    "Jane Example,jane.example@example.com,employee,employee,Engineering,Software Engineer,full_time,2026-11-02,+91 90000 00000,manager@your-company.com",
  ];
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="people-import-template.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
