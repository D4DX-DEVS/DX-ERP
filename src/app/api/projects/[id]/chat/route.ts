import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isObjectId } from "@/lib/validation";
import { chatChanges, chatPage, chatProject, markChatRead } from "@/app/(app)/projects/[id]/chat-data";

/**
 * GET /api/projects/<id>/chat — project chat for the panel (route handler, not a server action, so polling never queues
 * behind the page's own actions):
 *   ?since=<ms>[&read=1]  messages sent or deleted since then; `read=1` (the chat is on screen) marks them read
 *   ?before=<ms>          the page of messages before then ("Load earlier")
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const project = await chatProject(user, id);
  if (!project) return NextResponse.json({ error: "You don't have access to this chat" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const noStore = { headers: { "Cache-Control": "private, no-store" } };
  const before = Number(params.get("before"));
  if (before > 0) return NextResponse.json(await chatPage(id, before), noStore);

  const since = Number(params.get("since"));
  if (!Number.isFinite(since) || since < 0) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const messages = await chatChanges(id, since);
  const seen = messages.filter((m) => m.userId !== user.id && !m.deleted).reduce((max, m) => Math.max(max, m.at), 0);
  if (params.get("read") === "1" && seen > 0) await markChatRead(id, user._id, new Date(seen));
  return NextResponse.json({ messages }, noStore);
}
