import { describe, expect, it } from "vitest";
import { renderDashboardPage } from "../src/lib/dashboard";
import type { DashboardData } from "../src/types";

function dashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    profile: { age: 28, heightCm: 175 },
    today: {
      date: "2026-05-19",
      caloriesKcal: 570,
      proteinG: 52,
      exerciseCaloriesKcal: 0,
      mealCount: 1,
      hasBreakfast: false,
      hasLunch: true,
      hasDinner: false
    },
    meals: [{ log_date: "2026-05-19", meal_type: "lunch", calories_kcal: 570, protein_g: 52, summary: "米饭、鱼块、蔬菜" }],
    exercises: [],
    measurements: [{ measured_at: "2026-05-19 09:20:00", weight_kg: 72.4, body_fat_percent: null, waist_cm: null }],
    estimates: [],
    reports: [{ report_type: "daily", period_start: "2026-05-18", content: "昨日蛋白质不错，今天继续稳定记录。", created_at: "2026-05-19 09:30:00" }],
    ...overrides
  };
}

describe("dashboard rendering", () => {
  it("renders coach-first status with profile and today summary", () => {
    const html = renderDashboardPage(dashboardData());

    expect(html).toContain("今日状态");
    expect(html).toContain("570 kcal");
    expect(html).toContain("52 g");
    expect(html).toContain("28 岁");
    expect(html).toContain("175 cm");
    expect(html).toContain("72.4 kg");
    expect(html).toContain("今日节奏");
    expect(html).toContain('/api/dashboard/logout');
    expect(html).toContain('class="app-header"');
    expect(html).toContain('class="status-panel"');
    expect(html).toContain('class="logout-link"');
    expect(html).toContain('class="meal-segments"');
    expect(html).toContain('class="rhythm-row"');
    expect(html).not.toContain("margin:-24px");
  });

  it("hides optional body-fat and waist values when missing", () => {
    const html = renderDashboardPage(dashboardData());

    expect(html).not.toContain("null%");
    expect(html).not.toContain("null cm");
  });

  it("renders refined tables reports photos and contextual empty states", () => {
    const html = renderDashboardPage(
      dashboardData({
        exercises: [],
        measurements: [],
        estimates: [{ photo_r2_key: "telegram/1/lunch.jpg", created_at: "2026-05-19 12:17:00" }],
        reports: [{ report_type: "weekly", period_start: "2026-05-18", content: "本周记录开始稳定。\n继续保持。", created_at: "2026-05-19 09:30:00" }]
      })
    );

    expect(html).toContain('class="num"');
    expect(html).toContain("还未记录体重数据，发「体重70kg」到 bot 即可");
    expect(html).toContain("暂无运动记录");
    expect(html).toContain('class="report-head"');
    expect(html).toContain('class="date-badge"');
    expect(html).toContain('class="report-body"');
    expect(html).toContain('class="photo-thumb"');
  });

  it("keeps overflow meal counts readable instead of showing impossible fractions", () => {
    const html = renderDashboardPage(
      dashboardData({
        today: {
          date: "2026-05-19",
          caloriesKcal: 2506,
          proteinG: 195,
          exerciseCaloriesKcal: 0,
          mealCount: 6,
          hasBreakfast: true,
          hasLunch: true,
          hasDinner: false
        }
      })
    );

    expect(html).toContain("6 餐");
    expect(html).toContain("2/3 完成");
    expect(html).not.toContain("6/3");
  });
});
