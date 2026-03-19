const LEGACY_INSTALL_BANNER_SETTING_KEY = "ui.installBanner";
export const AI_SETTINGS_KEY = "ai.runtime";
export const AI_AUDIT_RETENTION_DAYS_SETTING_KEY = "ai.auditRetentionDays";
export const NOTIFICATION_SETTINGS_KEY = "ui.notifications";
export const BROWSER_NOTIFICATION_SETTINGS_KEY = "ui.notifications";
export const PUSH_SUBSCRIPTIONS_SETTING_KEY = "notifications.pushSubscriptions";

const managedSettingKeys = new Set([LEGACY_INSTALL_BANNER_SETTING_KEY, AI_SETTINGS_KEY, AI_AUDIT_RETENTION_DAYS_SETTING_KEY, BROWSER_NOTIFICATION_SETTINGS_KEY, NOTIFICATION_SETTINGS_KEY, PUSH_SUBSCRIPTIONS_SETTING_KEY]);

export function isManagedSettingKey(key: string) {
  return managedSettingKeys.has(key);
}
