"use client";

import { useEffect, useState } from "react";
import { CircleHelp } from "lucide-react";

import { useI18n } from "@/i18n/context";

export function SettingsJsonHelp() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  return (
    <>
      <button type="button" className="button secondary settings-help-trigger" onClick={() => setOpen(true)}>
        <CircleHelp size={18} />
        {t("jsonHelp.button")}
      </button>

      {open ? (
        <div className="sheet-layer" role="presentation">
          <button type="button" className="sheet-backdrop" aria-label={t("jsonHelp.closeAria")} onClick={() => setOpen(false)} />
          <aside className="sheet-panel" aria-modal="true" role="dialog" aria-labelledby="settings-help-title">
            <div className="sheet-header">
              <div className="stack-tight">
                <p className="eyebrow">{t("jsonHelp.eyebrow")}</p>
                <h2 id="settings-help-title">{t("jsonHelp.heading")}</h2>
                <p className="muted">
                  {t("jsonHelp.intro")}
                </p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setOpen(false)}>
                {t("jsonHelp.close")}
              </button>
            </div>

            <div className="stack settings-help-content">
              <article className="card stack-tight">
                <h3>{t("jsonHelp.customKeys")}</h3>
                <p className="muted">
                  {t("jsonHelp.customKeysDescription")}
                </p>
                <p className="muted">{t("jsonHelp.securityNote")}</p>
                <p className="muted">{t("jsonHelp.supportedTypes")}</p>
              </article>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
