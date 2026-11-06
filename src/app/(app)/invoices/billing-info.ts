import type { AppSettings } from "@/lib/config-defaults";

/**
 * Supplier GST and bank details printed on tax invoices (Configuration → GST & bank details).
 * Invoices with no tax on any line leave them out. Pure — shared by the form, the invoice page and the PDF.
 */
export interface BillingInfo {
  gst: [string, string][];
  bank: [string, string][];
  /** Free-text payment details printed under the bank account. */
  note: string;
}

export function billingInfo(settings: Pick<AppSettings, "company" | "bank" | "documents">): BillingInfo {
  const { company, bank } = settings;
  const rows = (pairs: [string, string][]) => pairs.filter(([, v]) => v);
  return {
    // The first two digits of a GSTIN are the state code.
    gst: rows([
      ["GSTIN", company.gstin],
      ["PAN", company.pan],
      ["State code", company.gstin.slice(0, 2)],
    ]),
    bank: rows([
      ["Account name", bank.accountName],
      ["Bank", bank.bankName],
      ["Branch", bank.branch],
      ["Account no.", bank.accountNumber],
      ["IFSC", bank.ifsc],
      ["UPI ID", bank.upiId],
    ]),
    note: settings.documents.bankDetails,
  };
}
