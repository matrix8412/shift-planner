import { ensurePermissionCatalog } from "@/server/auth/permissions";
import { db } from "@/server/db/client";

async function main() {
  await ensurePermissionCatalog();
}

main()
  .catch((error) => {
    console.error("[permissions:sync]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
