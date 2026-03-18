import { NextResponse } from "next/server";

import { destroySession } from "@/server/auth/session";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? "http://localhost:3000"));
}
