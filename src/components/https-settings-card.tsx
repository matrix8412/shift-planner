"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useBrowserNotifications } from "@/components/browser-notification-provider";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { ActionState } from "@/components/entity-module.types";
import { useI18n } from "@/i18n/context";

const initialState: ActionState = {
  status: "idle",
};

type HttpsSettingsValue = {
  acmeEmail: string;
  httpPort: number;
  httpsPort: number;
  renewIntervalHours: number;
};

type HttpsSettingsCardProps = {
  settings: HttpsSettingsValue;
  appDomain: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  readOnly?: boolean;
};

export function HttpsSettingsCard({ settings, appDomain, action, readOnly = false }: HttpsSettingsCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { notify } = useBrowserNotifications();
  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success" && state.message) {
      notify({
        tone: "success",
        title: t("https.title"),
        message: state.message,
      });
      router.refresh();
    }
  }, [notify, router, state.message, state.status]);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      notify({
        tone: "error",
        title: t("https.title"),
        message: state.message,
      });
    }
  }, [notify, state.message, state.status]);

  const httpsActive = !!settings.acmeEmail;

  return (
    <section className="card stack settings-card-nointro">
      <div className="stack-tight">
        <p className="eyebrow">{t("https.eyebrow")}</p>
        <h2>{t("https.title")}</h2>
        <p className="muted">{t("https.description")}</p>
      </div>

      <div className="settings-overview-grid">
        <article className="settings-overview-card">
          <span className="muted small-text">{t("https.domainLabel")}</span>
          <strong>{appDomain}</strong>
        </article>
        <article className="settings-overview-card">
          <span className="muted small-text">{t("https.statusLabel")}</span>
          <strong>{httpsActive ? t("https.statusConfigured") : t("https.statusNotConfigured")}</strong>
        </article>
      </div>

      <form action={formAction} className="stack">
        <fieldset disabled={readOnly} className="settings-group">
          <label className="field">
            <span className="field-label">{t("https.acmeEmailLabel")}</span>
            <span className="field-description">{t("https.acmeEmailHint")}</span>
            <input
              type="email"
              name="acmeEmail"
              className="field-control"
              defaultValue={settings.acmeEmail}
              autoComplete="email"
              placeholder="admin@example.com"
            />
            {state.fieldErrors?.acmeEmail?.[0] ? <span className="field-error">{state.fieldErrors.acmeEmail[0]}</span> : null}
          </label>

          <label className="field">
            <span className="field-label">{t("https.httpPortLabel")}</span>
            <span className="field-description">{t("https.httpPortHint")}</span>
            <input
              type="number"
              name="httpPort"
              className="field-control"
              defaultValue={settings.httpPort}
              min={1}
              max={65535}
              step={1}
            />
            {state.fieldErrors?.httpPort?.[0] ? <span className="field-error">{state.fieldErrors.httpPort[0]}</span> : null}
          </label>

          <label className="field">
            <span className="field-label">{t("https.httpsPortLabel")}</span>
            <span className="field-description">{t("https.httpsPortHint")}</span>
            <input
              type="number"
              name="httpsPort"
              className="field-control"
              defaultValue={settings.httpsPort}
              min={1}
              max={65535}
              step={1}
            />
            {state.fieldErrors?.httpsPort?.[0] ? <span className="field-error">{state.fieldErrors.httpsPort[0]}</span> : null}
          </label>

          <label className="field">
            <span className="field-label">{t("https.renewIntervalLabel")}</span>
            <span className="field-description">{t("https.renewIntervalHint")}</span>
            <input
              type="number"
              name="renewIntervalHours"
              className="field-control"
              defaultValue={settings.renewIntervalHours}
              min={1}
              max={168}
              step={1}
            />
            {state.fieldErrors?.renewIntervalHours?.[0] ? <span className="field-error">{state.fieldErrors.renewIntervalHours[0]}</span> : null}
          </label>
        </fieldset>

        <div className="settings-note">
          <p className="muted">{t("https.restartNote")}</p>
          <p className="muted small-text">{t("https.envVarsNote", { hostname: appDomain })}</p>
        </div>

        {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
        {state.status === "success" && state.message ? <p className="form-success">{state.message}</p> : null}

        <div className="sheet-actions">
          <FormSubmitButton label={t("https.save")} />
        </div>
      </form>
    </section>
  );
}
