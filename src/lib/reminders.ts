import type { ReminderType } from "../types";
import { localDate, localTime } from "./records";

export type ScheduledAction = "daily-review" | "breakfast-reminder" | "lunch-reminder" | "dinner-reminder" | "weekly-review";

export interface ScheduledReminderDecision {
  localDate: string;
  localTime: string;
  actions: ScheduledAction[];
}

export function classifyScheduledReminder(date: Date, timeZone = "Asia/Shanghai"): ScheduledReminderDecision {
  const currentLocalDate = localDate(timeZone, date);
  const currentLocalTime = localTime(timeZone, date);
  const actions: ScheduledAction[] = [];

  if (currentLocalTime === "09:30") actions.push("daily-review", "breakfast-reminder");
  if (currentLocalTime === "12:30") actions.push("lunch-reminder");
  if (currentLocalTime === "18:00") actions.push("dinner-reminder");
  if (currentLocalTime === "21:00" && weekday(timeZone, date) === "Sun") actions.push("weekly-review");

  return {
    localDate: currentLocalDate,
    localTime: currentLocalTime,
    actions
  };
}

export function reminderTypeForAction(action: ScheduledAction): ReminderType | null {
  if (action === "breakfast-reminder") return "breakfast";
  if (action === "lunch-reminder") return "lunch";
  if (action === "dinner-reminder") return "dinner";
  return null;
}

export function fallbackReminderLabel(type: ReminderType): string {
  return ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐" } as const)[type];
}

function weekday(timeZone: string, date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
}
