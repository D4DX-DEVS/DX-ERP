import "server-only";
import { connectDB } from "@/lib/db";
import { StoredFile } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { titleCase } from "@/lib/format";
import { expiryInfo, missingRequired, type ExpiryInfo } from "./documents";

export interface DocVersion {
  id: string;
  name: string;
  version: number;
  uploadedAt: string;
  uploadedByName?: string;
}

export interface DocView {
  id: string;
  name: string;
  size: number;
  category: string;
  categoryLabel: string;
  confidential: boolean;
  expiryDate?: string;
  expiry: ExpiryInfo;
  version: number;
  uploadedAt: string;
  uploadedByName?: string;
  notes?: string;
  versions: DocVersion[];
}

export interface DocumentsData {
  docs: DocView[];
  /** Required categories with no current document (computed over *all* files, including confidential ones). */
  missing: { key: string; label: string }[];
}

/**
 * Current documents of a person, grouped by category order, with version chains.
 * `includeConfidential` must be true only for staff.confidential holders or the person themself.
 */
export async function loadDocuments(opts: {
  personId: string;
  personType: string;
  includeConfidential: boolean;
  settings: AppSettings;
  today: string;
}): Promise<DocumentsData> {
  await connectDB();
  const files = await StoredFile.find({
    entityType: "user",
    entityId: opts.personId,
    deletedAt: null,
    category: { $nin: [null, ""] },
  })
    .sort({ createdAt: -1 })
    .lean();

  const byId = new Map(files.map((f) => [f._id.toString(), f]));
  const heads = files.filter((f) => !f.replacedBy);
  const categories = opts.settings.documentCategories;
  const present = new Set(heads.map((f) => f.category!));
  const missing = missingRequired(categories, opts.personType, present).map((c) => ({ key: c.key, label: c.label }));

  const order = new Map(categories.map((c, i) => [c.key, i]));
  const labels = new Map(categories.map((c) => [c.key, c.label]));

  const docs: DocView[] = heads
    .filter((f) => opts.includeConfidential || !f.confidential)
    .map((f) => {
      const versions: DocVersion[] = [];
      let cursor = f.replaces ? byId.get(f.replaces.toString()) : undefined;
      let guard = 0;
      while (cursor && guard++ < 50) {
        versions.push({
          id: cursor._id.toString(),
          name: cursor.name,
          version: cursor.version,
          uploadedAt: cursor.createdAt.toISOString(),
          uploadedByName: cursor.uploadedByName,
        });
        cursor = cursor.replaces ? byId.get(cursor.replaces.toString()) : undefined;
      }
      return {
        id: f._id.toString(),
        name: f.name,
        size: f.size,
        category: f.category!,
        categoryLabel: labels.get(f.category!) ?? titleCase(f.category),
        confidential: f.confidential,
        expiryDate: f.expiryDate,
        expiry: expiryInfo(f.expiryDate, opts.today),
        version: f.version,
        uploadedAt: f.createdAt.toISOString(),
        uploadedByName: f.uploadedByName,
        notes: f.notes,
        versions,
      };
    })
    .sort((a, b) => (order.get(a.category) ?? 999) - (order.get(b.category) ?? 999) || b.uploadedAt.localeCompare(a.uploadedAt));

  return { docs, missing };
}
