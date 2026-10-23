"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm, FormActions, SubmitButton } from "@/components/ui/form";
import { PersonalFields, type PersonalDefaults } from "../staff/_components/personal-fields";
import { updateMyProfile } from "./actions";

export function ProfileForm({ defaults }: { defaults: PersonalDefaults }) {
  return (
    <Card>
      <CardHeader title="My details" subtitle="Contact, address and emergency contact. HR maintains the rest of your record." />
      <CardBody>
        <ActionForm action={updateMyProfile} successMessage="Profile saved" className="gap-6">
          <PersonalFields defaults={defaults} />
          <FormActions className="border-t border-line-soft pt-4">
            <SubmitButton>Save changes</SubmitButton>
          </FormActions>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
