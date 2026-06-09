import { NextResponse } from "next/server";

import { destroySession } from "@/server/auth/session";
import { env } from "@/server/config/env";

export async function POST(request: Request) {
  await destroySession();
  const appUrl = new URL(env.APP_URL);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? appUrl.host;
  const protocol = forwardedProto ?? appUrl.protocol.replace(":", "");

  return NextResponse.redirect(new URL("/login", `${protocol}://${host}`));
}
