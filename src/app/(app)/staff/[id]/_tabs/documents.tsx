import { can } from "@/lib/auth/session";
import { firstName } from "../../_lib/constants";
import { categoriesFor } from "../../_lib/documents";
import { selfBankEditable } from "../../_lib/bank";
import { loadBankAccounts } from "../../_lib/bank-data";
import { loadDocuments } from "../../_lib/documents-data";
import { loadEducation } from "../../_lib/education-data";
import { BankPanel } from "../../_components/bank-panel";
import { DocumentsPanel } from "../../_components/documents-panel";
import { EducationPanel } from "../../_components/education-panel";
import type { TabProps } from "./types";

export async function DocumentsTab({ user, person, access, settings, today }: TabProps) {
  const manage = access.canEdit || (access.internLike && can(user, "interns.manage"));
  const seeConfidential = access.canConfidential || access.isSelf;
  // Bank details are confidential: listed to the person and staff.confidential holders; changed by HR with both rights,
  // or by the person when the bank category is open to them (same rule as bank-actions.ts).
  const bankEdit = (manage && access.canConfidential) || (access.isSelf && selfBankEditable(settings.documentCategories, person.documentUploadOpen));
  const [data, education, bank] = await Promise.all([
    loadDocuments({ personId: person._id, personType: person.personType, includeConfidential: seeConfidential, settings, today }),
    loadEducation(person._id, user.id),
    seeConfidential ? loadBankAccounts(person._id, user.id) : undefined,
  ]);
  return (
    <div className="flex flex-col gap-4">
      <DocumentsPanel
        personId={person._id}
        categories={categoriesFor(settings.documentCategories, person.personType)}
        data={data}
        perms={{ upload: manage || access.isSelf, manage, self: access.isSelf, seeConfidential, restrictedUpload: manage || (access.isSelf && person.documentUploadOpen) }}
        access={manage && !access.isSelf ? { name: firstName(person.name), open: person.documentUploadOpen } : undefined}
      />
      <EducationPanel personId={person._id} records={education} canEdit={manage || access.isSelf} manage={manage} />
      {bank && (
        <BankPanel
          personId={person._id}
          holderName={person.name}
          accounts={bank}
          canEdit={bankEdit}
          manage={manage && access.canConfidential}
          lockedNote={access.isSelf ? "Bank details are restricted — HR adds them, or opens document upload so you can add them yourself." : "Only HR can change bank details."}
        />
      )}
    </div>
  );
}
