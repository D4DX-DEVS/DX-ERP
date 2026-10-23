"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/ui/form";
import { Select } from "@/components/ui/input";
import { changeRole, deletePerson, setLoginAccess } from "../[id]/actions";

export function LoginAccessButton({ userId, enabled, name }: { userId: string; enabled: boolean; name: string }) {
  return enabled ? (
    <ActionButton variant="danger-outline" action={() => setLoginAccess(userId, false)} confirm={`${name} will be signed out everywhere and will no longer be able to sign in.`} successMessage="Login access disabled">
      Disable login access
    </ActionButton>
  ) : (
    <ActionButton action={() => setLoginAccess(userId, true)} successMessage="Login access enabled">
      Enable login access
    </ActionButton>
  );
}

export function RoleForm({ userId, role, roles }: { userId: string; role: string; roles: { key: string; name: string }[] }) {
  return (
    <ActionForm action={(input) => changeRole(userId, String(input.role ?? ""))} successMessage="Role updated" className="gap-3">
      <Field label="Role" name="role" hint="Changing the role signs the person out so the new permissions apply on the next sign-in.">
        <Select id="role" name="role" defaultValue={role}>
          {!roles.some((r) => r.key === role) && <option value={role}>{role}</option>}
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <FormActions className="justify-start">
        <SubmitButton>Change role</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

export function DeletePersonButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  return (
    <ActionButton
      variant="danger-outline"
      icon={<Trash2 className="size-4 sm:hidden" aria-hidden />}
      className="max-sm:w-9 max-sm:px-0"
      action={() => deletePerson(userId)}
      confirm={`Permanently delete ${name}? This is only possible when no attendance, tasks, leave, payslips or other records are linked. This cannot be undone.`}
      confirmTitle="Delete?"
      confirmLabel="Delete"
      successMessage="Person deleted"
      onSuccess={() => router.push("/staff")}
    >
      <span className="max-sm:sr-only">Delete</span>
    </ActionButton>
  );
}
