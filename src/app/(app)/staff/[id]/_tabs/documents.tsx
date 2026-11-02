import { can } from "@/lib/auth/session";
import { firstName } from "../../_lib/constants";
import { categoriesFor } from "../../_lib/documents";
import { loadDocuments } from "../../_lib/documents-data";
import { loadEducation } from "../../_lib/education-data";
import { DocumentsPanel } from "../../_components/documents-panel";
import { EducationPanel } from "../../_components/education-panel";
import type { TabProps } from "./types";

export async function DocumentsTab({ user, person, access, settings, today }: TabProps) {
  const manage = access.canEdit || (access.internLike && can(user, "interns.manage"));
  const seeConfidential = access.canConfidential || access.isSelf;
  const [data, education] = await Promise.all([
    loadDocuments({ personId: person._id, personType: person.personType, includeConfidential: seeConfidential, settings, today }),
    loadEducation(person._id, user.id),
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
    </div>
  );
}
