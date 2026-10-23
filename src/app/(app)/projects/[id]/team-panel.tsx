"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { PersonCell } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { removeTeamMember, saveTeamMember } from "../actions";

export interface TeamMemberView {
  userId: string;
  name: string;
  photo?: string;
  role: string;
  allocation: number;
  openTasks: number;
}

function MemberForm({ projectId, member, people, onDone }: { projectId: string; member?: TeamMemberView; people: PickerOption[]; onDone: () => void }) {
  return (
    <ActionForm action={(input) => saveTeamMember(projectId, input)} values={member ? { user: member.userId } : undefined} successMessage={member ? "Team updated" : "Team member added"} onSuccess={onDone}>
      <FormGrid>
        {!member && (
          <Field label="Person" name="user" required className="sm:col-span-2">
            <PeoplePicker name="user" options={people} placeholder="Select person" />
          </Field>
        )}
        <Field label="Role" name="role">
          <Input id="role" name="role" defaultValue={member?.role} maxLength={100} placeholder="e.g. Developer" />
        </Field>
        <Field label="Allocation %" name="allocation" required>
          <Input id="allocation" name="allocation" type="number" inputMode="numeric" min={0} max={100} defaultValue={member?.allocation ?? 100} />
        </Field>
      </FormGrid>
      <FormActions>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton>{member ? "Save" : "Add to team"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

function EditMember({ projectId, member, people }: { projectId: string; member: TeamMemberView; people: PickerOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title={`Edit ${member.name}`}
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${member.name}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      }
    >
      <MemberForm projectId={projectId} member={member} people={people} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

/** Team roster with role and allocation; managers can add, edit and remove members. */
export function TeamPanel({
  projectId,
  manager,
  members,
  people,
  canManage,
}: {
  projectId: string;
  manager?: { name: string; photo?: string };
  members: TeamMemberView[];
  /** People not yet on the team. */
  people: PickerOption[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="font-display text-[17px] font-semibold text-ink">Team</h2>
        {canManage && (
          <Dialog
            open={adding}
            onOpenChange={setAdding}
            size="sm"
            title="Add team member"
            trigger={
              <Button size="sm" icon={<Plus className="size-4" aria-hidden />}>
                Add member
              </Button>
            }
          >
            <MemberForm projectId={projectId} people={people} onDone={() => setAdding(false)} />
          </Dialog>
        )}
      </div>
      <TableWrap phone={[1, 3, "last"]} tablet={[1, 2, 3, 4, "last"]}>
        <THead>
          <Th>Person</Th>
          <Th>Role</Th>
          <Th align="right">Allocation</Th>
          <Th align="right">Open tasks</Th>
          {canManage && <Th align="right">Actions</Th>}
        </THead>
        <tbody>
          {manager && (
            <Tr>
              <Td>
                <PersonCell name={manager.name} photo={manager.photo} />
              </Td>
              <Td className="text-muted">Project manager</Td>
              <Td align="right">—</Td>
              <Td align="right">—</Td>
              {canManage && <Td />}
            </Tr>
          )}
          {members.length === 0 && !manager && <EmptyRow colSpan={canManage ? 5 : 4}>No team members yet.</EmptyRow>}
          {members.map((m) => (
            <Tr key={m.userId}>
              <Td>
                <PersonCell name={m.name} photo={m.photo} />
              </Td>
              <Td className="text-ink-2">{m.role || "—"}</Td>
              <Td align="right">{m.allocation}%</Td>
              <Td align="right">{m.openTasks}</Td>
              {canManage && (
                <Td align="right">
                  <span className="inline-flex items-center gap-1">
                    <EditMember projectId={projectId} member={m} people={people} />
                    <ActionButton
                      action={() => removeTeamMember(projectId, m.userId)}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${m.name}`}
                      confirmTone="danger" confirmTitle="Remove team member" confirmLabel="Remove" confirm={`Remove ${m.name} from this project?`}
                      successMessage="Team member removed"
                    >
                      <Trash2 className="size-4 text-danger" aria-hidden />
                    </ActionButton>
                  </span>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}
