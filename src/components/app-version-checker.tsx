"use client";

import { useCallback, useEffect, useRef } from "react";

import { APP_VERSION } from "@/generated/app-version";
import { useBrowserNotifications } from "@/components/browser-notification-provider";
import { useI18n } from "@/i18n/context";

const UPDATE_NOTIFICATION_KEY = "app-version-update";

export function AppVersionChecker() {
  const { t } = useI18n();
  const { notify, dismissKey } = useBrowserNotifications();
  const inFlightRef = useRef(false);

  const updateApp = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    } catch {
      // Ignore SW update failures and still reload the app shell.
    }

    window.location.reload();
  }, []);

  const checkVersion = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;

    try {
      const response = await fetch("/api/app-version", { cache: "no-store" });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { version?: string };
      const serverVersion = payload.version?.trim();

      if (!serverVersion) {
        return;
      }

      if (serverVersion === APP_VERSION) {
        dismissKey(UPDATE_NOTIFICATION_KEY);
        return;
      }

      notify({
        notificationKey: UPDATE_NOTIFICATION_KEY,
        persistent: true,
        tone: "info",
        title: t("appVersion.title"),
        message: t("appVersion.message"),
        actionLabel: t("appVersion.action"),
        onAction: updateApp,
      });
    } catch {
      // Retry on the next click.
    } finally {
      inFlightRef.current = false;
    }
  }, [dismissKey, notify, t, updateApp]);

  useEffect(() => {
    void checkVersion();

    const handleClick = () => {
      void checkVersion();
    };

    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, [checkVersion]);

  return null;
}
