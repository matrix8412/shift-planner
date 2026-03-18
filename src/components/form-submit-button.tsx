"use client";

import { useFormStatus } from "react-dom";

import { useI18n } from "@/i18n/context";

type FormSubmitButtonProps = {
  label: string;
};

export function FormSubmitButton({ label }: FormSubmitButtonProps) {
  const { pending } = useFormStatus();
  const { t } = useI18n();

  return (
    <button type="submit" className="button" disabled={pending}>
      {pending ? t("entity.saving") : label}
    </button>
  );
}
