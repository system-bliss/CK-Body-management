import { describe, expect, it } from "vitest";
import {
  detectMealType,
  localDate,
  parseBodyDataText,
  parseMeasurementText,
  recordDateForText,
  summarizeBodyDataPatch,
  previousLocalDate,
  weekRangeFor
} from "../src/lib/records";

describe("text record helpers", () => {
  it("detects meal type from Chinese meal keywords", () => {
    expect(detectMealType("早餐：两个鸡蛋，一杯拿铁")).toBe("breakfast");
    expect(detectMealType("午饭吃了牛肉饭")).toBe("lunch");
    expect(detectMealType("晚餐：沙拉和鸡胸肉")).toBe("dinner");
  });

  it("extracts weight and body fat measurements", () => {
    const measurements = parseMeasurementText("今天体重 72.4kg，体脂 18.5%，腰围 82cm");

    expect(measurements).toEqual({
      weightKg: 72.4,
      bodyFatPercent: 18.5,
      waistCm: 82
    });
  });

  it("extracts age height and weight from natural Chinese body data", () => {
    const patch = parseBodyDataText("我 28 岁，身高 175，性别男，今天体重 72.4kg");

    expect(patch.profile).toEqual({ age: 28, heightCm: 175, gender: "male" });
    expect(patch.measurements).toEqual({ weightKg: 72.4 });
  });

  it("summarizes recognized profile and measurement data for Telegram replies", () => {
    const summary = summarizeBodyDataPatch(parseBodyDataText("今早空腹体重 72kg身高176CM，年龄26岁，性别男"));

    expect(summary).toContain("已更新基础资料");
    expect(summary).toContain("年龄 26 岁");
    expect(summary).toContain("身高 176 cm");
    expect(summary).toContain("性别 男");
    expect(summary).toContain("已记录身体数据：体重 72 kg");
  });

  it("keeps optional body measurements without requiring them", () => {
    const patch = parseBodyDataText("体脂 18.5%，腰围 82cm");

    expect(patch.profile).toEqual({});
    expect(patch.measurements).toEqual({ bodyFatPercent: 18.5, waistCm: 82 });
  });

  it("does not mistake meal calories for body profile data", () => {
    const patch = parseBodyDataText("午餐 570 kcal，蛋白质 52g");

    expect(patch.profile).toEqual({});
    expect(patch.measurements).toEqual({});
  });

  it("calculates local yesterday and week ranges in the configured timezone", () => {
    const date = new Date("2026-05-19T01:30:00.000Z");

    expect(localDate("Asia/Shanghai", date)).toBe("2026-05-19");
    expect(previousLocalDate("Asia/Shanghai", date)).toBe("2026-05-18");
    expect(weekRangeFor("Asia/Shanghai", new Date("2026-05-17T13:00:00.000Z"))).toEqual({
      start: "2026-05-11",
      end: "2026-05-17"
    });
  });

  it("detects whether a natural-language record belongs to today or yesterday", () => {
    const date = new Date("2026-05-19T14:30:00.000Z");

    expect(recordDateForText("今日运动：步行5600步", "Asia/Shanghai", date)).toBe("2026-05-19");
    expect(recordDateForText("昨天运动：步行5600步", "Asia/Shanghai", date)).toBe("2026-05-18");
    expect(recordDateForText("补昨天的运动，健腹轮120个", "Asia/Shanghai", date)).toBe("2026-05-18");
    expect(recordDateForText("昨晚深蹲100个", "Asia/Shanghai", date)).toBe("2026-05-18");
  });
});
