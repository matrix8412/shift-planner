import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { db } from "@/server/db/client";

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const userId = formData.get("userId") as string | null;

  if (!file || !userId) {
    return NextResponse.json({ error: "Missing file or userId" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = `data:${file.type};base64,${buffer.toString("base64")}`;

  await db.user.update({
    where: { id: userId },
    data: { avatarUrl: base64 },
  });

  return NextResponse.json({ avatarUrl: base64 });
}
