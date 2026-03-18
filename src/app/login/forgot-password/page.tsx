"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import Link from "next/link";

import { forgotPasswordAction, type AuthActionState } from "@/server/actions/auth";

import { LoginSubmitButton } from "../login-submit-button";
import { useI18n } from "@/i18n/context";

const initialState: AuthActionState = {};

export default function ForgotPasswordPage() {
  const [state, formAction] = useActionState(forgotPasswordAction, initialState);
  const { t } = useI18n();

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">
            <Mail size={28} />
          </div>
          <h1>{t("auth.forgotTitle")}</h1>
          <p className="muted">{t("auth.forgotDescription")}</p>
        </div>

        <form action={formAction} className="login-form">
          {state.error && <div className="form-error">{state.error}</div>}
          {state.success && <div className="form-success">{state.success}</div>}

          {!state.success && (
            <>
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

              <LoginSubmitButton label={t("auth.sendLink")} pendingLabel={t("auth.sendingLink")} />
            </>
          )}

          <div className="login-footer">
            <Link href="/login" className="login-link">
              {t("auth.backToLogin")}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
