"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/page";
import { statusLabel } from "@/lib/status";
import { findDuplicateSerial, saveAsset } from "./actions";
import { ASSET_CONDITIONS } from "./meta";

export interface AssetFormValues {
  id: string;
  assetNo: string;
  name: string;
  category: string;
  brand?: string;
  model?: string;
  serialNo?: string;
  purchaseDate?: string;
  cost?: number;
  vendor?: string;
  invoiceRef?: string;
  warrantyUntil?: string;
  serviceProvider?: string;
  nextServiceDate?: string;
  department?: string;
  location?: string;
  condition: string;
  notes?: string;
  documents: UploadedFile[];
}

export function AssetForm({
  asset,
  categories,
  departments,
  storageConfigured,
}: {
  asset?: AssetFormValues;
  categories: string[];
  departments: { id: string; name: string }[];
  storageConfigured: boolean;
}) {
  const router = useRouter();
  const [duplicates, setDuplicates] = useState<{ id: string; assetNo: string; name: string }[]>([]);
  // A legacy category that has since been removed from the list stays selectable while editing.
  const categoryOptions = asset && !categories.includes(asset.category) ? [asset.category, ...categories] : categories;

  async function checkSerial(value: string) {
    if (!value.trim()) {
      setDuplicates([]);
      return;
    }
    const res = await findDuplicateSerial(value, asset?.id);
    setDuplicates(res.ok ? res.data : []);
  }

  return (
    <Card>
      <CardBody className="pt-5">
        <ActionForm
          action={saveAsset}
          values={asset ? { id: asset.id } : undefined}
          successMessage={asset ? "Asset updated" : "Asset added"}
          onSuccess={(r) => {
            if (r.duplicates.length > 0) toast.warning(`Saved, but the serial number matches ${r.duplicates.join(", ")}.`);
            router.push(`/assets/${r.id}`);
          }}
        >
          <FormSection title="Asset" description={asset ? `${asset.assetNo}` : "The asset number (AST-0001, …) is generated when you save."}>
            <FormGrid>
              <Field label="Name" name="name" required className="sm:col-span-2">
                <Input id="name" name="name" defaultValue={asset?.name} maxLength={200} placeholder='e.g. MacBook Air 13" M3' />
              </Field>
              <Field label="Category" name="category" required>
                <Select id="category" name="category" defaultValue={asset?.category ?? ""}>
                  <option value="" disabled>
                    Select category
                  </option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Condition" name="condition" required>
                <Select id="condition" name="condition" defaultValue={asset?.condition ?? "new"}>
                  {ASSET_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {statusLabel("assetCondition", c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Brand" name="brand">
                <Input id="brand" name="brand" defaultValue={asset?.brand} maxLength={100} />
              </Field>
              <Field label="Model" name="model">
                <Input id="model" name="model" defaultValue={asset?.model} maxLength={100} />
              </Field>
              <Field label="Serial number" name="serialNo" className="sm:col-span-2" hint="Printed on the device or its box. Used to spot duplicates.">
                <Input id="serialNo" name="serialNo" defaultValue={asset?.serialNo} maxLength={100} className="font-mono" onBlur={(e) => void checkSerial(e.target.value)} />
                {duplicates.length > 0 && (
                  <Alert tone="warning" className="mt-2">
                    This serial number is already recorded on {duplicates.map((d) => `${d.assetNo} (${d.name})`).join(", ")}. You can still save, but check it isn&apos;t a duplicate entry.
                  </Alert>
                )}
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Purchase & warranty">
            <FormGrid>
              <Field label="Purchase date" name="purchaseDate">
                <Input id="purchaseDate" name="purchaseDate" type="date" defaultValue={asset?.purchaseDate} />
              </Field>
              <Field label="Cost (₹)" name="cost">
                <Input id="cost" name="cost" type="number" min={0} step="any" defaultValue={asset?.cost || ""} inputMode="decimal" />
              </Field>
              <Field label="Vendor" name="vendor">
                <Input id="vendor" name="vendor" defaultValue={asset?.vendor} maxLength={150} />
              </Field>
              <Field label="Invoice reference" name="invoiceRef">
                <Input id="invoiceRef" name="invoiceRef" defaultValue={asset?.invoiceRef} maxLength={100} />
              </Field>
              <Field label="Warranty until" name="warrantyUntil" hint="A reminder goes to asset managers 30 days before.">
                <Input id="warrantyUntil" name="warrantyUntil" type="date" defaultValue={asset?.warrantyUntil} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Service">
            <FormGrid>
              <Field label="Service provider" name="serviceProvider">
                <Input id="serviceProvider" name="serviceProvider" defaultValue={asset?.serviceProvider} maxLength={150} />
              </Field>
              <Field label="Next service date" name="nextServiceDate" hint="A reminder goes to asset managers a week before.">
                <Input id="nextServiceDate" name="nextServiceDate" type="date" defaultValue={asset?.nextServiceDate} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Location">
            <FormGrid>
              <Field label="Department" name="department">
                <Select id="department" name="department" defaultValue={asset?.department ?? ""}>
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location" name="location" hint="Office, floor, desk or store room.">
                <Input id="location" name="location" defaultValue={asset?.location} maxLength={150} />
              </Field>
              <Field label="Notes" name="notes" className="sm:col-span-2">
                <Textarea id="notes" name="notes" defaultValue={asset?.notes} rows={3} maxLength={2000} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Documents" description="Invoice, warranty card, licence keys or photos.">
            {storageConfigured ? (
              <FileUpload name="documents" context={{ entityType: "asset", entityId: asset?.id }} initial={asset?.documents} />
            ) : (
              <Alert tone="warning">File storage is not configured, so documents can&apos;t be uploaded.</Alert>
            )}
          </FormSection>

          <FormActions>
            <ButtonLink href={asset ? `/assets/${asset.id}` : "/assets"} variant="secondary">
              Cancel
            </ButtonLink>
            <SubmitButton>{asset ? "Save changes" : "Add asset"}</SubmitButton>
          </FormActions>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
