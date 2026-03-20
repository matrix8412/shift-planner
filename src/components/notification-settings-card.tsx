"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Mail, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";

import { useBrowserNotifications } from "@/components/browser-notification-provider";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { ActionState } from "@/components/entity-module.types";
import { useI18n } from "@/i18n/context";
import SearchableSelect from "@/components/searchable-select";
import type { NotificationSettings } from "@/server/config/notification-settings";

const initialState: ActionState = {
  status: "idle",
};

const templateVariables = [
  { key: "recipient_name", labelKey: "notifVar.recipientName" },
  { key: "recipient_email", labelKey: "notifVar.recipientEmail" },
  { key: "notification_title", labelKey: "notifVar.notificationTitle" },
  { key: "notification_message", labelKey: "notifVar.notificationMessage" },
  { key: "action_url", labelKey: "notifVar.actionUrl" },
  { key: "app_name", labelKey: "notifVar.appName" },
  { key: "entity_type", labelKey: "notifVar.entityType" },
  { key: "entity_label", labelKey: "notifVar.entityName" },
  { key: "channel", labelKey: "notifVar.channel" },
  { key: "current_year", labelKey: "notifVar.currentYear" },
  { key: "accent_color", labelKey: "notifVar.accentColor" },
];

type NotificationSettingsCardProps = {
  settings: NotificationSettings;
  profile: {
    name: string;
    email: string;
  };
  saveAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  testAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  readOnly?: boolean;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);

  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

