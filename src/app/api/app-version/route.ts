import { NextResponse } from "next/server";

import { APP_VERSION } from "@/generated/app-version";

export async function GET() {
  return NextResponse.json(
    { version: APP_VERSION },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
