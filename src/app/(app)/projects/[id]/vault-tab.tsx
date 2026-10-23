import { KeyRound } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/session";
import { VaultEvent, VaultItem, type IProject } from "@/lib/models";
import { fmtDate, fmtDateTime, timeAgo, todayKey } from "@/lib/time";
import { peopleMap } from "@/lib/work-access";
import { vaultConfigured, VaultKeyError } from "@/lib/vault/crypto";
import { canManageItem, canSeeItem, openPayload, projectDataKey, type VaultRole } from "@/lib/vault/service";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/page";
import { VaultPanel, type VaultEventView, type VaultItemView } from "./vault-panel";

const ENV_LABELS: Record<string, string> = { development: "Development", staging: "Staging", testing: "Testing", production: "Production", other: "Other" };

const EVENT_LABELS: Record<string, string> = {
  create: "Added",
  update: "Edited",
  delete: "Deleted",
  access: "Changed sharing of",
  reveal: "Viewed",
  copy: "Copied",
  download: "Downloaded",
  edit_open: "Opened for editing",
};

/**
 * Secrets tab. Only rendered for the project manager, team members and the super admin (see `vaultRole`).
 * Values never leave the server here — the page gets names, variable names, URLs and usernames only;
 * values are fetched one reveal at a time through `revealVaultItem`.
 */
export async function VaultTab({ user, role, project }: { user: CurrentUser; role: VaultRole; project: Pick<IProject, "_id" | "manager" | "team"> }) {
  if (!vaultConfigured()) {
    return (
      <Card>
        <CardBody className="pt-5">
          <Alert tone="warning" title="Secrets vault not configured.">
            Set <code className="font-mono">VAULT_MASTER_KEY</code> (64 hex characters, e.g. from <code className="font-mono">openssl rand -hex 32</code>) in the server environment and restart the app.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  const items = (await VaultItem.find({ project: project._id }).sort({ kind: 1, name: 1 }).lean()).filter((i) => canSeeItem(user, role, i));
  const [people, events] = await Promise.all([
    peopleMap([project.manager, ...project.team.map((m) => m.user), ...items.flatMap((i) => [i.createdBy, i.updatedBy])]),
    role === "owner" ? VaultEvent.find({ project: project._id }).sort({ at: -1 }).limit(60).lean() : Promise.resolve([]),
  ]);

  let key: Buffer | null = null;
  let keyError: string | undefined;
  if (items.length) {
    try {
      key = await projectDataKey(project._id, false);
    } catch (error) {
      if (!(error instanceof VaultKeyError)) throw error;
      keyError = error.message;
    }
  }

  const today = todayKey();
  const teamSize = project.team.length;
  const audienceSize = new Set([project.manager?.toString(), ...project.team.map((m) => m.user.toString())].filter(Boolean)).size;
  const views: VaultItemView[] = items.map((i) => {
    let keys: string[] = [];
    let url: string | undefined;
    let username: string | undefined;
    let hasNotes = false;
    let broken = keyError;
    if (key) {
      try {
        const payload = openPayload(key, i);
        if (payload.kind === "env") keys = payload.entries.map((e) => e.key);
        if (payload.kind === "credential") {
          url = payload.url;
          username = payload.username;
          hasNotes = Boolean(payload.notes);
        }
      } catch (error) {
        if (!(error instanceof VaultKeyError)) throw error;
        broken = error.message;
      }
    }
    const updater = i.updatedBy ? people.get(i.updatedBy.toString())?.name : undefined;
    return {
      id: i._id.toString(),
      kind: i.kind,
      name: i.name,
      description: i.description,
      environment: i.environment,
      environmentLabel: i.environment ? ENV_LABELS[i.environment] : undefined,
      keys,
      url,
      username,
      hasNotes,
      entryCount: i.entryCount,
      audience: i.audience,
      members: i.members.map((m) => m.toString()),
      audienceLabel: i.audience === "team" ? `Whole team · ${audienceSize}` : i.members.length === 0 ? "Project manager only" : `Manager + ${i.members.length} selected`,
      notifyOnReveal: i.notifyOnReveal,
      rotateBy: i.rotateBy,
      rotateByLabel: i.rotateBy ? fmtDate(i.rotateBy) : undefined,
      rotationOverdue: Boolean(i.rotateBy && i.rotateBy < today),
      rotationAdvised: i.rotationAdvisedAt ? (i.rotationAdvisedReason ?? "Rotation advised") : undefined,
      version: i.version,
      updatedLabel: `${timeAgo(i.valuesUpdatedAt)}${updater ? ` by ${updater}` : ""}`,
      createdBy: people.get(i.createdBy.toString())?.name ?? "Unknown",
      canManage: canManageItem(user, role, i),
      broken,
    };
  });

  const eventViews: VaultEventView[] = events.map((e) => ({
    id: e._id.toString(),
    who: e.userName,
    action: EVENT_LABELS[e.action] ?? e.action,
    tone: e.action === "delete" ? "red" : e.action === "reveal" || e.action === "copy" || e.action === "download" || e.action === "edit_open" ? "amber" : "blue",
    itemName: e.itemName,
    field: e.field,
    when: fmtDateTime(e.at),
    ago: timeAgo(e.at),
    ip: e.ip,
  }));

  const teamOptions = project.team.map((m) => {
    const p = people.get(m.user.toString());
    return { id: m.user.toString(), name: p?.name ?? "Unknown", photo: p?.photo, personType: p?.personType };
  });
  const manager = project.manager ? people.get(project.manager.toString())?.name : undefined;

  return (
    <VaultPanel
      projectId={project._id.toString()}
      role={role}
      items={views}
      events={eventViews}
      teamOptions={teamOptions}
      whoCanSee={`${manager ? `${manager} (project manager)` : "The project manager"}, ${teamSize} team ${teamSize === 1 ? "member" : "members"} and the super admin`}
      empty={
        <EmptyState
          icon={<KeyRound className="size-5" aria-hidden />}
          title="No secrets yet"
          description="Store .env files, logins and secure notes for this project. Values are encrypted at rest and only the project team can open them."
        />
      }
    />
  );
}
