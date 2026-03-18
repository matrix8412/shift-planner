import "server-only";

import nodemailer from "nodemailer";

import { env } from "@/server/config/env";
import type { NotificationEmailSettings } from "@/server/config/notification-settings";

type SendEmailNotificationInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  settings: NotificationEmailSettings;
};

let transporterCache: nodemailer.Transporter | null = null;

function getEmailTransporter() {
  if (transporterCache) {
    return transporterCache;
  }

  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD.");
  }

  transporterCache = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });

  return transporterCache;
}

export async function sendEmailNotification(input: SendEmailNotificationInput) {
  const transporter = getEmailTransporter();

  await transporter.sendMail({
    from: `"${input.settings.fromName}" <${input.settings.fromEmail}>`,
    to: input.to,
    replyTo: input.settings.replyTo || undefined,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}
