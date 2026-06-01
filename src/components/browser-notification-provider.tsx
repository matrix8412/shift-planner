"use client";

import { type CSSProperties, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

import type { BrowserNotificationSettings } from "@/server/config/browser-notifications";

type BrowserNotificationTone = "success" | "error" | "info";

type BrowserNotificationInput = {
  notificationKey?: string;
  title?: string;
  message: string;
  tone?: BrowserNotificationTone;
  persistent?: boolean;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
};

type BrowserNotificationItem = BrowserNotificationInput & {
  id: number;
  tone: BrowserNotificationTone;
};

type BrowserNotificationContextValue = {
  notify: (input: BrowserNotificationInput) => void;
  dismissKey: (key: string) => void;
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

  const dismissById = useCallback((id: number) => {
    const timeoutId = timeoutMapRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutMapRef.current.delete(id);
    }

    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismissKey = useCallback((key: string) => {
    setItems((current) => {
      const match = current.find((item) => item.notificationKey === key);

      if (match) {
        const timeoutId = timeoutMapRef.current.get(match.id);
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          timeoutMapRef.current.delete(match.id);
        }
      }

      return current.filter((item) => item.notificationKey !== key);
    });
  }, []);

  const notify = useCallback(
    (input: BrowserNotificationInput) => {
      const id = nextNotificationId;
      nextNotificationId += 1;

      const tone = input.tone ?? "info";
      const nextItem = { ...input, id, tone };

      setItems((current) => {
        const nextItems = input.notificationKey ? current.filter((item) => item.notificationKey !== input.notificationKey) : current;

        if (input.notificationKey) {
          const existing = current.find((item) => item.notificationKey === input.notificationKey);
          if (existing) {
            const timeoutId = timeoutMapRef.current.get(existing.id);
            if (timeoutId) {
              window.clearTimeout(timeoutId);
              timeoutMapRef.current.delete(existing.id);
            }
          }
        }

        return [...nextItems, nextItem];
      });

      if (!input.persistent) {
        const timeoutId = window.setTimeout(() => {
          dismissById(id);
        }, settings.durationMs);

        timeoutMapRef.current.set(id, timeoutId);
      }
    },
    [dismissById, settings.durationMs],
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
      dismissKey,
    }),
    [dismissKey, notify],
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
                    {item.actionLabel && item.onAction ? (
                      <button
                        type="button"
                        className="browser-notification-action"
                        onClick={() => {
                          void item.onAction?.();
                        }}
                      >
                        {item.actionLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
                {item.persistent ? null : (
                  <button type="button" className="browser-notification-close" onClick={() => dismissById(item.id)} aria-label="Zavriet notifikaciu">
                    <X size={16} />
                  </button>
                )}
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
      dismissKey: (_key: string) => undefined,
    };
  }

  return context;
}
