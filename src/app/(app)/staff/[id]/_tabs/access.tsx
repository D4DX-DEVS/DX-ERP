import { connectDB } from "@/lib/db";
import { Role } from "@/lib/models";
import { assignableRoles } from "@/lib/rbac/roles";
import { fmtDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { Alert } from "@/components/ui/page";
import { LoginAccessButton, RoleForm } from "../../_components/access-controls";
import { SessionList } from "../../_components/session-list";
import { loadSessions } from "../../_lib/sessions";
import { revokeAllSessions, revokeSession } from "../actions";
import type { TabProps } from "./types";

/** Login access, role and sessions. Only rendered for users.manage. */
export async function AccessTab({ user, person, settings }: TabProps) {
  await connectDB();
  const id = person._id.toString();
  const [roles, role, sessions] = await Promise.all([assignableRoles(), Role.findOne({ key: person.role }, { name: 1 }).lean(), loadSessions(person._id)]);
  const self = id === user.id;
  const exited = settings.employmentStatuses.find((s) => s.key === person.status)?.category === "exited";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-1">
        <Card>
          <CardHeader title="Login access" />
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <StatusChip domain="account" value={person.accountActive ? "active" : "inactive"} />
            </div>
            <DetailList
              columns={1}
              items={[
                { label: "Sign-in account", value: person.email },
                { label: "Google account linked", value: person.googleSub ? "Yes" : "Not yet — links on first sign-in" },
                { label: "Last sign-in", value: person.lastLoginAt ? fmtDateTime(person.lastLoginAt) : "Never" },
              ]}
            />
            {self ? (
              <Alert tone="info">You can&apos;t change your own access here.</Alert>
            ) : exited && !person.accountActive ? (
              <Alert tone="warning">This person has left. Re-activate them from the Lifecycle menu before enabling access.</Alert>
            ) : (
              <div>
                <LoginAccessButton userId={id} enabled={person.accountActive} name={person.name} />
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Role" subtitle={role?.name ?? person.role} />
          <CardBody>{self ? <p className="text-[13px] text-muted">You can&apos;t change your own role.</p> : <RoleForm userId={id} role={person.role} roles={roles} />}</CardBody>
        </Card>
      </div>
      <Card className="lg:col-span-2">
        <CardHeader title="Active sessions" subtitle="Revoking a session signs that device out immediately." />
        <CardBody>
          <SessionList sessions={sessions} revoke={revokeSession.bind(null, id)} revokeAll={revokeAllSessions.bind(null, id)} revokeAllLabel="Sign out everywhere" />
        </CardBody>
      </Card>
    </div>
  );
}
