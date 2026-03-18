import { z } from "zod";

export const scheduleDraftEventSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format."),
  userId: z.string().trim().min(1, "User id is required."),
  shiftTypeId: z.string().trim().min(1, "Shift type id is required."),
  note: z.string().trim().max(1000, "Note is too long.").optional(),
});

export const scheduleDraftOutputSchema = z.object({
  summary: z.string().trim().max(4000, "Summary is too long.").optional(),
  events: z.array(scheduleDraftEventSchema),
});

export type ScheduleDraftInput = {
  startDate: string;
  endDate: string;
  fairnessLookbackDays: number;
  calendarDays: Array<{
    date: string;
    weekday: string;
    dayType: string;
    isHoliday: boolean;
    holidayName?: string;
  }>;
  users: Array<{
    id: string;
    name: string;
    assignedShiftTypeIds: string[];
  }>;
  shiftTypes: Array<{
    id: string;
    serviceId: string;
    serviceName: string;
    name: string;
    startsAt: string;
    endsAt: string;
    crossesMidnight: boolean;
    validDayTypes: string[];
  }>;
  conditions: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    priority: number;
  }>;
  holidays: Array<{
    date: string;
    name: string;
    country: string;
  }>;
  vacations: Array<{
    userId: string;
    userName: string;
    startDate: string;
    endDate: string;
    notes?: string;
  }>;
  lockedEntries: Array<{
    date: string;
    userId: string;
    shiftTypeId: string;
    note?: string;
  }>;
  historicalAssignments: Array<{
    date: string;
    weekdayNumber: number;
    userId: string;
    shiftTypeId: string;
  }>;
};

export type ScheduleDraftOutput = z.infer<typeof scheduleDraftOutputSchema>;

export interface AiProvider {
  name: "openai" | "anthropic" | "gemini";
  generateScheduleDraft(input: ScheduleDraftInput): Promise<ScheduleDraftOutput>;
}
