"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useBrowserNotifications } from "@/components/browser-notification-provider";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { ActionState } from "@/components/entity-module.types";
import { useI18n } from "@/i18n/context";
import type { BrowserNotificationSettings } from "@/server/config/browser-notifications";

const initialState: ActionState = {
  status: "idle",
};

type BrowserNotificationSettingsCardProps = {
  settings: BrowserNotificationSettings;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
};

export function BrowserNotificationSettingsCard({ settings, action }: BrowserNotificationSettingsCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { notify } = useBrowserNotifications();
  const [state, formAction] = useActionState(action, initialState);
  const [position, setPosition] = useState(settings.position);
  const [opacityPercent, setOpacityPercent] = useState(Math.round(settings.opacity * 100));

  useEffect(() => {
    if (state.status === "success" && state.message) {
      notify({
        tone: "success",
        title: t("browserNotif.title"),
        message: state.message,
      });
      router.refresh();
    }
  }, [notify, router, state.message, state.status]);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      notify({
        tone: "error",
        title: t("browserNotif.title"),
        message: state.message,
      });
    }
  }, [notify, state.message, state.status]);

  useEffect(() => {
    setPosition(settings.position);
    setOpacityPercent(Math.round(settings.opacity * 100));
  }, [settings.opacity, settings.position]);

  return (
    <section className="card stack">
      <div className="stack-tight">
        <p className="eyebrow">{t("browserNotif.title")}</p>
        <h2>{t("browserNotif.heading")}</h2>
        <p className="muted">{t("browserNotif.description")}</p>
      </div>

      <div className="settings-overview-grid">
        <article className="settings-overview-card">
          <span className="muted small-text">{t("browserNotif.positionLabel")}</span>
          <strong>{position}</strong>
        </article>

        <article className="settings-overview-card">
          <span className="muted small-text">{t("browserNotif.opacityLabel")}</span>
          <strong>{opacityPercent}%</strong>
        </article>

        <article className="settings-overview-card">
          <span className="muted small-text">{t("browserNotif.usage")}</span>
          <strong>{t("browserNotif.usageValue")}</strong>
        </article>
      </div>

      <form action={formAction} className="stack">
        <div className="settings-grid">
          <label className="field">
            <span className="field-label">{t("browserNotif.positionLabel")}</span>
            <select name="position" value={position} className="field-control" onChange={(event) => setPosition(event.currentTarget.value as BrowserNotificationSettings["position"])}>
              <option value="top-right">{t("browserNotif.topRight")}</option>
              <option value="top-left">{t("browserNotif.topLeft")}</option>
              <option value="bottom-right">{t("browserNotif.bottomRight")}</option>
              <option value="bottom-left">{t("browserNotif.bottomLeft")}</option>
            </select>
            <span className="field-description">{t("browserNotif.positionHint")}</span>
            {state.fieldErrors?.position?.[0] ? <span className="field-error">{state.fieldErrors.position[0]}</span> : null}
          </label>

          <label className="field">
            <span className="field-label">{t("browserNotif.opacityLabel")}</span>
            <input
              type="range"
              name="opacityPercent"
              min="35"
              max="100"
              step="1"
              value={opacityPercent}
              onChange={(event) => setOpacityPercent(Number(event.currentTarget.value))}
              className="range-control"
            />
            <span className="field-description">{t("browserNotif.opacityHint", { percent: String(opacityPercent) })}</span>
            {state.fieldErrors?.opacityPercent?.[0] ? <span className="field-error">{state.fieldErrors.opacityPercent[0]}</span> : null}
          </label>
        </div>

        {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
        {state.status === "success" && state.message ? <p className="form-success">{state.message}</p> : null}

        <div className="sheet-actions">
          <FormSubmitButton label={t("browserNotif.save")} />
        </div>
      </form>
    </section>
  );
}
