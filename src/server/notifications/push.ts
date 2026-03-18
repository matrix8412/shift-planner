import "server-only";

import webpush from "web-push";

import { listPushSubscriptionsForEmail, removePushSubscriptions } from "@/server/config/push-subscriptions";
import type { NotificationPushSettings } from "@/server/config/notification-settings";

type SendPushNotificationInput = {
  userEmail: string;
  title: string;
  message: string;
  actionUrl?: string;
  settings: NotificationPushSettings;
  tag?: string;
};

export async function sendPushNotification(input: SendPushNotificationInput) {
  if (!input.settings.vapidPublicKey || !input.settings.vapidPrivateKey) {
    throw new Error("Push notifications require VAPID public and private keys.");
  }

  webpush.setVapidDetails(input.settings.subject || "mailto:noreply@pohotovosti.sk", input.settings.vapidPublicKey, input.settings.vapidPrivateKey);

  const subscriptions = await listPushSubscriptionsForEmail(input.userEmail);
  if (subscriptions.length === 0) {
    return;
  }

  const staleEndpoints: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          JSON.stringify({
            title: input.title,
            body: input.message,
            url: input.actionUrl,
            tag: input.tag,
            icon: input.settings.iconUrl,
            badge: input.settings.badgeUrl,
          }),
        );
      } catch (error) {
        const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : undefined;

        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.push(subscription.endpoint);
          return;
        }

        throw error;
      }
    }),
  );

  if (staleEndpoints.length > 0) {
    await removePushSubscriptions(staleEndpoints);
  }
}
