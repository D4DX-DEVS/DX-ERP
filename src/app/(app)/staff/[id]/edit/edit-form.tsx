"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { updatePerson } from "../../actions";
import { PersonalFields, type PersonalDefaults } from "../../_components/personal-fields";
import { BLOOD_GROUPS, EMPLOYMENT_TYPE_OPTIONS, GENDER_OPTIONS } from "../../_lib/constants";

export interface EditablePerson extends PersonalDefaults {
  id: string;
  name: string;
  email: string;
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  employmentType: string;
  team?: string;
  joiningDate?: string;
  internship?: { startDate?: string; endDate?: string; college?: string; course?: string; assignedRole?: string; mentor?: string };
}

export function EditPersonForm({
  person,
  internLike,
  canEmail,
  people,
  today,
}: {
  person: EditablePerson;
  internLike: boolean;
  canEmail: boolean;
  people: PickerOption[];
  today: string;
}) {
  const router = useRouter();
  const back = `/staff/${person.id}`;
  return (
    <Card>
      <CardBody className="pt-5">
        <ActionForm action={updatePerson} values={{ userId: person.id }} successMessage="Details saved" onSuccess={() => router.push(back)} className="gap-6">
          <FormSection title="Identity" description="Designation, department, reporting manager and status change through lifecycle actions so the history stays complete.">
            <FormGrid>
              <Field label="Full name" name="name" required>
                <Input id="name" name="name" maxLength={120} defaultValue={person.name} />
              </Field>
              <Field label="Work email" name="email" hint={canEmail ? "Changing it signs the person out and re-links Google sign-in" : "Only users who manage access can change this"}>
                <Input id="email" name="email" type="email" inputMode="email" defaultValue={person.email} readOnly={!canEmail} />
              </Field>
              <Field label="Date of birth" name="dob">
                <Input id="dob" name="dob" type="date" max={today} defaultValue={person.dob ?? ""} />
              </Field>
              <FormGrid cols={1} className="sm:grid-cols-2">
                <Field label="Gender" name="gender">
                  <Select id="gender" name="gender" defaultValue={person.gender ?? ""}>
                    <option value="">—</option>
                    {GENDER_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Blood group" name="bloodGroup">
                  <Select id="bloodGroup" name="bloodGroup" defaultValue={person.bloodGroup ?? ""}>
                    <option value="">—</option>
                    {BLOOD_GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FormGrid>
            </FormGrid>
          </FormSection>

          <PersonalFields defaults={person} />

          <FormSection title="Employment">
            <FormGrid>
              <Field label="Employment type" name="employmentType">
                <Select id="employmentType" name="employmentType" defaultValue={person.employmentType}>
                  {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Joining date" name="joiningDate" required>
                <Input id="joiningDate" name="joiningDate" type="date" defaultValue={person.joiningDate ?? ""} />
              </Field>
              <Field label="Team" name="team">
                <Input id="team" name="team" maxLength={80} defaultValue={person.team ?? ""} />
              </Field>
            </FormGrid>
          </FormSection>

          {internLike && (
            <FormSection title="Internship">
              <FormGrid>
                <Field label="Start date" name="internStartDate">
                  <Input id="internStartDate" name="internStartDate" type="date" defaultValue={person.internship?.startDate ?? ""} />
                </Field>
                <Field label="Expected end date" name="internEndDate" hint="To extend an internship use Completion → Extend on the internship page">
                  <Input id="internEndDate" name="internEndDate" type="date" defaultValue={person.internship?.endDate ?? ""} />
                </Field>
                <Field label="College / institution" name="college">
                  <Input id="college" name="college" maxLength={150} defaultValue={person.internship?.college ?? ""} />
                </Field>
                <Field label="Course" name="course">
                  <Input id="course" name="course" maxLength={150} defaultValue={person.internship?.course ?? ""} />
                </Field>
                <Field label="Assigned role" name="assignedRole">
                  <Input id="assignedRole" name="assignedRole" maxLength={100} defaultValue={person.internship?.assignedRole ?? ""} />
                </Field>
                <Field label="Mentor" name="mentor">
                  <PeoplePicker name="mentor" options={people.filter((p) => p.id !== person.id)} defaultValue={person.internship?.mentor} placeholder="Select mentor" />
                </Field>
              </FormGrid>
            </FormSection>
          )}

          <FormActions className="border-t border-line-soft pt-4">
            <Button variant="secondary" onClick={() => router.push(back)}>
              Cancel
            </Button>
            <SubmitButton>Save changes</SubmitButton>
          </FormActions>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
