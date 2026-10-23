"use client";

import { Field, FormGrid, FormSection } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { RELATIONS } from "../_lib/constants";

export interface PersonalDefaults {
  phone?: string;
  personalEmail?: string;
  addrLine1?: string;
  addrLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  emergencyName?: string;
  emergencyRelation?: string;
  emergencyPhone?: string;
}

/** Contact, address and emergency-contact inputs shared by the staff edit form, the profile section dialogs and /profile. */
export function PersonalFields({ defaults, withPhone = true }: { defaults: PersonalDefaults; withPhone?: boolean }) {
  return (
    <>
      <FormSection title="Contact">
        <FormGrid>
          {withPhone && (
            <Field label="Phone" name="phone">
              <Input id="phone" name="phone" type="tel" inputMode="tel" maxLength={30} defaultValue={defaults.phone ?? ""} />
            </Field>
          )}
          <Field label="Personal email" name="personalEmail">
            <Input id="personalEmail" name="personalEmail" type="email" inputMode="email" defaultValue={defaults.personalEmail ?? ""} />
          </Field>
        </FormGrid>
      </FormSection>
      <FormSection title="Address">
        <FormGrid>
          <Field label="Address line 1" name="addrLine1" className="sm:col-span-2">
            <Input id="addrLine1" name="addrLine1" maxLength={150} defaultValue={defaults.addrLine1 ?? ""} />
          </Field>
          <Field label="Address line 2" name="addrLine2" className="sm:col-span-2">
            <Input id="addrLine2" name="addrLine2" maxLength={150} defaultValue={defaults.addrLine2 ?? ""} />
          </Field>
          <Field label="City" name="city">
            <Input id="city" name="city" maxLength={80} defaultValue={defaults.city ?? ""} />
          </Field>
          <Field label="State" name="state">
            <Input id="state" name="state" maxLength={80} defaultValue={defaults.state ?? ""} />
          </Field>
          <Field label="Postal code" name="postalCode">
            <Input id="postalCode" name="postalCode" maxLength={20} defaultValue={defaults.postalCode ?? ""} />
          </Field>
          <Field label="Country" name="country">
            <Input id="country" name="country" maxLength={80} defaultValue={defaults.country ?? ""} />
          </Field>
        </FormGrid>
      </FormSection>
      <FormSection title="Emergency contact">
        <FormGrid cols={3}>
          <Field label="Name" name="emergencyName">
            <Input id="emergencyName" name="emergencyName" maxLength={100} defaultValue={defaults.emergencyName ?? ""} />
          </Field>
          <Field label="Relation" name="emergencyRelation">
            <Select id="emergencyRelation" name="emergencyRelation" defaultValue={defaults.emergencyRelation ?? ""}>
              <option value="">—</option>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              {defaults.emergencyRelation && !RELATIONS.includes(defaults.emergencyRelation) && <option value={defaults.emergencyRelation}>{defaults.emergencyRelation}</option>}
            </Select>
          </Field>
          <Field label="Phone" name="emergencyPhone">
            <Input id="emergencyPhone" name="emergencyPhone" type="tel" inputMode="tel" maxLength={30} defaultValue={defaults.emergencyPhone ?? ""} />
          </Field>
        </FormGrid>
      </FormSection>
    </>
  );
}
