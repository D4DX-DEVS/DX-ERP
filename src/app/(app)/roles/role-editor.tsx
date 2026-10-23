"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import { Tag } from "@/components/ui/chip";
import { Field, FormGrid, useServerAction } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/page";
import { PERMISSION_GROUPS } from "@/lib/rbac/permissions";
import { plural } from "@/lib/format";
import { FormDialog } from "../settings/ui";
import { createRole, deleteRole, resetRolePermissions, saveRolePermissions, updateRoleDetails } from "./actions";

export interface RoleView {
  key: string;
  name: string;
  description?: string;
  system: boolean;
  permissions: string[];
  userCount: number;
}

export function CreateRoleButton({ roles }: { roles: { key: string; name: string }[] }) {
  const router = useRouter();
  return (
    <FormDialog
      trigger={
        <Button icon={<Plus className="size-4" />} size="md">
          New role
        </Button>
      }
      title="Create custom role"
      description="Start from scratch or copy the permissions of an existing role, then fine-tune them in the matrix."
      action={createRole}
      successMessage="Role created"
      submitLabel="Create role"
      onSuccess={(r) => router.push(`/roles?role=${r.key}`)}
    >
      <FormGrid>
        <Field label="Name" name="name" required>
          <Input id="name" name="name" maxLength={60} placeholder="e.g. Office coordinator" />
        </Field>
        <Field label="Key" name="key" required hint="Lowercase letters, digits and underscores. Can't be changed later.">
          <Input id="key" name="key" maxLength={31} placeholder="office_coordinator" className="font-mono" />
        </Field>
        <Field label="Description" name="description" className="sm:col-span-2">
          <Textarea id="description" name="description" rows={2} maxLength={300} />
        </Field>
        <Field label="Copy permissions from" name="copyFrom" className="sm:col-span-2">
          <Select id="copyFrom" name="copyFrom" defaultValue="">
            <option value="">Start with no permissions</option>
            {roles
              .filter((r) => r.key !== "super_admin")
              .map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
          </Select>
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

export function RoleEditor({ role }: { role: RoleView }) {
  const router = useRouter();
  const readOnly = role.key === "super_admin";
  const valid = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i[0] as string));
  const initial = valid.filter((p) => role.permissions.includes(p));
  const [selected, setSelected] = useState<string[]>(readOnly ? valid : initial);
  const { pending, run } = useServerAction();

  const on = new Set(selected);
  const dirty = !readOnly && (selected.length !== initial.length || selected.some((p) => !initial.includes(p)));
  const toggle = (p: string) => setSelected((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const setGroup = (items: string[], value: boolean) => setSelected((cur) => (value ? [...new Set([...cur, ...items])] : cur.filter((p) => !items.includes(p))));

  return (
    <Card className="@container">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-[19px] font-semibold text-ink">{role.name}</h2>
            <Tag tone={role.system ? "purple" : "blue"}>{role.system ? "System role" : "Custom role"}</Tag>
          </div>
          {role.description && <p className="mt-1 max-w-xl text-[13px] text-muted">{role.description}</p>}
          <p className="mt-1 text-[13px] text-muted">
            {plural(role.userCount, "person", "people")} · {selected.length} of {valid.length} permissions
          </p>
        </div>
        {!role.system && (
          <div className="flex flex-wrap gap-2">
            <FormDialog
              trigger={
                <Button variant="secondary" size="sm">
                  Edit details
                </Button>
              }
              title={`Edit ${role.name}`}
              action={updateRoleDetails}
              values={{ key: role.key }}
              successMessage="Role updated"
            >
              <FormGrid cols={1}>
                <Field label="Name" name="name" required>
                  <Input id="name" name="name" defaultValue={role.name} maxLength={60} />
                </Field>
                <Field label="Description" name="description">
                  <Textarea id="description" name="description" defaultValue={role.description} rows={3} maxLength={300} />
                </Field>
              </FormGrid>
            </FormDialog>
            <ActionButton
              variant="danger-outline"
              size="sm"
              disabled={role.userCount > 0}
              title={role.userCount > 0 ? "Move the people with this role elsewhere first" : undefined}
              action={() => deleteRole(role.key)}
              confirm={`Delete the role ${role.name}? This can't be undone.`}
              successMessage="Role deleted"
              onSuccess={() => router.replace("/roles")}
            >
              Delete role
            </ActionButton>
          </div>
        )}
      </div>

      {readOnly && (
        <div className="px-5 pt-4">
          <Alert tone="info" title="Always has every permission.">
            <Lock className="mr-1 inline size-3.5" aria-hidden />
            The super admin role is fixed and read-only. The account is set up through server environment variables.
          </Alert>
        </div>
      )}

      <div className="flex flex-col gap-6 px-5 py-5">
        {PERMISSION_GROUPS.map((group) => {
          const keys = group.items.map((i) => i[0] as string);
          const allOn = keys.every((k) => on.has(k));
          return (
            <fieldset key={group.module} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <legend className="font-display text-[15px] font-semibold text-ink">
                  {group.module} <span className="ml-1 text-xs font-medium text-muted tabular">{keys.filter((k) => on.has(k)).length}/{keys.length}</span>
                </legend>
                {!readOnly && (
                  <Button variant="ghost" size="sm" onClick={() => setGroup(keys, !allOn)}>
                    {allOn ? "Clear all" : "Select all"}
                  </Button>
                )}
              </div>
              <div className="grid gap-x-6 @xl:grid-cols-2">
                {group.items.map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-field">
                    <Checkbox className="mt-0.5" checked={on.has(key)} disabled={readOnly} onChange={() => toggle(key)} />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{label}</span>
                      <span className="block font-mono text-[11px] text-subtle">{key}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>

      <CardFooter className="sticky bottom-0 rounded-b-[14px] bg-white">
        <span className="text-[13px] text-muted">
          {readOnly ? "Read-only" : dirty ? <span className="font-semibold text-warning">Unsaved changes</span> : "Changes take effect immediately and are audited."}
        </span>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {role.system && (
              <ActionButton
                variant="secondary"
                action={() => resetRolePermissions(role.key)}
                confirm={`Reset ${role.name} to its default permissions? Any customisation will be lost.`}
                successMessage="Role reset to defaults"
              >
                Reset to default
              </ActionButton>
            )}
            <Button
              loading={pending}
              disabled={!dirty}
              onClick={() => run(() => saveRolePermissions(role.key, selected), { successMessage: "Permissions saved" })}
            >
              Save role
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
