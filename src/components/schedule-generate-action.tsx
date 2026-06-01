"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import { useBrowserNotifications } from "@/components/browser-notification-provider";
import type { ActionState } from "@/components/entity-module.types";
import { FormSubmitButton } from "@/components/form-submit-button";
import { useI18n } from "@/i18n/context";

const initialState: ActionState = {
  status: "idle",
};

type ScheduleGenerateActionProps = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  disabledReason?: string;
  provider: "openai" | "anthropic" | "gemini";
  initialMonth?: string;
};

function getMonthRange(initialMonth?: string) {
  const fallbackDate = new Date();
  const [year, month] = (initialMonth ?? `${fallbackDate.getUTCFullYear()}-${String(fallbackDate.getUTCMonth() + 1).padStart(2, "0")}`)
    .split("-")
    .map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0));

  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
}

export function ScheduleGenerateAction({ action, disabledReason, provider, initialMonth }: ScheduleGenerateActionProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { notify } = useBrowserNotifications();
  const [state, formAction] = useActionState(action, initialState);
  const [isOpen, setIsOpen] = useState(false);
  const initialRange = useMemo(() => getMonthRange(initialMonth), [initialMonth]);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [fairnessLookbackDays, setFairnessLookbackDays] = useState(14);

  useEffect(() => {
    setStartDate(initialRange.startDate);
    setEndDate(initialRange.endDate);
  }, [initialRange.endDate, initialRange.startDate]);

  useEffect(() => {
    if (state.status === "success" && state.message) {
      notify({
        tone: "success",
        title: t("schedGen.toastTitle"),
        message: state.message,
      });
      setIsOpen(false);
      router.refresh();
    }
  }, [notify, router, state.message, state.status]);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      notify({
        tone: "error",
        title: t("schedGen.toastTitle"),
        message: state.message,
      });
    }
  }, [notify, state.message, state.status]);

  return (
    <>
      <button
        type="button"
        className="button action-main"
        onClick={() => setIsOpen(true)}
        disabled={Boolean(disabledReason)}
        title={disabledReason}
      >
        <Sparkles size={18} />
        {t("schedGen.button")}
      </button>

      {isOpen ? (
        <div className="sheet-layer" role="presentation">
          <button type="button" className="sheet-backdrop" aria-label={t("schedGen.closeAria")} onClick={() => setIsOpen(false)} />
          <section className="sheet-panel schedule-generation-sheet" aria-modal="true" role="dialog" aria-labelledby="schedule-generation-title">
            <div className="sheet-header">
              <div className="stack-tight">
                <p className="eyebrow">{t("schedGen.eyebrow")}</p>
                <h2 id="schedule-generation-title">{t("schedGen.heading")}</h2>
                <p className="muted">
                  {t("schedGen.providerNote", { provider: provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "Google Gemini" })}
                </p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setIsOpen(false)} aria-label={t("schedGen.closeAria")}>
                {t("schedGen.close")}
              </button>
            </div>

            <div className="settings-overview-grid schedule-generation-overview">
              <article className="settings-overview-card">
                <span className="muted small-text">{t("schedGen.range")}</span>
                <strong>{t("schedGen.rangeValue", { start: startDate, end: endDate })}</strong>
              </article>
              <article className="settings-overview-card">
                <span className="muted small-text">{t("schedGen.onSave")}</span>
                <strong>{t("schedGen.onSaveValue")}</strong>
              </article>
              <article className="settings-overview-card">
                <span className="muted small-text">{t("schedGen.lockedRecords")}</span>
                <strong>{t("schedGen.lockedRecordsValue")}</strong>
              </article>
              <article className="settings-overview-card">
                <span className="muted small-text">{t("schedGen.fairnessHistory")}</span>
                <strong>{t("schedGen.fairnessValue", { days: String(fairnessLookbackDays) })}</strong>
              </article>
            </div>

            <form action={formAction} className="stack">
              <div className="settings-grid">
                <label className="field">
                  <span className="field-label">{t("schedGen.dateFrom")}</span>
                  <input type="date" name="startDate" className="field-control" value={startDate} onChange={(event) => setStartDate(event.currentTarget.value)} />
                  {state.fieldErrors?.startDate?.[0] ? <span className="field-error">{state.fieldErrors.startDate[0]}</span> : null}
                </label>

                <label className="field">
                  <span className="field-label">{t("schedGen.dateTo")}</span>
                  <input type="date" name="endDate" className="field-control" value={endDate} onChange={(event) => setEndDate(event.currentTarget.value)} />
                  {state.fieldErrors?.endDate?.[0] ? <span className="field-error">{state.fieldErrors.endDate[0]}</span> : null}
                </label>

                <label className="field">
                  <span className="field-label">{t("schedGen.lookbackDays")}</span>
                  <input
                    type="number"
                    name="fairnessLookbackDays"
                    min="0"
                    max="90"
                    step="1"
                    className="field-control"
                    value={fairnessLookbackDays}
                    onChange={(event) => setFairnessLookbackDays(Number(event.currentTarget.value))}
                  />
                  <span className="field-description">{t("schedGen.lookbackHint")}</span>
                  {state.fieldErrors?.fairnessLookbackDays?.[0] ? <span className="field-error">{state.fieldErrors.fairnessLookbackDays[0]}</span> : null}
                </label>
              </div>

              <div className="settings-note">
                <p className="muted">
                  {t("schedGen.note")}
                </p>
              </div>

              {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
              {state.status === "success" && state.message ? <p className="form-success">{state.message}</p> : null}

              <div className="confirm-actions">
                <button type="button" className="button secondary" onClick={() => setIsOpen(false)}>
                  {t("schedGen.close")}
                </button>
                <FormSubmitButton label={t("schedGen.submit")} />
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
