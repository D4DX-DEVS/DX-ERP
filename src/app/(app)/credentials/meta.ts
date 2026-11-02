/** Client-safe labels for credential storage. Keys match CREDENTIAL_CATEGORIES in the models. */
export const CREDENTIAL_CATEGORY_LABELS: Record<string, string> = {
  social: "Social media",
  email: "Email",
  hosting: "Hosting & servers",
  domain: "Domains & DNS",
  software: "Software & SaaS",
  banking: "Banking & payments",
  government: "Government & tax",
  vendor: "Vendors & suppliers",
  other: "Other",
};

export const CREDENTIAL_CATEGORY_OPTIONS = Object.entries(CREDENTIAL_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

export const CREDENTIAL_EVENT_LABELS: Record<string, string> = {
  create: "Added",
  update: "Edited",
  delete: "Deleted",
  reveal: "Revealed",
  copy: "Copied",
  edit_open: "Opened for editing",
};
