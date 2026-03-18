"use client";

import { useI18n } from "@/i18n/context";

export function AccessDenied({ title, description }: { title?: string; description?: string }) {
  const { t } = useI18n();

  return (
    <section className="module-page stack">
      <section className="card stack-tight">
        <h1>{title ?? t("access.denied")}</h1>
        <p className="muted">{description ?? t("access.deniedDescription")}</p>
      </section>
    </section>
  );
}
