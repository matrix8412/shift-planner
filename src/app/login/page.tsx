"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import Link from "next/link";

import { loginAction, type AuthActionState } from "@/server/actions/auth";

import { LoginSubmitButton } from "./login-submit-button";
import { useI18n } from "@/i18n/context";

const initialState: AuthActionState = {};

export default function LoginPage() {
  const [state, formAction] = useActionState(loginAction, initialState);
  const { t } = useI18n();

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">
            <KeyRound size={28} />
          </div>
          <h1>{t("auth.loginTitle")}</h1>
          <p className="muted">{t("auth.loginDescription")}</p>
        </div>

        <form action={formAction} className="login-form">
          {state.error && <div className="form-error">{state.error}</div>}

          <div className="field">
            <label className="field-label" htmlFor="email">
              {t("auth.email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="field-control"
              placeholder={t("auth.emailPlaceholder")}
            />
            {state.fieldErrors?.email && <span className="field-error">{state.fieldErrors.email}</span>}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="password">
              {t("auth.password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="field-control"
              placeholder={t("auth.passwordPlaceholder")}
            />
            {state.fieldErrors?.password && <span className="field-error">{state.fieldErrors.password}</span>}
          </div>

          <LoginSubmitButton />

          <div className="login-footer">
            <Link href="/login/forgot-password" className="login-link">
              {t("auth.forgotPassword")}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

