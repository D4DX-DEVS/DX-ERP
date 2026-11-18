"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { isStaff } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DailyUpdate, newId, Project } from "@/lib/models";
import { inList, notInList } from "@/lib/sql";
import { fmtDate, todayKey } from "@/lib/time";
import { zs } from "@/lib/validation";
import { loggableProjectIds } from "@/lib/work-access";
import { MAX_POINTS, MAX_PROJECTS, POINT_MAX } from "./limits";

/** Rows per insert statement: 7 columns each, D1 allows 100 bound parameters. */
const ROWS_PER_INSERT = 14;

const schema = z.object({
  date: zs.date("Date"),
  entries: z
    .array(z.object({ project: zs.id("Project"), points: z.array(z.string()).max(MAX_POINTS, `Up to ${MAX_POINTS} points per project`) }))
    .max(MAX_PROJECTS, `Up to ${MAX_PROJECTS} projects a day`)
    .default([]),
});

/** Saves the signed-in user's update for a day: one set of points per project, replacing what was saved for that day. */
export async function saveDailyUpdate(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isStaff(user)) throw new ActionError("Daily updates are posted by staff members.");
    const data = parse(schema, input);
    if (data.date > todayKey()) throw new ActionError("You can't post an update for a future date.", { date: "Choose today or an earlier date" });

    const entries = new Map<string, string[]>();
    for (const e of data.entries) {
      const points = e.points.map((p) => p.trim()).filter(Boolean);
      entries.set(e.project, [...(entries.get(e.project) ?? []), ...points]);
    }
    if (entries.size === 0) throw new ActionError("Add at least one project with what you worked on.", { projects: "Pick a project" });

    const [loggable, existing, projects] = await Promise.all([
      loggableProjectIds(user),
      db().select({ project: DailyUpdate.project }).from(DailyUpdate).where(and(eq(DailyUpdate.user, user._id), eq(DailyUpdate.date, data.date))),
      db().select({ id: Project._id, projectNo: Project.projectNo }).from(Project).where(inList(Project._id, [...entries.keys()])),
    ]);
    // A day's own projects stay editable even if the person has since left that project.
    const allowed = new Set([...loggable, ...existing.map((r) => r.project)]);
    const projectNo = new Map(projects.map((p) => [p.id, p.projectNo]));
    for (const [project, points] of entries) {
      if (!projectNo.has(project) || !allowed.has(project)) throw new ActionError("You can only post updates for your assigned projects.", { projects: "Choose one of your projects" });
      if (points.length === 0) throw new ActionError(`Add at least one point for ${projectNo.get(project)}.`, { [`points.${project}`]: "Add at least one point" });
      if (points.length > MAX_POINTS) throw new ActionError(`Up to ${MAX_POINTS} points per project.`, { [`points.${project}`]: "Too many points" });
      if (points.some((p) => p.length > POINT_MAX)) throw new ActionError(`Keep each point under ${POINT_MAX} characters.`, { [`points.${project}`]: "A point is too long" });
    }

    const now = new Date();
    const rows = [...entries].map(([project, points]) => ({ _id: newId(), user: user._id, date: data.date, project, points, createdAt: now, updatedAt: now }));
    const dayRows = and(eq(DailyUpdate.user, user._id), eq(DailyUpdate.date, data.date));
    const inserts = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      inserts.push(
        db()
          .insert(DailyUpdate)
          .values(rows.slice(i, i + ROWS_PER_INSERT))
          .onConflictDoUpdate({ target: [DailyUpdate.user, DailyUpdate.date, DailyUpdate.project], set: { points: sql`excluded.points`, updatedAt: now } }),
      );
    }
    // One atomic round trip: drop projects removed from the day, then upsert the rest (keeps each row's createdAt).
    await db().batch([db().delete(DailyUpdate).where(and(dayRows, notInList(DailyUpdate.project, [...entries.keys()]))), ...inserts]);

    const label = fmtDate(data.date, "d MMM yyyy");
    await audit(user, {
      action: existing.length ? "update" : "create",
      entity: "daily_update",
      ref: data.date,
      summary: `${existing.length ? "Updated" : "Posted"} daily update for ${label} (${[...entries.keys()].map((p) => projectNo.get(p)).join(", ")})`,
    });
    return null;
  }, "Daily update saved");
}

/** Deletes the signed-in user's update for a day. */
export async function deleteDailyUpdate(date: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const day = parse(zs.date("Date"), date);
    const removed = await db()
      .delete(DailyUpdate)
      .where(and(eq(DailyUpdate.user, user._id), eq(DailyUpdate.date, day)))
      .returning({ id: DailyUpdate._id });
    if (!removed.length) throw new ActionError("There is no update for that day.");
    await audit(user, { action: "delete", entity: "daily_update", ref: day, summary: `Deleted daily update for ${fmtDate(day, "d MMM yyyy")}` });
    return null;
  }, "Daily update deleted");
}
