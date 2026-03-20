import { db } from "@/server/db/client";
import { env } from "@/server/config/env";

const NAGER_API_BASE = "https://date.nager.at/api/v3/PublicHolidays";

type NagerHoliday = {
  date: string;
  name: string;
  localName: string;
  countryCode: string;
};

function parseUtcDate(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

async function fetchCountryHolidays(country: string, year: number): Promise<NagerHoliday[]> {
  const url = `${NAGER_API_BASE}/${year}/${country}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 404) {
    console.warn(`[worker] holiday sync: no data for ${country}/${year} (404)`);
    return [];
  }

  if (!response.ok) {
    throw new Error(`Nager.Date API responded ${response.status} for ${country}/${year}`);
  }

  const data = await response.json();
  return data as NagerHoliday[];
}

export async function runHolidaySync() {
  console.log("[worker] holiday sync started");

  const countries = env.HOLIDAY_COUNTRIES
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  const nowYear = new Date().getUTCFullYear();
  const years = [nowYear, nowYear + 1];

  let upserted = 0;
  let errors = 0;

  for (const country of countries) {
    for (const year of years) {
      try {
        const holidays = await fetchCountryHolidays(country, year);

        for (const holiday of holidays) {
          const date = parseUtcDate(holiday.date);
          await db.holiday.upsert({
            where: { date },
            create: {
              date,
              country: holiday.countryCode,
              name: holiday.name,
              localName: holiday.localName || null,
            },
            update: {
              name: holiday.name,
              localName: holiday.localName || null,
              country: holiday.countryCode,
            },
          });
          upserted++;
        }

        console.log(`[worker] holiday sync: ${country}/${year} → ${holidays.length} holidays synced`);
      } catch (error) {
        errors++;
        console.error(`[worker] holiday sync failed for ${country}/${year}:`, error);
      }
    }
  }

  console.log(`[worker] holiday sync finished (upserted=${upserted}, errors=${errors})`);
}
