"use client";

import { useFormStatus } from "react-dom";
import { useI18n } from "@/i18n/context";

type LoginSubmitButtonProps = {
  label?: string;
  pendingLabel?: string;
};

export function LoginSubmitButton({ label, pendingLabel }: LoginSubmitButtonProps) {
  const { pending } = useFormStatus();
  const { t } = useI18n();
  const resolvedLabel = label ?? t("auth.loginButton");
  const resolvedPendingLabel = pendingLabel ?? t("auth.loginPending");

  return (
    <button type="submit" className="login-button" disabled={pending}>
      {pending ? resolvedPendingLabel : resolvedLabel}
    </button>
  );
}
