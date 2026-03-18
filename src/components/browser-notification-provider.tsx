"use client";

import { type CSSProperties, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

import type { BrowserNotificationSettings } from "@/server/config/browser-notifications";

type BrowserNotificationTone = "success" | "error" | "info";

type BrowserNotificationInput = {
  title?: string;
  message: string;
  tone?: BrowserNotificationTone;
};

type BrowserNotificationItem = BrowserNotificationInput & {
  id: number;
  tone: BrowserNotificationTone;
};

type BrowserNotificationContextValue = {
  notify: (input: BrowserNotificationInput) => void;
};

const BrowserNotificationContext = createContext<BrowserNotificationContextValue | null>(null);

let nextNotificationId = 1;

function getNotificationTitle(tone: BrowserNotificationTone) {
  switch (tone) {
    case "success":
      return "Uspech";
    case "error":
      return "Chyba";
    default:
      return "Informacia";
  }
}

function getNotificationIcon(tone: BrowserNotificationTone) {
  switch (tone) {
    case "success":
      return CheckCircle2;
    case "error":
      return CircleAlert;
    default:
      return Info;
  }
}

export function BrowserNotificationProvider({
  children,
  settings,
}: {
  children: React.ReactNode;
  settings: BrowserNotificationSettings;
}) {
  const [items, setItems] = useState<BrowserNotificationItem[]>([]);
  const timeoutMapRef = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timeoutId = timeoutMapRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutMapRef.current.delete(id);
    }

    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (input: BrowserNotificationInput) => {
      const id = nextNotificationId;
      nextNotificationId += 1;

      const tone = input.tone ?? "info";
      setItems((current) => [...current, { ...input, id, tone }]);

      const timeoutId = window.setTimeout(() => {
        dismiss(id);
      }, settings.durationMs);

      timeoutMapRef.current.set(id, timeoutId);
    },
    [dismiss, settings.durationMs],
  );

  useEffect(() => {
    return () => {
      for (const timeoutId of timeoutMapRef.current.values()) {
        window.clearTimeout(timeoutId);
      }

      timeoutMapRef.current.clear();
    };
  }, []);

  const contextValue = useMemo<BrowserNotificationContextValue>(
    () => ({
      notify,
    }),
    [notify],
  );

  return (
    <BrowserNotificationContext.Provider value={contextValue}>
      {children}
      <div className={`browser-notification-stack ${settings.position}`} aria-live="polite" aria-atomic="false">
        {items.map((item) => {
          const Icon = getNotificationIcon(item.tone);

          return (
            <article
              key={item.id}
              className={`browser-notification ${item.tone}`}
              style={
                {
                  "--browser-notification-opacity": String(settings.opacity),
                  "--browser-notification-background-light": settings.backgroundLight,
                  "--browser-notification-text-light": settings.textLight,
                  "--browser-notification-border-light": settings.borderLight,
                  "--browser-notification-background-dark": settings.backgroundDark,
                  "--browser-notification-text-dark": settings.textDark,
                  "--browser-notification-border-dark": settings.borderDark,
                } as CSSProperties
              }
            >
              <div className="browser-notification-head">
                <div className="browser-notification-copy">
                  <span className="browser-notification-icon">
                    <Icon size={18} />
                  </span>
                  <div className="stack-tight">
                    <strong>{item.title ?? getNotificationTitle(item.tone)}</strong>
                    <p>{item.message}</p>
                  </div>
                </div>
                <button type="button" className="browser-notification-close" onClick={() => dismiss(item.id)} aria-label="Zavriet notifikaciu">
                  <X size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </BrowserNotificationContext.Provider>
  );
}

export function useBrowserNotifications() {
  const context = useContext(BrowserNotificationContext);

  if (!context) {
    return {
      notify: (_input: BrowserNotificationInput) => undefined,
    };
  }

  return context;
}
