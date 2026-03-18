"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  Cog,
  Languages,
  LogOut,
  Menu,
  Moon,
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

type AppNavProps = {
  profile: {
    name: string;
    email: string;
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
  const { t, locale, setLocale } = useI18n();
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

  function toggleTheme() {
    const nextTheme: AppTheme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(themeStorageKey, nextTheme);
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

          <div className="profile-card">
            <div className="profile-avatar">{initialsFromName(profile.name)}</div>
            <div className="stack-tight">
              <strong>{profile.name}</strong>
              <span>{profile.email}</span>
            </div>
          </div>

          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="theme-toggle" style={{ width: "100%" }}>
              <LogOut size={18} />
              {t("nav.logout")}
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
