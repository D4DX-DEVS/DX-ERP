import type { CurrentUser } from "@/lib/auth/session";
import type { IProject } from "@/lib/models";
import { chatMembers, chatPage, markChatRead } from "./chat-data";
import { ChatPanel } from "./chat-panel";

/** Project chat: the latest messages and the people who can be mentioned; opening it marks the chat read. */
export async function ChatTab({ user, project }: { user: CurrentUser; project: Pick<IProject, "_id" | "manager" | "team"> }) {
  const [members, page] = await Promise.all([chatMembers(project), chatPage(project._id)]);
  const last = page.messages.at(-1);
  if (last) await markChatRead(project._id, user._id, new Date(last.at));
  return <ChatPanel projectId={project._id} me={user.id} moderator={user.isSuperAdmin} members={members} initial={page.messages} hasMore={page.more} />;
}
