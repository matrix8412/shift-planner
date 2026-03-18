import "server-only";

import { getNotificationSettings } from "@/server/config/notification-settings";
import { db } from "@/server/db/client";
import { sendEmailNotification } from "@/server/notifications/email";
import { sendPushNotification } from "@/server/notifications/push";
import { buildNotificationTemplateVariables, renderNotificationTemplate } from "@/server/notifications/template";

type NotificationRecipient = {
  userId?: string;
  email?: string;
  name?: string;
};

type DispatchNotificationInput = {
  recipients: NotificationRecipient[];
  title: string;
  message: string;
  actionUrl?: string;
  entityType?: string;
  entityLabel?: string;
  tag?: string;
  channels?: {
    email?: boolean;
    push?: boolean;
  };
  force?: boolean;
};

async function resolveRecipients(recipients: NotificationRecipient[]) {
  const ids = Array.from(new Set(recipients.map((recipient) => recipient.userId).filter((value): value is string => Boolean(value))));
  const usersById =
    ids.length > 0
      ? new Map(
          (
            await db.user.findMany({
              where: {
                id: {
                  in: ids,
                },
              },
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                notificationsEnabled: true,
              },
            })
          ).map((user) => [user.id, user] as const),
        )
      : new Map();

  return recipients
    .map((recipient) => {
      const user = recipient.userId ? usersById.get(recipient.userId) : undefined;
      const email = recipient.email ?? user?.email;
      const name = recipient.name ?? (user ? `${user.firstName} ${user.lastName}` : "Používateľ");
      const notificationsEnabled = user?.notificationsEnabled ?? true;

      if (!email) {
        return null;
      }

      return {
        email,
        name,
        notificationsEnabled,
      };
    })
    .filter((recipient): recipient is { email: string; name: string; notificationsEnabled: boolean } => Boolean(recipient));
}

export async function dispatchNotification(input: DispatchNotificationInput) {
  const settings = await getNotificationSettings();
  const recipients = await resolveRecipients(input.recipients);

  await Promise.all(
    recipients.map(async (recipient) => {
      if (!input.force && !recipient.notificationsEnabled) {
        return;
      }

      const variables = buildNotificationTemplateVariables({
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        title: input.title,
        message: input.message,
        actionUrl: input.actionUrl,
        appName: "Pohotovosti",
        channel: "email",
        entityType: input.entityType,
        entityLabel: input.entityLabel,
        emailSettings: settings.email,
      });

      if (input.channels?.email !== false && settings.email.enabled) {
        await sendEmailNotification({
          to: recipient.email,
          subject: renderNotificationTemplate(settings.email.subjectTemplate, variables),
          html: renderNotificationTemplate(settings.email.htmlTemplate, variables),
          text: renderNotificationTemplate(settings.email.textTemplate, variables),
          settings: settings.email,
        });
      }

      if (input.channels?.push !== false && settings.push.enabled) {
        await sendPushNotification({
          userEmail: recipient.email,
          title: input.title,
          message: input.message,
          actionUrl: input.actionUrl,
          settings: settings.push,
          tag: input.tag,
        });
      }
    }),
  );
}
