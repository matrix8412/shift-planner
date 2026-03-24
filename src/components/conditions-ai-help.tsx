"use client";

import { useEffect, useState } from "react";
import { CircleHelp } from "lucide-react";

import { useI18n } from "@/i18n/context";

const AI_RULES = [
  "conditions.aiRule1",
  "conditions.aiRule2",
  "conditions.aiRule3",
  "conditions.aiRule4",
  "conditions.aiRule5",
  "conditions.aiRule6",
  "conditions.aiRule7",
] as const;

export function ConditionsAiHelp() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  return (
    <>
      <button type="button" className="button secondary" onClick={() => setOpen(true)} title={t("conditions.aiHelpButton")}>
        <CircleHelp size={18} />
      </button>

      {open ? (
        <div className="confirm-layer" role="presentation">
          <button type="button" className="confirm-backdrop" aria-label={t("conditions.aiHelpClose")} onClick={() => setOpen(false)} />
          <section className="confirm-dialog" style={{ width: "min(600px, calc(100vw - 32px))" }} aria-modal="true" role="dialog" aria-labelledby="ai-help-title">
            <div className="stack-tight">
              <p className="eyebrow">{t("conditions.aiHelpEyebrow")}</p>
              <h2 id="ai-help-title">{t("conditions.aiHelpTitle")}</h2>
              <p className="muted">{t("conditions.aiHelpIntro")}</p>
            </div>
            <ol className="stack-tight" style={{ paddingLeft: "1.25em", margin: 0 }}>
              {AI_RULES.map((key, i) => (
                <li key={i} className="muted" style={{ lineHeight: 1.5 }}>{t(key)}</li>
              ))}
            </ol>
            <div className="confirm-actions">
              <button type="button" className="button" onClick={() => setOpen(false)}>
                {t("conditions.aiHelpClose")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
