"use client";

import { useI18n } from "@/i18n/context";

export default function OfflinePage() {
  const { t } = useI18n();

  return (
    <section className="card stack offline-card">
      <span className="kicker">{t("offline.title")}</span>
      <div className="stack-tight">
        <h1>{t("offline.heading")}</h1>
        <p className="muted">{t("offline.description")}</p>
      </div>
    </section>
  );
}
