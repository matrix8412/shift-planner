"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useBrowserNotifications } from "@/components/browser-notification-provider";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { ActionState } from "@/components/entity-module.types";
import { useI18n } from "@/i18n/context";
import SearchableSelect from "@/components/searchable-select";

const initialState: ActionState = {
  status: "idle",
};

type AiSettingsValue = {
  provider: "openai" | "anthropic" | "gemini";
  openAiApiKey: string;
  anthropicApiKey: string;
  googleApiKey: string;
};

type AiSettingsCardProps = {
  settings: AiSettingsValue;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  readOnly?: boolean;
};

export function AiSettingsCard({ settings, action, readOnly = false }: AiSettingsCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { notify } = useBrowserNotifications();
  const [state, formAction] = useActionState(action, initialState);
  const [provider, setProvider] = useState<AiSettingsValue["provider"]>(settings.provider);

  useEffect(() => {
    if (state.status === "success" && state.message) {
      notify({
        tone: "success",
        title: t("ai.title"),
        message: state.message,
      });
      router.refresh();
    }
  }, [notify, router, state.message, state.status]);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      notify({
        tone: "error",
        title: t("ai.title"),
        message: state.message,
      });
    }
  }, [notify, state.message, state.status]);

  useEffect(() => {
    setProvider(settings.provider);
  }, [settings.provider]);

  const hasOpenAiKey = settings.openAiApiKey.length > 0;
  const hasAnthropicKey = settings.anthropicApiKey.length > 0;
  const hasGoogleKey = settings.googleApiKey.length > 0;
  const isConfigured = provider === "openai" ? hasOpenAiKey : provider === "anthropic" ? hasAnthropicKey : hasGoogleKey;
  const providerDisplayName = provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "Google Gemini";

  return (
    <section className="card stack settings-card-nointro">
      <div className="stack-tight">
        <p className="eyebrow">{t("ai.eyebrow")}</p>
        <h2>{t("ai.title")}</h2>
        <p className="muted">{t("ai.description")}</p>
      </div>

      <div className="settings-overview-grid">
        <article className="settings-overview-card">
          <span className="muted small-text">{t("ai.activeProvider")}</span>
          <strong>{providerDisplayName}</strong>
        </article>

        <article className="settings-overview-card">
          <span className="muted small-text">{t("ai.requiredKey")}</span>
          <strong>{isConfigured ? t("ai.keySet") : t("ai.keyMissing")}</strong>
        </article>

        <article className="settings-overview-card">
          <span className="muted small-text">{t("ai.scheduleGeneration")}</span>
          <strong>{t("ai.scaffolded")}</strong>
        </article>
      </div>

      <form action={formAction} className="stack">
        <fieldset disabled={readOnly} className="settings-group">
        <label className="field">
          <span className="field-label">{t("ai.providerLabel")}</span>
          <SearchableSelect
            name="provider"
            value={provider}
            onChange={(v) => setProvider(String(v) as AiSettingsValue["provider"])}
            className="field-control"
            options={[
              { value: "openai", label: "OpenAI" },
              { value: "anthropic", label: "Anthropic" },
              { value: "gemini", label: "Google Gemini" },
            ]}
          />
        </label>

        <div className="settings-grid">
          <article className="settings-overview-card stack-tight">
            <span className="field-label">{t("ai.openaiKeyLabel")}</span>
            <p className="muted">{hasOpenAiKey ? t("ai.openaiKeyStored") : t("ai.openaiKeyMissing")}</p>
            <label className="field">
              <span className="field-description">{t("ai.openaiKeepExisting")}</span>
              <input type="password" name="openAiApiKey" className="field-control" autoComplete="off" placeholder="sk-..." />
              {state.fieldErrors?.openAiApiKey?.[0] ? <span className="field-error">{state.fieldErrors.openAiApiKey[0]}</span> : null}
            </label>
            <label className="checkbox-field">
              <input type="checkbox" name="clearOpenAiApiKey" className="checkbox-control" />
              <span className="stack-tight">
                <span className="field-label">{t("ai.deleteOpenai")}</span>
                <span className="field-description">{t("ai.deleteOpenaiHint")}</span>
              </span>
            </label>
          </article>

          <article className="settings-overview-card stack-tight">
            <span className="field-label">{t("ai.anthropicKeyLabel")}</span>
            <p className="muted">{hasAnthropicKey ? t("ai.anthropicKeyStored") : t("ai.anthropicKeyMissing")}</p>
            <label className="field">
              <span className="field-description">{t("ai.anthropicKeepExisting")}</span>
              <input type="password" name="anthropicApiKey" className="field-control" autoComplete="off" placeholder="sk-ant-..." />
              {state.fieldErrors?.anthropicApiKey?.[0] ? <span className="field-error">{state.fieldErrors.anthropicApiKey[0]}</span> : null}
            </label>
            <label className="checkbox-field">
              <input type="checkbox" name="clearAnthropicApiKey" className="checkbox-control" />
              <span className="stack-tight">
                <span className="field-label">{t("ai.deleteAnthropic")}</span>
                <span className="field-description">{t("ai.deleteAnthropicHint")}</span>
              </span>
            </label>
          </article>

          <article className="settings-overview-card stack-tight">
            <span className="field-label">{t("ai.googleKeyLabel")}</span>
            <p className="muted">{hasGoogleKey ? t("ai.googleKeyStored") : t("ai.googleKeyMissing")}</p>
            <label className="field">
              <span className="field-description">{t("ai.googleKeepExisting")}</span>
              <input type="password" name="googleApiKey" className="field-control" autoComplete="off" placeholder="AIza..." />
              {state.fieldErrors?.googleApiKey?.[0] ? <span className="field-error">{state.fieldErrors.googleApiKey[0]}</span> : null}
            </label>
            <label className="checkbox-field">
              <input type="checkbox" name="clearGoogleApiKey" className="checkbox-control" />
              <span className="stack-tight">
                <span className="field-label">{t("ai.deleteGoogle")}</span>
                <span className="field-description">{t("ai.deleteGoogleHint")}</span>
              </span>
            </label>
          </article>
        </div>

        <div className="settings-note">
          <p className="muted">
            {t("ai.providerWarning", { provider: providerDisplayName })}
          </p>
        </div>

        {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
        {state.status === "success" && state.message ? <p className="form-success">{state.message}</p> : null}

        <div className="sheet-actions">
          <FormSubmitButton label={t("ai.save")} />
        </div>
        </fieldset>
      </form>
    </section>
  );
}
