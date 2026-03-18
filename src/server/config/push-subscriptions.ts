import "server-only";

import { z } from "zod";

import { PUSH_SUBSCRIPTIONS_SETTING_KEY } from "@/server/config/managed-settings";
import { db } from "@/server/db/client";

const pushSubscriptionRecordSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  userEmail: z.string().trim().email(),
  userName: z.string().trim().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const pushSubscriptionStoreSchema = z.object({
  subscriptions: z.array(pushSubscriptionRecordSchema).default([]),
});

export type PushSubscriptionRecord = z.infer<typeof pushSubscriptionRecordSchema>;

const defaultPushSubscriptionStore = pushSubscriptionStoreSchema.parse({});

async function getPushSubscriptionStore() {
  let setting = null;

  try {
    setting = await db.appSetting.findUnique({
      where: {
        key: PUSH_SUBSCRIPTIONS_SETTING_KEY,
      },
    });
  } catch {
    return defaultPushSubscriptionStore;
  }

  if (!setting) {
    return defaultPushSubscriptionStore;
  }

  const parsed = pushSubscriptionStoreSchema.safeParse(setting.value);
  return parsed.success ? parsed.data : defaultPushSubscriptionStore;
}

async function savePushSubscriptionStore(store: z.infer<typeof pushSubscriptionStoreSchema>) {
  await db.appSetting.upsert({
    where: {
      key: PUSH_SUBSCRIPTIONS_SETTING_KEY,
    },
    update: {
      value: store,
    },
    create: {
      key: PUSH_SUBSCRIPTIONS_SETTING_KEY,
      value: store,
    },
  });
}

export async function listPushSubscriptionsForEmail(userEmail: string) {
  const store = await getPushSubscriptionStore();
  return store.subscriptions.filter((subscription) => subscription.userEmail.toLowerCase() === userEmail.toLowerCase());
}

export async function upsertPushSubscription(input: Omit<PushSubscriptionRecord, "createdAt" | "updatedAt">) {
  const store = await getPushSubscriptionStore();
  const now = new Date().toISOString();
  const existing = store.subscriptions.find((subscription) => subscription.endpoint === input.endpoint);
  const subscriptions = existing
    ? store.subscriptions.map((subscription) =>
        subscription.endpoint === input.endpoint
          ? { ...subscription, ...input, updatedAt: now }
          : subscription,
      )
    : [...store.subscriptions, { ...input, createdAt: now, updatedAt: now }];

  await savePushSubscriptionStore({
    subscriptions,
  });
}

export async function removePushSubscription(endpoint: string) {
  const store = await getPushSubscriptionStore();
  await savePushSubscriptionStore({
    subscriptions: store.subscriptions.filter((subscription) => subscription.endpoint !== endpoint),
  });
}

export async function removePushSubscriptions(endpoints: string[]) {
  const endpointSet = new Set(endpoints);
  const store = await getPushSubscriptionStore();
  await savePushSubscriptionStore({
    subscriptions: store.subscriptions.filter((subscription) => !endpointSet.has(subscription.endpoint)),
  });
}
