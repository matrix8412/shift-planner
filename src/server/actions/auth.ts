"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession } from "@/server/auth/session";
import { env } from "@/server/config/env";
import { getNotificationSettings } from "@/server/config/notification-settings";
import { db } from "@/server/db/client";
import { sendEmailNotification } from "@/server/notifications/email";
import { getDictionary, t as tr, getServerLocale } from "@/i18n";

const RESET_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

const loginSchema = z.object({
  email: z.string().trim().email("Zadajte platný email."),
  password: z.string().min(1, "Zadajte heslo."),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Zadajte platný email."),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Heslo musí mať aspoň 8 znakov."),
  passwordConfirm: z.string().min(1, "Potvrďte heslo."),
});

export type AuthActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
};

export async function loginAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key && typeof key === "string") {
        fieldErrors[key] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const { email, password } = parsed.data;

  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, isActive: true, passwordHash: true },
  });

  if (!user || !user.isActive || !user.passwordHash) {
    return { error: tr(d, "auth.invalidCredentials") };
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    return { error: tr(d, "auth.invalidCredentials") };
  }

  await createSession(user.id);
  redirect("/");

  // redirect() throws — this line is unreachable but satisfies TypeScript
  return {};
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function forgotPasswordAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);

  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key && typeof key === "string") {
        fieldErrors[key] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const { email } = parsed.data;

  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, isActive: true, firstName: true, lastName: true, email: true },
  });

  // Always return success to prevent email enumeration
  const successMessage = tr(d, "auth.forgotSuccess");

  if (!user || !user.isActive) {
    return { success: successMessage };
  }

  // Invalidate any existing tokens for this user
  await db.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

  await db.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  const resetUrl = `${env.APP_URL}/login/reset-password?token=${token}`;

  try {
    const settings = await getNotificationSettings();

    await sendEmailNotification({
      to: user.email,
      subject: tr(d, "auth.email.subject"),
      html: [
        '<div style="font-family: Segoe UI, Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto;">',
        `<h2 style="color: ${settings.email.accentColor};">${tr(d, "auth.email.heading")}</h2>`,
        `<p>${tr(d, "auth.email.greeting", { name: user.firstName })}</p>`,
        `<p>${tr(d, "auth.email.body")}</p>`,
        `<p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: ${settings.email.accentColor}; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 700;">${tr(d, "auth.email.button")}</a></p>`,
        `<p>${tr(d, "auth.email.expiry")}</p>`,
        `<p style="color: #999; font-size: 0.85em; margin-top: 24px;">${tr(d, "notif.appName")} · ${new Date().getUTCFullYear()}</p>`,
        "</div>",
      ].join(""),
      text: [
        tr(d, "auth.email.heading"),
        "",
        tr(d, "auth.email.greeting", { name: user.firstName }),
        "",
        tr(d, "auth.email.bodyText"),
        "",
        resetUrl,
        "",
        tr(d, "auth.email.expiryText"),
        "",
        `${tr(d, "notif.appName")} · ${new Date().getUTCFullYear()}`,
      ].join("\n"),
      settings: settings.email,
    });
  } catch {
    return { error: tr(d, "auth.forgotEmailError") };
  }

  return { success: successMessage };
}

export async function resetPasswordAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);

  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key && typeof key === "string") {
        fieldErrors[key] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const { token, password, passwordConfirm } = parsed.data;

  if (password !== passwordConfirm) {
    return { fieldErrors: { passwordConfirm: tr(d, "auth.passwordsMismatch") } };
  }

  const resetToken = await db.passwordResetToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, isActive: true } } },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { error: tr(d, "auth.resetExpired") };
  }

  if (!resetToken.user.isActive) {
    return { error: tr(d, "auth.accountDisabled") };
  }

  const passwordHash = await hashPassword(password);

  await db.$transaction([
    db.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    db.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    // Invalidate all existing sessions for this user
    db.session.deleteMany({
      where: { userId: resetToken.userId },
    }),
  ]);

  return { success: tr(d, "auth.resetSuccess") };
}
