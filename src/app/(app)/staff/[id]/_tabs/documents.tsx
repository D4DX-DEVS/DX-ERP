import { can } from "@/lib/auth/session";
import { categoriesFor } from "../../_lib/documents";
import { loadDocuments } from "../../_lib/documents-data";
import { DocumentsPanel } from "../../_components/documents-panel";
import type { TabProps } from "./types";

export async function DocumentsTab({ user, person, access, settings, today }: TabProps) {
  const manage = access.canEdit || (access.internLike && can(user, "interns.manage"));
  const seeConfidential = access.canConfidential || access.isSelf;
  const data = await loadDocuments({ personId: person._id.toString(), personType: person.personType, includeConfidential: seeConfidential, settings, today });
  return (
    <DocumentsPanel
      personId={person._id.toString()}
      categories={categoriesFor(settings.documentCategories, person.personType)}
      data={data}
      perms={{ upload: manage || access.isSelf, manage, self: access.isSelf, seeConfidential }}
    />
  );
}
