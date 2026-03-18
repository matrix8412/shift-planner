"use client";

import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { resetPasswordAction, type AuthActionState } from "@/server/actions/auth";

import { LoginSubmitButton } from "../login-submit-button";
import { useI18n } from "@/i18n/context";

const initialState: AuthActionState = {};

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, formAction] = useActionState(resetPasswordAction, initialState);
  const { t } = useI18n();

  if (!token) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-header">
            <div className="login-icon">
              <ShieldCheck size={28} />
            </div>
            <h1>{t("auth.resetInvalidLink")}</h1>
            <p className="muted">{t("auth.resetInvalidDescription")}</p>
          </div>
          <div className="login-footer" style={{ textAlign: "center" }}>
            <Link href="/login/forgot-password" className="login-link">
              {t("auth.resetRequestNew")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">
            <ShieldCheck size={28} />
          </div>
          <h1>{t("auth.resetTitle")}</h1>
          <p className="muted">{t("auth.resetDescription")}</p>
        </div>

        <form action={formAction} className="login-form">
          <input type="hidden" name="token" value={token} />

          {state.error && <div className="form-error">{state.error}</div>}
          {state.success && <div className="form-success">{state.success}</div>}

          {!state.success && (
            <>
              <div className="field">
                <label className="field-label" htmlFor="password">
                  {t("auth.newPassword")}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="field-control"
                  placeholder={t("auth.newPasswordHint")}
                />
                {state.fieldErrors?.password && <span className="field-error">{state.fieldErrors.password}</span>}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="passwordConfirm">
                  {t("auth.confirmPassword")}
                </label>
                <input
                  id="passwordConfirm"
                  name="passwordConfirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="field-control"
                  placeholder={t("auth.confirmPasswordPlaceholder")}
                />
                {state.fieldErrors?.passwordConfirm && <span className="field-error">{state.fieldErrors.passwordConfirm}</span>}
              </div>

              <LoginSubmitButton label={t("auth.setPassword")} pendingLabel={t("auth.settingPassword")} />
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

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
