"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { useBrowserNotifications } from "@/components/browser-notification-provider";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { ActionState } from "@/components/entity-module.types";
import type { AiAuditRunSummary } from "@/server/read-models/modules";
import { useI18n } from "@/i18n/context";

const initialState: ActionState = {
  status: "idle",
};

type AiAuditLogCardProps = {
  runs: AiAuditRunSummary[];
  retentionDays: number;
  retentionAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  readOnly?: boolean;
};

function statusLabel(status: string) {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "FAILED":
      return "danger";
    case "RUNNING":
      return "warning";
    default:
      return "neutral";
  }
}

function statusText(status: string, t: (key: string) => string) {
  switch (status) {
    case "SUCCEEDED":
      return t("aiAudit.statusSuccess");
    case "FAILED":
      return t("aiAudit.statusFailed");
    case "RUNNING":
      return t("aiAudit.statusRunning");
    default:
      return t("aiAudit.statusPending");
  }
}

export function AiAuditLogCard({ runs, retentionDays, retentionAction, readOnly = false }: AiAuditLogCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { notify } = useBrowserNotifications();
  const [state, formAction] = useActionState(retentionAction, initialState);
  const [days, setDays] = useState(retentionDays);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "success" && state.message) {
      notify({ tone: "success", title: t("aiAudit.title"), message: state.message });
      router.refresh();
    }
  }, [notify, router, state.message, state.status]);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      notify({ tone: "error", title: t("aiAudit.title"), message: state.message });
    }
  }, [notify, state.message, state.status]);

  return (
    <section className="card stack settings-card-nointro">
      <div className="stack-tight">
        <p className="eyebrow">{t("aiAudit.eyebrow")}</p>
        <h2>{t("aiAudit.title")}</h2>
        <p className="muted">{t("aiAudit.description")}</p>
      </div>

      <form action={formAction} className="stack">
        <fieldset disabled={readOnly} className="settings-group">
          <label className="field">
            <span className="field-label">{t("aiAudit.retentionLabel")}</span>
            <input
              type="number"
              name="retentionDays"
              min="1"
              max="3650"
              step="1"
              className="field-control"
              value={days}
              onChange={(e) => setDays(Number(e.currentTarget.value))}
            />
            <span className="field-description">{t("aiAudit.retentionHint")}</span>
            {state.fieldErrors?.retentionDays?.[0] ? <span className="field-error">{state.fieldErrors.retentionDays[0]}</span> : null}
          </label>
        </fieldset>

        {state.status === "error" && state.message ? <p className="form-error">{state.message}</p> : null}
        {state.status === "success" && state.message ? <p className="form-success">{state.message}</p> : null}

        <div className="sheet-actions">
          <FormSubmitButton label={t("aiAudit.save")} />
        </div>
      </form>

      {runs.length > 0 ? (
        <div className="stack">
          <h3>{t("aiAudit.historyTitle")}</h3>
          <div className="ai-audit-runs">
            {runs.map((run) => {
              const isExpanded = expandedRunId === run.id;

              return (
                <article key={run.id} className="ai-audit-run card">
                  <button
                    type="button"
                    className="ai-audit-run-header"
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    aria-expanded={isExpanded}
                  >
                    <span className="ai-audit-run-toggle">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <span className="ai-audit-run-meta">
                      <strong>{run.createdAt}</strong>
                      <span className="muted">{run.provider}</span>
                    </span>
                    <span className={`pill ${statusLabel(run.status)}`}>
                      {statusText(run.status, t)}
                    </span>
                    <span className="ai-audit-run-counts">
                      <span className="ai-audit-count-accepted" title={t("aiAudit.accepted")}>{run.acceptedEvents}</span>
                      <span className="muted">/</span>
                      <span className="ai-audit-count-rejected" title={t("aiAudit.rejected")}>{run.rejectedEvents}</span>
                    </span>
                  </button>

                  {isExpanded ? (
                    <div className="ai-audit-run-details">
                      {run.error ? (
                        <div className="ai-audit-error">
                          <p className="small-text muted">{t("aiAudit.errorLabel")}</p>
                          <pre className="ai-audit-error-text">{run.error}</pre>
                        </div>
                      ) : null}

                      {run.entries.length > 0 ? (
                        <table className="entity-table ai-audit-table">
                          <thead>
                            <tr>
                              <th>{t("aiAudit.colDate")}</th>
                              <th>{t("aiAudit.colUser")}</th>
                              <th>{t("aiAudit.colShiftType")}</th>
                              <th>{t("aiAudit.colStatus")}</th>
                              <th>{t("aiAudit.colReason")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {run.entries.map((entry) => (
                              <tr key={entry.id} className={entry.accepted ? "ai-audit-row-accepted" : "ai-audit-row-rejected"}>
                                <td>{entry.date}</td>
                                <td>{entry.userName ?? "-"}</td>
                                <td>{entry.shiftTypeName ?? "-"}</td>
                                <td>
                                  <span className={`pill ${entry.accepted ? "success" : "danger"}`}>
                                    {entry.accepted ? t("aiAudit.entryAccepted") : t("aiAudit.entryRejected")}
                                  </span>
                                </td>
                                <td className="ai-audit-reason">{entry.reason ?? "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="muted">{t("aiAudit.noEntries")}</p>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="muted">{t("aiAudit.noRuns")}</p>
      )}
    </section>
  );
}
