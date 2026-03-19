import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { AppNav } from "@/components/app-nav";
import { AppVersionChecker } from "@/components/app-version-checker";
import { BrowserNotificationProvider } from "@/components/browser-notification-provider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { I18nProvider } from "@/i18n/context";
import { getServerLocale } from "@/i18n";
import { getCurrentUser } from "@/server/auth";
import { getVisibleRoutes } from "@/server/auth/module-access";
import { getShellProfile } from "@/server/config/app-shell";
import { getBrowserNotificationSettings } from "@/server/config/browser-notifications";
import { isSetupRequired } from "@/server/actions/setup";

import "./globals.css";

/**
 * Inline script that runs synchronously before the first paint.
 * Reads the theme from localStorage (or prefers-color-scheme) and sets
 * `data-theme` + `color-scheme` on <html> so the correct CSS variables
 * are active from the very first frame – no white flash on navigation.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("pohotovosti.theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})()`;

export const metadata: Metadata = {
  title: "Pohotovosti",
  description: "Clean rewrite of the on-call scheduling system without Firebase.",
  applicationName: "Pohotovosti",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pohotovosti",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0d6b73",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [currentUser, locale, browserNotificationSettings] = await Promise.all([
    getCurrentUser(),
    getServerLocale(),
    getBrowserNotificationSettings(),
  ]);

  // Redirect to setup wizard when no users exist (skip if already on /setup)
  if (!currentUser) {
    const headersList = await headers();
    const pathname = headersList.get("x-next-pathname") ?? "";
    const needsSetup = await isSetupRequired();

    if (needsSetup && !pathname.startsWith("/setup")) {
      redirect("/setup");
    }
  }

  // If no user session (login pages, bootstrap), render without the app shell
  if (!currentUser) {
    return (
      <html lang={locale} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        </head>
        <body>
          <I18nProvider locale={locale}>
            <ServiceWorkerRegistration />
            <BrowserNotificationProvider settings={browserNotificationSettings}>
              <AppVersionChecker />
              {children}
            </BrowserNotificationProvider>
          </I18nProvider>
        </body>
      </html>
    );
  }

  const shellProfile = await getShellProfile(currentUser.id);
  const allowedRoutes = getVisibleRoutes(currentUser);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <ServiceWorkerRegistration />
          <BrowserNotificationProvider settings={browserNotificationSettings}>
            <AppVersionChecker />
            <div className="app-layout">
              <AppNav profile={shellProfile} allowedRoutes={allowedRoutes} />
              <div className="app-main-shell">
                <main className="app-main">{children}</main>
              </div>
            </div>
          </BrowserNotificationProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
