"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Camera,
  Cog,
  Languages,
  LogOut,
  Menu,
  Moon,
  Pencil,
  Plane,
  ShieldCheck,
  SlidersHorizontal,
  SunMedium,
  UserCog,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/context";
import { LOCALES, LOCALE_LABELS } from "@/i18n/types";
import type { Locale } from "@/i18n/types";
import { updateProfileAction } from "@/server/actions/auth";
import type { AuthActionState } from "@/server/actions/auth";

type AppNavProps = {
  profile: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl: string | null;
    preferredTheme: string | null;
    preferredLocale: string | null;
  };
  allowedRoutes?: string[];
};

type AppTheme = "light" | "dark";

const themeStorageKey = "pohotovosti.theme";

const sectionDefs = [
  {
    labelKey: "nav.sectionMain",
    items: [
      { href: "/schedule", labelKey: "nav.schedule", icon: CalendarDays },
      { href: "/vacations", labelKey: "nav.vacations", icon: Plane },
    ],
  },
  {
    labelKey: "nav.sectionAdmin",
    items: [
      { href: "/services", labelKey: "nav.services", icon: Cog },
      { href: "/shifts", labelKey: "nav.shifts", icon: SlidersHorizontal },
      { href: "/conditions", labelKey: "nav.conditions", icon: ShieldCheck },
      { href: "/holidays", labelKey: "nav.holidays", icon: SunMedium },
    ],
  },
  {
    labelKey: "nav.sectionSettings",
    items: [
      { href: "/settings", labelKey: "nav.settings", icon: Cog },
      { href: "/users", labelKey: "nav.users", icon: Users },
      { href: "/roles", labelKey: "nav.roles", icon: UserCog },
    ],
  },
];

function isLinkActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsFromName(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function resolveInitialTheme(): AppTheme {
  const stored = window.localStorage.getItem(themeStorageKey);

  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AppNav({ profile, allowedRoutes }: AppNavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<AppTheme>("light");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const { t, locale, setLocale } = useI18n();
  const [profileState, profileAction, profilePending] = useActionState<AuthActionState, FormData>(updateProfileAction, {});
  const visibleRouteSet = new Set(allowedRoutes ?? sectionDefs.flatMap((section) => section.items.map((item) => item.href)));
  const visibleSections = sectionDefs
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => visibleRouteSet.has(item.href)),
    }))
    .filter((section) => section.items.length > 0);
  const brandHref = visibleSections[0]?.items[0]?.href ?? "/";

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const initialTheme = resolveInitialTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  // Close profile menu on outside click
  useEffect(() => {
    if (!profileMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [profileMenuOpen]);

  function toggleTheme() {
    const nextTheme: AppTheme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(themeStorageKey, nextTheme);
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("userId", profile.id);
      const res = await fetch("/api/avatars/upload", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setAvatarPreview(data.avatarUrl);
      }
    } finally {
      setUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  return (
    <>
      <div className="app-mobile-bar">
        <Link href={brandHref} className="sidebar-brand mobile">
          <span className="brand-mark">K</span>
          <span>Pohotovosti</span>
        </Link>
        <button type="button" className="icon-button mobile-nav-toggle" onClick={() => setMobileOpen((current) => !current)} aria-label={t("nav.toggleMenu")}>
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen ? <button type="button" className="sidebar-backdrop" aria-label={t("nav.closeMenu")} onClick={() => setMobileOpen(false)} /> : null}

      <aside className={`app-sidebar${mobileOpen ? " mobile-open" : ""}`}>
        <div className="sidebar-top">
          <Link href={brandHref} className="sidebar-brand">
            <span className="brand-mark">K</span>
            <span>Pohotovosti</span>
          </Link>

          <nav className="sidebar-nav" aria-label={t("nav.mainNav")}>
            {visibleSections.map((section) => (
              <div key={section.labelKey} className="sidebar-section">
                <p className="sidebar-section-label">{t(section.labelKey)}</p>
                <div className="sidebar-links">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isLinkActive(pathname, item.href);

                    return (
                      <Link key={item.href} href={item.href} className={`sidebar-link${active ? " active" : ""}`}>
                        <Icon size={18} />
                        <span>{t(item.labelKey)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={t("nav.toggleTheme")}>
            {theme === "dark" ? <SunMedium size={18} /> : <Moon size={18} />}
            {theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
          </button>

          <div className="locale-switcher">
            <Languages size={18} />
            {LOCALES.map((loc) => (
              <button
                key={loc}
                type="button"
                className={`locale-option${loc === locale ? " active" : ""}`}
                onClick={() => setLocale(loc as Locale)}
              >
                {LOCALE_LABELS[loc as Locale]}
              </button>
            ))}
          </div>

          <div className="profile-card-wrapper" ref={profileMenuRef}>
            <button type="button" className="profile-card" onClick={() => setProfileMenuOpen((v) => !v)}>
              <div className="profile-avatar">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="profile-avatar-img" />
                ) : (
                  initialsFromName(profile.name)
                )}
              </div>
              <div className="stack-tight">
                <strong>{profile.name}</strong>
                <span>{profile.email}</span>
              </div>
            </button>

            {profileMenuOpen ? (
              <div className="profile-menu" role="menu">
                <button
                  type="button"
                  className="profile-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setProfileSheetOpen(true);
                  }}
                >
                  <Pencil size={16} />
                  {t("profile.editProfile")}
                </button>
                <form action="/api/auth/logout" method="POST">
                  <button type="submit" className="profile-menu-item" role="menuitem">
                    <LogOut size={16} />
                    {t("nav.logout")}
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {profileSheetOpen ? (
        <div className="sheet-layer" role="presentation">
          <button type="button" className="sheet-backdrop" aria-label={t("profile.close")} onClick={() => setProfileSheetOpen(false)} />
          <aside className="sheet-panel profile-sheet" aria-modal="true" role="dialog" aria-labelledby="profile-sheet-title">
            <div className="sheet-header">
              <div className="stack-tight">
                <p className="eyebrow">{t("profile.title")}</p>
                <h2 id="profile-sheet-title">{profile.name}</h2>
                <p className="muted">{t("profile.description")}</p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setProfileSheetOpen(false)}>
                {t("entity.close")}
              </button>
            </div>

            <div className="profile-sheet-avatar-section">
              <div className="profile-avatar profile-avatar-lg">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="profile-avatar-img" />
                ) : (
                  initialsFromName(profile.name)
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="user"
                hidden
                onChange={handleAvatarChange}
              />
              <button
                type="button"
                className="button secondary"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploading}
              >
                <Camera size={16} />
                {uploading ? t("profile.uploading") : t("profile.uploadPhoto")}
              </button>
            </div>

            {profileState.error ? <p className="field-error">{profileState.error}</p> : null}
            {profileState.success ? <p className="field-success">{profileState.success}</p> : null}

            <form action={profileAction} className="sheet-form">
              <label className="field">
                <span className="field-label">{t("profile.fieldFirstName")}</span>
                <input
                  name="firstName"
                  type="text"
                  className="field-control"
                  defaultValue={profile.firstName}
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">{t("profile.fieldLastName")}</span>
                <input
                  name="lastName"
                  type="text"
                  className="field-control"
                  defaultValue={profile.lastName}
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">{t("profile.fieldTheme")}</span>
                <select name="preferredTheme" className="field-control" defaultValue={profile.preferredTheme ?? ""}>
                  <option value="">{t("profile.themeAuto")}</option>
                  <option value="light">{t("profile.themeLight")}</option>
                  <option value="dark">{t("profile.themeDark")}</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">{t("profile.fieldLocale")}</span>
                <select name="preferredLocale" className="field-control" defaultValue={profile.preferredLocale ?? ""}>
                  <option value="">{t("profile.localeAuto")}</option>
                  {LOCALES.map((loc) => (
                    <option key={loc} value={loc}>
                      {LOCALE_LABELS[loc as Locale]}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" className="button" disabled={profilePending}>
                {profilePending ? t("entity.saving") : t("profile.save")}
              </button>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  );
}
