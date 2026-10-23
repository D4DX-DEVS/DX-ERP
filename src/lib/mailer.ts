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

/** Sends an email when SMTP is configured; silently skipped otherwise. */
export async function sendMail(message: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const t = getTransporter();
  if (!t) return;
  try {
    await t.sendMail({ from: env.smtp.from, ...message });
  } catch (error) {
    console.error("[mail] send failed", error);
  }
}
