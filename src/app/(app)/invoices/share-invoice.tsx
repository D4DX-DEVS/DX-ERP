"use client";

import { useRef, useState } from "react";
import { Copy, FileDown, Link2, Mail, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { buttonClass, Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { whatsappLink } from "@/app/(app)/staff/_lib/constants";
import { emailInvoice } from "./actions";

export interface ShareInvoiceProps {
  id: string;
  /** Invoice number, e.g. INV0007. */
  label: string;
  /** Signed public link to the PDF (no sign-in needed). */
  shareUrl: string;
  /** Lowest number of days the link stays valid. */
  linkDays: number;
  company: string;
  client: { name: string; contact?: string; email?: string; phone?: string };
  /** Pre-formatted figures for the message. */
  summary: { date: string; total: string; due?: string; balance?: string };
  /** May send it from the company mailbox (invoices.manage), and SMTP is set up. */
  canEmail: boolean;
}

/** Share menu: the device share sheet with the PDF attached, WhatsApp, email (PDF attached) and the public link. */
export function ShareInvoice(props: ShareInvoiceProps) {
  const { id, label, shareUrl, company, client, summary, canEmail } = props;
  const [emailOpen, setEmailOpen] = useState(false);
  // Fetched when the menu is about to open, so the share sheet opens straight from the tap (browsers require a fresh tap).
  const pdf = useRef<Promise<File> | null>(null);
  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([], "x.pdf", { type: "application/pdf" })] });

  const greeting = `Dear ${client.contact || client.name},`;
  const lines = [
    `Please find invoice ${label} dated ${summary.date} for ${summary.total}${summary.due ? `, due on ${summary.due}` : ""}.`,
    summary.balance ? `Balance due: ${summary.balance}.` : "",
  ].filter(Boolean);
  const signOff = `Thank you,\n${company}`;
  const withLink = `${greeting}\n\n${lines.join("\n")}\n\nView or download the invoice: ${shareUrl}\n\n${signOff}`;
  const withAttachment = `${greeting}\n\n${lines.join("\n")}\nThe invoice is attached as a PDF.\n\n${signOff}`;
  const subject = `Invoice ${label} from ${company}`;

  function prefetch() {
    if (!canShareFiles || pdf.current) return;
    pdf.current = fetch(`/api/pdf/invoice/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Could not prepare the PDF");
        return res.blob();
      })
      .then((blob) => new File([blob], `${label}.pdf`, { type: "application/pdf" }));
    pdf.current.catch(() => {
      pdf.current = null;
    });
  }

  async function shareFile() {
    prefetch();
    try {
      const file = await pdf.current!;
      await navigator.share({ files: [file], title: subject, text: withAttachment });
    } catch (error) {
      // Closing the share sheet is not an error.
      if ((error as Error).name !== "AbortError") toast.error((error as Error).message || "Sharing failed");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(`Link copied · works for ${props.linkDays} days without signing in`);
    } catch {
      toast.error("Could not copy the link");
    }
  }

  const whatsapp = `${whatsappLink(client.phone) ?? "https://wa.me/"}?text=${encodeURIComponent(withLink)}`;
  const mailto = `mailto:${encodeURIComponent(client.email ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(withLink)}`;
  const icon = "size-4 text-muted";

  return (
    <>
      <Menu
        label="Share invoice"
        align="end"
        trigger={
          <button type="button" className={buttonClass("secondary")} onPointerDown={prefetch} onFocus={prefetch}>
            <Share2 className="size-4" aria-hidden /> Share
          </button>
        }
        items={[
          canShareFiles && { label: "Share PDF…", icon: <Share2 className={icon} />, onSelect: () => void shareFile() },
          { label: client.phone ? `WhatsApp ${client.phone}` : "WhatsApp", icon: <MessageCircle className={icon} />, href: whatsapp, external: true },
          canEmail
            ? { label: client.email ? `Email ${client.email}` : "Email", icon: <Mail className={icon} />, onSelect: () => setEmailOpen(true) }
            : { label: "Email (opens your mail app)", icon: <Mail className={icon} />, href: mailto, external: true },
          "separator",
          { label: "Copy link", icon: <Copy className={icon} />, onSelect: () => void copyLink() },
          { label: "Open public link", icon: <Link2 className={icon} />, href: shareUrl, external: true },
          { label: "Download PDF", icon: <FileDown className={icon} />, href: `/api/pdf/invoice/${id}`, external: true },
        ]}
      />
      {canEmail && (
        <Dialog open={emailOpen} onOpenChange={setEmailOpen} title={`Email ${label}`} description="Sent from the company mailbox with the invoice PDF attached. Replies come back to you.">
          <ActionForm action={(input) => emailInvoice(id, input)} successMessage="Invoice emailed" onSuccess={() => setEmailOpen(false)}>
            <FormGrid>
              <Field label="To" name="to" required>
                <Input id="to" name="to" type="email" defaultValue={client.email} autoComplete="off" />
              </Field>
              <Field label="Cc" name="cc">
                <Input id="cc" name="cc" type="email" placeholder="Optional" autoComplete="off" />
              </Field>
            </FormGrid>
            <Field label="Subject" name="subject" required>
              <Input id="subject" name="subject" defaultValue={subject} maxLength={200} />
            </Field>
            <Field label="Message" name="message" required>
              <Textarea id="message" name="message" defaultValue={withAttachment} rows={8} maxLength={5000} />
            </Field>
            <FormActions>
              <Button variant="secondary" onClick={() => setEmailOpen(false)}>
                Cancel
              </Button>
              <SubmitButton icon={<Mail className="size-4" />}>Send email</SubmitButton>
            </FormActions>
          </ActionForm>
        </Dialog>
      )}
    </>
  );
}
