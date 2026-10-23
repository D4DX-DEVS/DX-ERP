"use client";

import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Select } from "@/components/ui/input";
import { FormDialog } from "../settings/ui";
import { changeUserRole, setLoginAccess } from "./actions";

/** Change-role dialog and login-access toggle for one person (both sign the person out). */
export function UserActions({
  id,
  name,
  role,
  roleName,
  accountActive,
  roles,
  isSelf,
}: {
  id: string;
  name: string;
  role: string;
  roleName: string;
  accountActive: boolean;
  roles: { key: string; name: string }[];
  isSelf: boolean;
}) {
  if (isSelf) return <span className="text-xs text-muted">You</span>;
  return (
    <div className="flex justify-end gap-1.5">
      <FormDialog
        trigger={
          <Button variant="secondary" size="sm">
            Change role
          </Button>
        }
        title={`Change role for ${name}`}
        description={`Currently ${roleName}. The person is signed out of every device and notified.`}
        action={changeUserRole}
        values={{ id }}
        successMessage="Role updated and sessions revoked"
        submitLabel="Change role"
        size="sm"
      >
        <Field label="New role" name="role" required>
          <Select id="role" name="role" defaultValue={role}>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </FormDialog>
      <ActionButton
        variant={accountActive ? "danger-outline" : "secondary"}
        size="sm"
        action={() => setLoginAccess(id, !accountActive)}
        successMessage={accountActive ? "Login access disabled" : "Login access enabled"}
        confirm={
          accountActive
            ? `Disable login for ${name}? They are signed out everywhere immediately and can't sign in until access is enabled again.`
            : `Enable login for ${name}? They will be able to sign in with their company account.`
        }
      >
        {accountActive ? "Disable login" : "Enable login"}
      </ActionButton>
    </div>
  );
}
