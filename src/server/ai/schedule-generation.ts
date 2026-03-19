import "server-only";

import type { ScheduleDraftInput, ScheduleDraftOutput } from "@/server/ai/contracts";
import { scheduleDraftOutputSchema } from "@/server/ai/contracts";

const systemPrompt = [
  "You generate employee shift schedules.",
  "Always obey these hard constraints:",
  "1. Return JSON only with keys summary and events.",
  "2. Every event must contain date, userId and shiftTypeId.",
  "3. Use only user ids and shift type ids present in the input.",
  "4. A generated shift type must be assigned to the selected user.",
  "5. Respect shift validity day types, holiday dates, approved vacations and locked entries.",
  "6. Locked entries are fixed, already-assigned shifts in the current period. Do not change, duplicate or omit them. Treat every locked entry as an occupied slot — evaluate all conditions as if locked entries and your generated events form a single combined schedule.",
  "7. Prefer balanced distribution across users when the conditions do not say otherwise.",
  "8. Use historicalAssignments as fairness context so recent similar shifts are distributed more fairly.",
  "9. Do not invent missing users, shifts, services, rules or dates.",
].join("\n");

export function buildScheduleGenerationPrompt(input: ScheduleDraftInput) {
  return [
    "Generate a shift schedule for the requested period.",
    "Return only valid JSON in this shape:",
    '{"summary":"short optional summary","events":[{"date":"YYYY-MM-DD","userId":"...","shiftTypeId":"...","note":"optional"}]}',
    "If some dates cannot be assigned while respecting hard constraints, omit those events and mention the gap in summary.",
    "The field fairnessLookbackDays tells you how many days before startDate are included in historicalAssignments for fair scheduling.",
    "The field lockedEntries contains already-confirmed shifts in the current period that MUST remain. Do not duplicate them in your output. Treat them as occupied slots when evaluating conditions — your generated events combined with locked entries must satisfy all conditions together.",
    "",
    "Input data:",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

export function getScheduleGenerationSystemPrompt() {
  return systemPrompt;
}

function extractJsonPayload(content: string) {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new Error("AI response did not contain valid JSON.");
  }
}

export function parseScheduleGenerationResponse(content: string): ScheduleDraftOutput {
  const parsedJson = extractJsonPayload(content);
  const parsed = scheduleDraftOutputSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error("AI response has an invalid schedule structure.");
  }

  return parsed.data;
}
