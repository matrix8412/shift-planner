"use client";

import { useId, useState, type ReactNode } from "react";

import { useI18n } from "@/i18n/context";

type SettingsTabId = "appearance" | "notifications" | "ai" | "https";

type SettingsTab = {
  id: SettingsTabId;
  labelKey: string;
  content: ReactNode;
};

type SettingsTabsProps = {
  appearanceContent: ReactNode;
  notificationsContent: ReactNode;
  aiContent: ReactNode;
  httpsContent: ReactNode;
};

const tabsMeta: Omit<SettingsTab, "content">[] = [
  {
    id: "appearance",
    labelKey: "settingsTabs.appearance",
  },
  {
    id: "notifications",
    labelKey: "settingsTabs.notifications",
  },
  {
    id: "ai",
    labelKey: "settingsTabs.ai",
  },
  {
    id: "https",
    labelKey: "settingsTabs.https",
  },
];

export function SettingsTabs({ appearanceContent, notificationsContent, aiContent, httpsContent }: SettingsTabsProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("appearance");
  const tabListId = useId();

  const tabs: SettingsTab[] = [
    { ...tabsMeta[0], content: appearanceContent },
    { ...tabsMeta[1], content: notificationsContent },
    { ...tabsMeta[2], content: aiContent },
    { ...tabsMeta[3], content: httpsContent },
  ];

  const activeTabMeta = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const activePanelId = `${tabListId}-${activeTabMeta.id}-panel`;

  return (
    <div className="settings-tabs stack">
      <section className="card settings-tabs-header">
        <div className="settings-tab-strip" role="tablist" aria-label={t("settingsTabs.ariaLabel")}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            const tabId = `${tabListId}-${tab.id}-tab`;
            const panelId = `${tabListId}-${tab.id}-panel`;

            return (
              <button
                key={tab.id}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId}
                className={`settings-tab-button${isActive ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
      </section>

      <div id={activePanelId} role="tabpanel" aria-labelledby={`${tabListId}-${activeTabMeta.id}-tab`} className="settings-tab-panel">
        {activeTabMeta.content}
      </div>
    </div>
  );
}
