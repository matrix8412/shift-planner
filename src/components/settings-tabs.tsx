"use client";

import { useId, useState, type ReactNode } from "react";

import { useI18n } from "@/i18n/context";

type SettingsTabId = "system" | "appearance" | "notifications" | "ai";

type SettingsTab = {
  id: SettingsTabId;
  labelKey: string;
  content: ReactNode;
};

type SettingsTabsProps = {
  systemContent: ReactNode;
  appearanceContent: ReactNode;
  notificationsContent: ReactNode;
  aiContent: ReactNode;
};

const tabsMeta: Omit<SettingsTab, "content">[] = [
  {
    id: "system",
    labelKey: "settingsTabs.system",
  },
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
];

export function SettingsTabs({ systemContent, appearanceContent, notificationsContent, aiContent }: SettingsTabsProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("system");
  const tabListId = useId();

  const tabs: SettingsTab[] = [
    { ...tabsMeta[0], content: systemContent },
    { ...tabsMeta[1], content: appearanceContent },
    { ...tabsMeta[2], content: notificationsContent },
    { ...tabsMeta[3], content: aiContent },
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