export function NotificationSettingsCard({ settings, profile, saveAction, testAction, readOnly = false }: NotificationSettingsCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { notify } = useBrowserNotifications();
  const [saveState, saveFormAction] = useActionState(saveAction, initialState);
  const [testState, testFormAction] = useActionState(testAction, initialState);
  const [activeTemplateField, setActiveTemplateField] = useState<string>("emailHtmlTemplate");
  const [isPushSupported, setIsPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isDeviceSubscribed, setIsDeviceSubscribed] = useState(false);
  const [deviceActionPending, setDeviceActionPending] = useState(false);
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  const previewSubject = useMemo(
    () =>
      settings.email.subjectTemplate
        .replaceAll("{{notification_title}}", t("notifVar.previewSubject"))
        .replaceAll("{{app_name}}", t("notifVar.appNameValue")),
    [settings.email.subjectTemplate, t],
  );

  useEffect(() => {
    if (saveState.status === "success" && saveState.message) {
      notify({
        tone: "success",
        title: t("notifToast.saveSuccess"),
        message: saveState.message,
      });
      router.refresh();
    }
  }, [notify, router, saveState.message, saveState.status]);

  useEffect(() => {
    if (saveState.status === "error" && saveState.message) {
      notify({
        tone: "error",
        title: t("notifToast.saveError"),
        message: saveState.message,
      });
    }
  }, [notify, saveState.message, saveState.status]);

  useEffect(() => {
    if (testState.status === "success" && testState.message) {
      notify({
        tone: "success",
        title: t("notifToast.testSuccess"),
        message: testState.message,
      });
    }
  }, [notify, testState.message, testState.status]);

  useEffect(() => {
    if (testState.status === "error" && testState.message) {
      notify({
        tone: "error",
        title: t("notifToast.testError"),
        message: testState.message,
      });
    }
  }, [notify, testState.message, testState.status]);

  useEffect(() => {
    let ignore = false;

    async function syncDeviceSubscription() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!ignore) {
          setIsPushSupported(false);
          setPushPermission("unsupported");
        }
        return;
      }

      setIsPushSupported(true);
      setPushPermission(Notification.permission);

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (!ignore) {
          setIsDeviceSubscribed(Boolean(subscription));
        }
      } catch {
        if (!ignore) {
          setIsDeviceSubscribed(false);
        }
      }
    }

    syncDeviceSubscription();
    return () => {
      ignore = true;
    };
  }, []);

  function insertVariable(targetName: string, variableKey: string) {
    const element = fieldRefs.current[targetName];
    if (!element) {
      return;
    }

    const token = `{{${variableKey}}}`;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const nextValue = `${element.value.slice(0, start)}${token}${element.value.slice(end)}`;

    element.value = nextValue;
    element.focus();
    const nextCaret = start + token.length;
    element.setSelectionRange(nextCaret, nextCaret);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function handleTemplateDrop(event: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>, fieldName: string) {
    event.preventDefault();
    const variableKey = event.dataTransfer.getData("text/plain");

    if (variableKey) {
      insertVariable(fieldName, variableKey);
    }
  }

  async function handleSubscribeDevice() {
    if (!isPushSupported) {
      notify({
        tone: "error",
        title: t("push.title"),
        message: t("push.unsupported"),
      });
      return;
    }

    if (!settings.push.enabled) {
      notify({
        tone: "error",
        title: t("push.title"),
        message: t("push.globallyDisabled"),
      });
      return;
    }

    if (!settings.push.vapidPublicKey) {
      notify({
        tone: "error",
        title: t("push.title"),
        message: t("push.missingVapidKey"),
      });
      return;
    }

    try {
      setDeviceActionPending(true);
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== "granted") {
        throw new Error(t("push.notAllowed"));
      }

      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription =
        existingSubscription ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(settings.push.vapidPublicKey),
        }));

      const response = await fetch("/api/notifications/push/subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...subscription.toJSON(),
          userEmail: profile.email,
          userName: profile.name,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: t("push.subscriptionFailed") }));
        throw new Error(payload.error ?? t("push.subscriptionFailed"));
      }

      setIsDeviceSubscribed(true);
      notify({
        tone: "success",
        title: t("push.title"),
        message: t("push.subscribed"),
      });
    } catch (error) {
      notify({
        tone: "error",
        title: t("push.title"),
        message: error instanceof Error ? error.message : t("push.subscriptionFailed"),
      });
    } finally {
      setDeviceActionPending(false);
    }
  }

  async function handleUnsubscribeDevice() {
    try {
      setDeviceActionPending(true);
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setIsDeviceSubscribed(false);
        return;
      }

      const endpoint = subscription.endpoint;
      await fetch("/api/notifications/push/subscription", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ endpoint }),
      });

      await subscription.unsubscribe();
      setIsDeviceSubscribed(false);
      notify({
        tone: "success",
        title: t("push.title"),
        message: t("push.unsubscribed"),
      });
    } catch (error) {
      notify({
        tone: "error",
        title: t("push.title"),
        message: error instanceof Error ? error.message : t("push.unsubscribeFailed"),
      });
    } finally {
      setDeviceActionPending(false);
    }
  }

  return (
    <section className="card stack settings-card-nointro">
      <div className="stack-tight">
        <p className="eyebrow">{t("notifCard.eyebrow")}</p>
        <h2>{t("notifCard.heading")}</h2>
        <p className="muted">{t("notifCard.description")}</p>
      </div>

      <div className="settings-overview-grid">
        <article className="settings-overview-card">
          <span className="muted small-text">{t("notifCard.webToast")}</span>
          <strong>{settings.toast.position}</strong>
        </article>
        <article className="settings-overview-card">
          <span className="muted small-text">{t("notifCard.pwaPush")}</span>
          <strong>{settings.push.enabled ? t("notifCard.active") : t("notifCard.disabled")}</strong>
        </article>
        <article className="settings-overview-card">
          <span className="muted small-text">{t("notifCard.email")}</span>
          <strong>{settings.email.enabled ? t("notifCard.activeMale") : t("notifCard.disabledMale")}</strong>
        </article>
      </div>

      <form action={saveFormAction} className="stack">
        <fieldset disabled={readOnly} className="settings-group">
        <div className="stack-tight">
          <p className="eyebrow">{t("notifCard.toastEyebrow")}</p>
          <h3>{t("notifCard.toastHeading")}</h3>
        </div>

        <div className="settings-grid">
          <label className="field">
            <span className="field-label">{t("notifCard.toastPosition")}</span>
            <SearchableSelect
              name="toastPosition"
              defaultValue={settings.toast.position}
              className="field-control"
              options={[
                { value: "top-right", label: t("notifCard.toastTopRight") },
                { value: "top-left", label: t("notifCard.toastTopLeft") },
                { value: "bottom-right", label: t("notifCard.toastBottomRight") },
                { value: "bottom-left", label: t("notifCard.toastBottomLeft") },
              ]}
            />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.toastOpacity")}</span>
            <input type="range" name="toastOpacityPercent" min="35" max="100" step="1" defaultValue={Math.round(settings.toast.opacity * 100)} className="range-control" />
            <span className="field-description">{t("notifCard.toastOpacityHint")}</span>
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.toastDuration")}</span>
            <input type="number" name="toastDurationMs" min="2000" max="15000" step="100" defaultValue={settings.toast.durationMs} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.toastBgLight")}</span>
            <input type="color" name="toastBackgroundLight" defaultValue={settings.toast.backgroundLight} className="field-control field-control-color" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.toastTextLight")}</span>
            <input type="color" name="toastTextLight" defaultValue={settings.toast.textLight} className="field-control field-control-color" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.toastBorderLight")}</span>
            <input type="color" name="toastBorderLight" defaultValue={settings.toast.borderLight} className="field-control field-control-color" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.toastBgDark")}</span>
            <input type="color" name="toastBackgroundDark" defaultValue={settings.toast.backgroundDark} className="field-control field-control-color" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.toastTextDark")}</span>
            <input type="color" name="toastTextDark" defaultValue={settings.toast.textDark} className="field-control field-control-color" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.toastBorderDark")}</span>
            <input type="color" name="toastBorderDark" defaultValue={settings.toast.borderDark} className="field-control field-control-color" />
          </label>
        </div>

        <div className="stack-tight">
          <p className="eyebrow">{t("notifCard.pushEyebrow")}</p>
          <h3>{t("notifCard.pushHeading")}</h3>
        </div>

        <div className="settings-grid">
          <label className="checkbox-field">
            <input type="checkbox" name="pushEnabled" className="checkbox-control" defaultChecked={settings.push.enabled} />
            <span className="stack-tight">
              <span className="field-label">{t("notifCard.pushEnable")}</span>
              <span className="field-description">{t("notifCard.pushEnableHint")}</span>
            </span>
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.vapidPublic")}</span>
            <input type="text" name="pushVapidPublicKey" defaultValue={settings.push.vapidPublicKey} className="field-control" autoComplete="off" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.vapidPrivate")}</span>
            <input type="password" name="pushVapidPrivateKey" defaultValue={settings.push.vapidPrivateKey} className="field-control" autoComplete="off" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.vapidSubject")}</span>
            <input type="text" name="pushSubject" defaultValue={settings.push.subject} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.pushIcon")}</span>
            <input type="text" name="pushIconUrl" defaultValue={settings.push.iconUrl} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.pushBadge")}</span>
            <input type="text" name="pushBadgeUrl" defaultValue={settings.push.badgeUrl} className="field-control" />
          </label>
        </div>

        <div className="settings-overview-grid notification-device-grid">
          <article className="settings-overview-card stack-tight">
            <div className="notification-device-head">
              <Smartphone size={18} />
              <strong>{t("notifCard.deviceTitle")}</strong>
            </div>
            <span className="muted small-text">
              {t("notifCard.deviceStatus")}: {pushPermission === "unsupported" ? t("notifCard.deviceUnsupported") : `${pushPermission}${isDeviceSubscribed ? " · subscribed" : ""}`}
            </span>
            <div className="sheet-actions notification-device-actions">
              <button type="button" className="button secondary" onClick={handleSubscribeDevice} disabled={deviceActionPending || !settings.push.enabled}>
                {t("notifCard.deviceEnable")}
              </button>
              <button type="button" className="button secondary" onClick={handleUnsubscribeDevice} disabled={deviceActionPending || !isDeviceSubscribed}>
                {t("notifCard.deviceDisable")}
              </button>
            </div>
          </article>
        </div>

        <div className="stack-tight">
          <p className="eyebrow">{t("notifCard.emailEyebrow")}</p>
          <h3>{t("notifCard.emailHeading")}</h3>
        </div>

        <div className="settings-grid">
          <label className="checkbox-field">
            <input type="checkbox" name="emailEnabled" className="checkbox-control" defaultChecked={settings.email.enabled} />
            <span className="stack-tight">
              <span className="field-label">{t("notifCard.emailEnable")}</span>
              <span className="field-description">{t("notifCard.emailEnableHint")}</span>
            </span>
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.emailFromName")}</span>
            <input type="text" name="emailFromName" defaultValue={settings.email.fromName} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.emailFromEmail")}</span>
            <input type="email" name="emailFromEmail" defaultValue={settings.email.fromEmail} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.emailReplyTo")}</span>
            <input type="email" name="emailReplyTo" defaultValue={settings.email.replyTo} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.emailAccentColor")}</span>
            <input type="color" name="emailAccentColor" defaultValue={settings.email.accentColor} className="field-control field-control-color" />
          </label>
        </div>

        <div className="notification-template-tools stack-tight">
          <div className="notification-template-toolbar">
            <span className="field-label">{t("notifCard.templateVarsLabel")}</span>
            <span className="field-description">{t("notifCard.templateVarsHint")}</span>
          </div>
          <div className="notification-variable-list">
            {templateVariables.map((variable) => (
              <button
                key={variable.key}
                type="button"
                className="notification-variable-chip"
                draggable
                onClick={() => insertVariable(activeTemplateField, variable.key)}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", variable.key)}
              >
                {t(variable.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
            <span className="field-label">{t("notifCard.emailSubject")}</span>
          <input
            ref={(element) => {
              fieldRefs.current.emailSubjectTemplate = element;
            }}
            type="text"
            name="emailSubjectTemplate"
            defaultValue={settings.email.subjectTemplate}
            className="field-control"
            onFocus={() => setActiveTemplateField("emailSubjectTemplate")}
            onDrop={(event) => handleTemplateDrop(event, "emailSubjectTemplate")}
            onDragOver={(event) => event.preventDefault()}
          />
          <span className="field-description">{t("notifCard.emailPreview")}: {previewSubject}</span>
        </label>

        <label className="field">
            <span className="field-label">{t("notifCard.emailHtmlBody")}</span>
          <textarea
            ref={(element) => {
              fieldRefs.current.emailHtmlTemplate = element;
            }}
            name="emailHtmlTemplate"
            defaultValue={settings.email.htmlTemplate}
            rows={10}
            className="textarea-control"
            onFocus={() => setActiveTemplateField("emailHtmlTemplate")}
            onDrop={(event) => handleTemplateDrop(event, "emailHtmlTemplate")}
            onDragOver={(event) => event.preventDefault()}
          />
        </label>

        <label className="field">
            <span className="field-label">{t("notifCard.emailTextFallback")}</span>
          <textarea
            ref={(element) => {
              fieldRefs.current.emailTextTemplate = element;
            }}
            name="emailTextTemplate"
            defaultValue={settings.email.textTemplate}
            rows={8}
            className="textarea-control"
            onFocus={() => setActiveTemplateField("emailTextTemplate")}
            onDrop={(event) => handleTemplateDrop(event, "emailTextTemplate")}
            onDragOver={(event) => event.preventDefault()}
          />
        </label>

        {saveState.status === "error" && saveState.message ? <p className="form-error">{saveState.message}</p> : null}
        {saveState.status === "success" && saveState.message ? <p className="form-success">{saveState.message}</p> : null}

        <div className="sheet-actions">
          <FormSubmitButton label={t("notifCard.save")} />
        </div>
        </fieldset>
      </form>

      <form action={testFormAction} className="stack notification-test-card">
        <fieldset disabled={readOnly} className="settings-group">
        <div className="stack-tight">
          <p className="eyebrow">{t("notifCard.testEyebrow")}</p>
          <h3>{t("notifCard.testHeading")}</h3>
          <p className="muted">{t("notifCard.testDescription")}</p>
        </div>

        <div className="settings-grid">
          <label className="field">
            <span className="field-label">{t("notifCard.testEmail")}</span>
            <input type="email" name="targetEmail" defaultValue={profile.email} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.testName")}</span>
            <input type="text" name="targetName" defaultValue={profile.name} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.testTitle")}</span>
            <input type="text" name="title" defaultValue={t("notifCard.testTitleDefault")} className="field-control" />
          </label>

          <label className="field">
            <span className="field-label">{t("notifCard.testMessage")}</span>
            <textarea name="message" defaultValue={t("notifCard.testMessageDefault")} rows={4} className="textarea-control" />
          </label>
        </div>

        <div className="notification-channel-grid">
          <label className="checkbox-field notification-channel-card">
            <input type="checkbox" name="sendEmail" className="checkbox-control" defaultChecked={settings.email.enabled} />
            <span className="stack-tight">
              <span className="notification-device-head">
                <Mail size={18} />
                <strong>{t("notifCard.email")}</strong>
              </span>
              <span className="field-description">{t("notifCard.testChannelEmailHint")}</span>
            </span>
          </label>

          <label className="checkbox-field notification-channel-card">
            <input type="checkbox" name="sendPush" className="checkbox-control" defaultChecked={settings.push.enabled} />
            <span className="stack-tight">
              <span className="notification-device-head">
                <BellRing size={18} />
                <strong>{t("notifCard.pwaPush")}</strong>
              </span>
              <span className="field-description">{t("notifCard.testChannelPushHint")}</span>
            </span>
          </label>
        </div>

        {testState.status === "error" && testState.message ? <p className="form-error">{testState.message}</p> : null}
        {testState.status === "success" && testState.message ? <p className="form-success">{testState.message}</p> : null}

        <div className="sheet-actions">
          <FormSubmitButton label={t("notifCard.testSend")} />
        </div>
        </fieldset>
      </form>
    </section>
  );
}
