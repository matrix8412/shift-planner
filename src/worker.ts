import "dotenv/config";

import cron from "node-cron";

import { runHolidaySync } from "@/server/jobs/holiday-sync";
import { runReminderSweep } from "@/server/jobs/reminders";

async function boot() {
  console.log("[worker] boot");

  cron.schedule("*/1 * * * *", async () => {
    await runReminderSweep();
  });

  cron.schedule("15 1 * * *", async () => {
    await runHolidaySync();
  });
}

boot().catch((error) => {
  console.error("[worker] fatal error", error);
  process.exit(1);
});
