import { describe, expect, it } from "vitest";
import { classifyScheduledReminder, fallbackReminderLabel } from "../src/lib/reminders";

describe("scheduled reminder classification", () => {
  it("maps UTC scheduled time to Beijing 09:30 daily review and breakfast actions", () => {
    expect(classifyScheduledReminder(new Date("2026-05-19T01:30:00.000Z"), "Asia/Shanghai")).toEqual({
      localDate: "2026-05-19",
      localTime: "09:30",
      actions: ["daily-review", "breakfast-reminder"]
    });
  });

  it("maps UTC scheduled time to Beijing lunch and dinner reminders", () => {
    expect(classifyScheduledReminder(new Date("2026-05-19T04:30:00.000Z"), "Asia/Shanghai").actions).toEqual(["lunch-reminder"]);
    expect(classifyScheduledReminder(new Date("2026-05-19T10:00:00.000Z"), "Asia/Shanghai").actions).toEqual(["dinner-reminder"]);
  });

  it("detects weekly review at Beijing Sunday 21:00", () => {
    expect(classifyScheduledReminder(new Date("2026-05-17T13:00:00.000Z"), "Asia/Shanghai").actions).toEqual(["weekly-review"]);
  });

  it("provides human labels for fallback logging", () => {
    expect(fallbackReminderLabel("breakfast")).toBe("早餐");
    expect(fallbackReminderLabel("lunch")).toBe("午餐");
    expect(fallbackReminderLabel("dinner")).toBe("晚餐");
  });
});
