import { NextResponse } from "next/server";
import { z } from "zod";

import { removePushSubscription, upsertPushSubscription } from "@/server/config/push-subscriptions";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  userEmail: z.string().trim().email(),
  userName: z.string().trim().default(""),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = subscriptionSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid push subscription payload." }, { status: 400 });
    }

    await upsertPushSubscription(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected server error." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const json = await request.json();
    const parsed = unsubscribeSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid unsubscribe payload." }, { status: 400 });
    }

    await removePushSubscription(parsed.data.endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected server error." }, { status: 500 });
  }
}
