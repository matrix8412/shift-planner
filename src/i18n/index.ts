import { cookies } from "next/headers";

import type { Locale, TranslationDictionary } from "./types";
import { DEFAULT_LOCALE, LOCALES } from "./types";
import sk from "./sk";
import en from "./en";

const dictionaries: Record<Locale, TranslationDictionary> = { sk, en };

/** Return the full dictionary for the given locale. */
export function getDictionary(locale: Locale): TranslationDictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

/**
 * Translate a key. Supports `{placeholder}` tokens.
 *
 * @example
 *   t(dict, "entity.pageOf", { current: "1", total: "5" })
 *   // => "Strana 1 z 5"
 */
export function t(
  dict: TranslationDictionary,
  key: string,
  params?: Record<string, string | number>,
): string {
  let value = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replaceAll(`{${k}}`, String(v));
    }
  }
  return value;
}

const LOCALE_COOKIE = "pohotovosti.locale";

/** Resolve the current locale on the server (cookie → default). */
export async function getServerLocale(): Promise<Locale> {
  try {
    const jar = await cookies();
    const raw = jar.get(LOCALE_COOKIE)?.value;
    if (raw && LOCALES.includes(raw as Locale)) return raw as Locale;
  } catch {
    // cookies() may throw during static generation – fall back
  }
  return DEFAULT_LOCALE;
}

/** Name of the cookie used to persist the locale preference. */
export { LOCALE_COOKIE };

export { LOCALES, DEFAULT_LOCALE } from "./types";
export type { Locale, TranslationDictionary } from "./types";
