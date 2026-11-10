import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtp.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
    });
  }
  return transporter;
}

export interface MailMessage {
  to: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/** Sends an email when SMTP is configured; silently skipped otherwise. */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!env.smtp.configured) return;
  try {
    await deliverMail(message);
  } catch (error) {
    console.error("[mail] send failed", error);
  }
}

/** Sends an email someone is waiting for: throws when SMTP is not configured or the mail server refuses it. */
export async function deliverMail(message: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) throw new Error("Email is not configured on the server.");
  await t.sendMail({ from: env.smtp.from, ...message });
}
