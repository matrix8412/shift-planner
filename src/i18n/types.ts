export type Locale = "sk" | "en";

export const LOCALES: Locale[] = ["sk", "en"];
export const DEFAULT_LOCALE: Locale = "sk";
export const LOCALE_LABELS: Record<Locale, string> = { sk: "Slovenčina", en: "English" };
export const LOCALE_COOKIE = "pohotovosti.locale";

/**
 * Flat dictionary of all translatable strings.
 * Keys use dot-delimited namespaces, e.g. "nav.schedule", "entity.emptyState".
 * Values may contain `{placeholder}` tokens replaced at runtime.
 */
export type TranslationDictionary = Record<string, string>;
