import { JobStatus } from "@prisma/client";

import { db } from "@/server/db/client";
import { dispatchNotification } from "@/server/notifications";

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatScheduleDate(date: Date): string {
  return new Intl.DateTimeFormat("sk-SK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export async function runReminderSweep() {
  console.log("[worker] reminder sweep started");

  const today = toUtcMidnight(new Date());

  // All active users who want shift reminders
  const users = await db.user.findMany({
    where: {
      isActive: true,
      notificationsEnabled: true,
      notificationDays: { gt: 0 },
    },
    select: {
      id: true,
      notificationDays: true,
    },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const targetDate = toUtcMidnight(addDays(today, user.notificationDays));
    const nextDay = addDays(targetDate, 1);

    const entries = await db.scheduleEntry.findMany({
      where: {
        userId: user.id,
        date: { gte: targetDate, lt: nextDay },
      },
      select: {
        id: true,
        date: true,
        shiftType: {
          select: { name: true, startsAt: true, endsAt: true, crossesMidnight: true },
        },
        service: {
          select: { name: true },
        },
      },
    });

    for (const entry of entries) {
      const jobType = `reminder:shift:${entry.id}`;

      // Skip if a successful reminder was already dispatched for this entry
      const alreadySent = await db.jobRun.findFirst({
        where: { jobType, status: JobStatus.SUCCEEDED },
        select: { id: true },
      });

      if (alreadySent) {
        skipped++;
        continue;
      }

      // Create a tracking record before attempting delivery
      const jobRun = await db.jobRun.create({
        data: {
          jobType,
          status: JobStatus.RUNNING,
          scheduledFor: new Date(),
          startedAt: new Date(),
          attempts: 1,
          payload: { entryId: entry.id, userId: user.id },
        },
      });

      const dateLabel = formatScheduleDate(entry.date);
      const timeLabel = entry.shiftType.crossesMidnight
        ? `${entry.shiftType.startsAt}–${entry.shiftType.endsAt} (+1 deň)`
        : `${entry.shiftType.startsAt}–${entry.shiftType.endsAt}`;

      try {
        await dispatchNotification({
          recipients: [{ userId: user.id }],
          title: "Pripomienka služby",
          message: `Máte naplánovanú službu ${entry.service.name} – ${entry.shiftType.name} (${timeLabel}) dňa ${dateLabel}.`,
          actionUrl: "/schedule",
          entityType: "schedule",
          tag: `reminder-shift-${entry.id}`,
        });

        await db.jobRun.update({
          where: { id: jobRun.id },
          data: { status: JobStatus.SUCCEEDED, finishedAt: new Date() },
        });

        sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[worker] reminder failed for entry ${entry.id}:`, message);

        await db.jobRun.update({
          where: { id: jobRun.id },
          data: { status: JobStatus.FAILED, finishedAt: new Date(), error: message },
        });

        failed++;
      }
    }
  }

  console.log(`[worker] reminder sweep finished (sent=${sent}, skipped=${skipped}, failed=${failed})`);
}
