"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { Locale, TranslationDictionary } from "./types";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES } from "./types";
import sk from "./sk";
import en from "./en";

const dictionaries: Record<Locale, TranslationDictionary> = { sk, en };

interface I18nContextValue {
  locale: Locale;
  dict: TranslationDictionary;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale: initialLocale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const locale = initialLocale;
  const dict = useMemo(() => dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE], [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let value = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replaceAll(`{${k}}`, String(v));
        }
      }
      return value;
    },
    [dict],
  );

  const setLocale = useCallback((newLocale: Locale) => {
    if (!LOCALES.includes(newLocale)) return;
    document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    // Full reload to recalculate server components with the new locale
    window.location.reload();
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dict, t, setLocale }),
    [locale, dict, t, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Hook for client components to access translations.
 * @example
 *   const { t } = useI18n();
 *   <h1>{t("nav.schedule")}</h1>
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within <I18nProvider>");
  }
  return ctx;
}
