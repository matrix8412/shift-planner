import { NextResponse } from "next/server";

import { destroySession } from "@/server/auth/session";

export async function POST(request: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", request.url));
}
