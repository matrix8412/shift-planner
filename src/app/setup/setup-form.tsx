"use client";

import { useActionState, useState } from "react";
import { Shield, User, ChevronRight, ChevronLeft, Check, Plus } from "lucide-react";

import {
  setupWizardAction,
  type SetupActionState,
  type SetupRole,
} from "@/server/actions/setup";
import { useI18n } from "@/i18n/context";

const initialState: SetupActionState = { status: "idle" };

export function SetupForm({ existingRoles }: { existingRoles: SetupRole[] }) {
  const [step, setStep] = useState(1);
  const [state, formAction, isPending] = useActionState(setupWizardAction, initialState);
  const { t } = useI18n();

  const hasRoles = existingRoles.length > 0;

  // Role mode: "existing" (pick from list) or "new" (create new)
  const [roleMode, setRoleMode] = useState<"existing" | "new">(hasRoles ? "existing" : "new");
  const [selectedRoleId, setSelectedRoleId] = useState(existingRoles[0]?.id ?? "");

  // New role fields
  const [roleCode, setRoleCode] = useState("ADMIN");
  const [roleName, setRoleName] = useState("Administrátor");
  const [codeError, setCodeError] = useState("");

  function handleNextStep() {
    // Validate before going to step 2
    if (roleMode === "existing") {
      if (!selectedRoleId) return;
    } else {
      const code = roleCode.trim();
      const name = roleName.trim();

      if (!code || !name) return;

      // Check if new code collides with an existing role
      const duplicate = existingRoles.find(
        (r) => r.code.toLowerCase() === code.toLowerCase(),
      );

      if (duplicate) {
        setCodeError(t("setup.roleCodeExists"));
        return;
      }

      setCodeError("");
    }

    setStep(2);
  }

  return (
    <div className="login-shell">
      <div className="setup-card">
        <div className="login-header">
          <div className="login-icon">
            <Shield size={28} />
          </div>
          <h1>{t("setup.title")}</h1>
          <p className="muted">{t("setup.description")}</p>
        </div>

        {/* Progress indicator */}
        <div className="setup-steps">
          <div className={`setup-step${step >= 1 ? " active" : ""}`}>
            <span className="setup-step-number">{step > 1 ? <Check size={14} /> : "1"}</span>
            <span className="setup-step-label">{t("setup.stepRole")}</span>
          </div>
          <div className="setup-step-divider" />
          <div className={`setup-step${step >= 2 ? " active" : ""}`}>
            <span className="setup-step-number">2</span>
            <span className="setup-step-label">{t("setup.stepUser")}</span>
          </div>
        </div>

        <form action={formAction} className="login-form">
          {/* Hidden fields sent to the server action */}
          <input type="hidden" name="roleMode" value={roleMode} />

          {roleMode === "existing" ? (
            <input type="hidden" name="existingRoleId" value={selectedRoleId} />
          ) : (
            <>
              <input type="hidden" name="roleCode" value={roleCode} />
              <input type="hidden" name="roleName" value={roleName} />
            </>
          )}

          {state.status === "error" && state.message ? (
            <div className="form-error">{state.message}</div>
          ) : null}

          {/* ─── Step 1: Role ─────────────────────────────── */}
          {step === 1 ? (
            <>
              <div className="setup-step-header">
                <Shield size={20} />
                <div>
                  <h2 className="setup-step-title">{t("setup.roleTitle")}</h2>
                  <p className="muted small-text">{t("setup.roleDescription")}</p>
                </div>
              </div>

              {/* Mode tabs (only if roles exist) */}
              {hasRoles ? (
                <div className="setup-role-tabs">
                  <button
                    type="button"
                    className={`setup-role-tab${roleMode === "existing" ? " active" : ""}`}
                    onClick={() => setRoleMode("existing")}
                  >
                    <Shield size={16} />
                    {t("setup.selectExisting")}
                  </button>
                  <button
                    type="button"
                    className={`setup-role-tab${roleMode === "new" ? " active" : ""}`}
                    onClick={() => {
                      setRoleMode("new");
                      setCodeError("");
                    }}
                  >
                    <Plus size={16} />
                    {t("setup.createNew")}
                  </button>
                </div>
              ) : null}

              {/* Existing role picker */}
              {roleMode === "existing" ? (
                <div className="setup-role-list">
                  {existingRoles.map((role) => (
                    <label
                      key={role.id}
                      className={`setup-role-option${selectedRoleId === role.id ? " selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="_roleSelect"
                        value={role.id}
                        checked={selectedRoleId === role.id}
                        onChange={() => setSelectedRoleId(role.id)}
                      />
                      <div className="setup-role-option-text">
                        <span className="setup-role-option-name">{role.name}</span>
                        <span className="setup-role-option-code">{role.code}</span>
                      </div>
                    </label>
                  ))}

                  {state.fieldErrors?.existingRoleId?.[0] ? (
                    <span className="field-error">{state.fieldErrors.existingRoleId[0]}</span>
                  ) : null}

                  <p className="muted small-text">{t("setup.roleAllPermissions")}</p>
                </div>
              ) : null}

              {/* New role form */}
              {roleMode === "new" ? (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="roleCode">
                      {t("setup.roleCode")}
                    </label>
                    <input
                      id="roleCode"
                      type="text"
                      value={roleCode}
                      onChange={(event) => {
                        setRoleCode(event.target.value);
                        setCodeError("");
                      }}
                      required
                      className="field-control"
                      placeholder="ADMIN"
                    />
                    {codeError ? (
                      <span className="field-error">{codeError}</span>
                    ) : state.fieldErrors?.roleCode?.[0] ? (
                      <span className="field-error">{state.fieldErrors.roleCode[0]}</span>
                    ) : null}
                  </div>

                  <div className="field">
                    <label className="field-label" htmlFor="roleName">
                      {t("setup.roleName")}
                    </label>
                    <input
                      id="roleName"
                      type="text"
                      value={roleName}
                      onChange={(event) => setRoleName(event.target.value)}
                      required
                      className="field-control"
                      placeholder="Administrátor"
                    />
                    {state.fieldErrors?.roleName?.[0] ? (
                      <span className="field-error">{state.fieldErrors.roleName[0]}</span>
                    ) : null}
                  </div>

                  <p className="muted small-text">{t("setup.roleAllPermissions")}</p>
                </>
              ) : null}

              <button type="button" className="login-button" onClick={handleNextStep}>
                {t("setup.next")}
                <ChevronRight size={18} style={{ marginLeft: 6 }} />
              </button>
            </>
          ) : null}

          {/* ─── Step 2: Admin user ───────────────────────── */}
          {step === 2 ? (
            <>
              <div className="setup-step-header">
                <User size={20} />
                <div>
                  <h2 className="setup-step-title">{t("setup.userTitle")}</h2>
                  <p className="muted small-text">{t("setup.userDescription")}</p>
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="email">
                  {t("auth.email")}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="field-control"
                  placeholder={t("auth.emailPlaceholder")}
                />
                {state.fieldErrors?.email?.[0] ? (
                  <span className="field-error">{state.fieldErrors.email[0]}</span>
                ) : null}
              </div>

              <div className="setup-name-row">
                <div className="field">
                  <label className="field-label" htmlFor="firstName">
                    {t("setup.firstName")}
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    required
                    className="field-control"
                  />
                  {state.fieldErrors?.firstName?.[0] ? (
                    <span className="field-error">{state.fieldErrors.firstName[0]}</span>
                  ) : null}
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="lastName">
                    {t("setup.lastName")}
                  </label>
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    required
                    className="field-control"
                  />
                  {state.fieldErrors?.lastName?.[0] ? (
                    <span className="field-error">{state.fieldErrors.lastName[0]}</span>
                  ) : null}
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="password">
                  {t("auth.password")}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="field-control"
                  placeholder={t("auth.passwordPlaceholder")}
                />
                <span className="field-description">{t("auth.newPasswordHint")}</span>
                {state.fieldErrors?.password?.[0] ? (
                  <span className="field-error">{state.fieldErrors.password[0]}</span>
                ) : null}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="passwordConfirm">
                  {t("auth.confirmPassword")}
                </label>
                <input
                  id="passwordConfirm"
                  name="passwordConfirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="field-control"
                  placeholder={t("auth.confirmPasswordPlaceholder")}
                />
                {state.fieldErrors?.passwordConfirm?.[0] ? (
                  <span className="field-error">{state.fieldErrors.passwordConfirm[0]}</span>
                ) : null}
              </div>

              <div className="setup-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setStep(1)}
                >
                  <ChevronLeft size={18} style={{ marginRight: 4 }} />
                  {t("setup.back")}
                </button>
                <button type="submit" className="login-button" disabled={isPending}>
                  {isPending ? t("setup.creating") : t("setup.finish")}
                </button>
              </div>
            </>
          ) : null}
        </form>
      </div>
    </div>
  );
}
