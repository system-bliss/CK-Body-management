import { describe, expect, it } from "vitest";
import {
  buildDailyReview,
  buildDailyReviewData,
  buildWeeklyReviewData,
  getDashboardData,
  getProfile,
  reserveTelegramUpdate,
  saveProfilePatch,
  saveReport
} from "../src/lib/repository";
import type { Env } from "../src/types";

interface QueryCall {
  sql: string;
  binds: unknown[];
}

function createDashboardDb() {
  const calls: QueryCall[] = [];
  const mealRow = {
    log_date: "2026-05-18",
    meal_type: "lunch",
    calories_kcal: 520,
    protein_g: 32,
    summary: "fish lunch"
  };
  const exerciseRow = {
    log_date: "2026-05-18",
    minutes: 35,
    calories_kcal: 220,
    summary: "力量训练"
  };
  const measurementRow = {
    measured_at: "2026-05-18 09:00:00",
    weight_kg: 72.4,
    body_fat_percent: null,
    waist_cm: null
  };
  const estimateRow = {
    estimate_json: JSON.stringify({
      entryType: "meal",
      mealType: "lunch",
      items: [{ name: "fish", amount: "1 serving" }],
      totalCaloriesKcal: 520,
      totalProteinG: 32,
      confidence: "medium",
      estimated: true
    })
  };

  const db = {
    prepare(sql: string) {
      const call: QueryCall = { sql, binds: [] };
      calls.push(call);
      const statement = {
        bind(...values: unknown[]) {
          call.binds = values;
          return statement;
        },
        async all<T>() {
          const allUsers = !call.binds.includes("self");
          const ownerOnly = call.binds[0] === "123456";

          if (sql.includes("FROM meal_entries")) {
            return { results: allUsers || ownerOnly ? ([mealRow] as T[]) : [] };
          }

          if (sql.includes("FROM exercise_entries")) {
            return { results: allUsers || ownerOnly ? ([exerciseRow] as T[]) : [] };
          }

          if (sql.includes("FROM measurements")) {
            return { results: allUsers || ownerOnly ? ([measurementRow] as T[]) : [] };
          }

          if (sql.includes("SELECT estimate_json FROM ai_estimates")) {
            return { results: allUsers || ownerOnly ? ([estimateRow] as T[]) : [] };
          }

          return { results: [] as T[] };
        },
        async first<T>() {
          return null as T | null;
        }
      };
      return statement;
    }
  };

  return { db: db as unknown as D1Database, calls };
}

function createProfileReportDb() {
  const calls: QueryCall[] = [];
  const state = {
    profile: undefined as string | undefined,
    report: undefined as { content: string; created_at: string } | undefined
  };

  const db = {
    prepare(sql: string) {
      const call: QueryCall = { sql, binds: [] };
      calls.push(call);
      const statement = {
        bind(...values: unknown[]) {
          call.binds = values;
          return statement;
        },
        async first<T>() {
          if (sql.includes("SELECT profile_json FROM profile")) {
            return (state.profile ? { profile_json: state.profile } : null) as T | null;
          }
          if (sql.includes("SELECT id FROM reports")) {
            return (state.report ? { id: 7 } : null) as T | null;
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO profile")) {
            state.profile = String(call.binds[1]);
          }
          if (sql.includes("UPDATE profile")) {
            state.profile = String(call.binds[0]);
          }
          if (sql.includes("INSERT INTO reports")) {
            state.report = { content: String(call.binds[3]), created_at: String(call.binds[4]) };
          }
          if (sql.includes("UPDATE reports")) {
            state.report = { content: String(call.binds[0]), created_at: String(call.binds[1]) };
          }
          return { success: true };
        },
        async all<T>() {
          return { results: [] as T[] };
        }
      };
      return statement;
    }
  };

  return { db: db as unknown as D1Database, calls, state };
}

function createProcessedUpdateDb() {
  const calls: QueryCall[] = [];
  const seen = new Set<string>();

  const db = {
    prepare(sql: string) {
      const call: QueryCall = { sql, binds: [] };
      calls.push(call);
      const statement = {
        bind(...values: unknown[]) {
          call.binds = values;
          return statement;
        },
        async run() {
          const updateId = String(call.binds[0]);
          if (seen.has(updateId)) return { success: true, meta: { changes: 0 } };
          seen.add(updateId);
          return { success: true, meta: { changes: 1 } };
        },
        async first<T>() {
          return null as T | null;
        },
        async all<T>() {
          return { results: [] as T[] };
        }
      };
      return statement;
    }
  };

  return { db: db as unknown as D1Database, calls };
}

function createEnv(db: D1Database): Env {
  return {
    DB: db,
    OWNER_USER_ID: "self",
    TIMEZONE: "Asia/Shanghai"
  } as unknown as Env;
}

describe("repository dashboard user resolution", () => {
  it("shows Telegram records on the dashboard when OWNER_USER_ID is self", async () => {
    const { db, calls } = createDashboardDb();

    const data = await getDashboardData(createEnv(db));

    expect(data.meals).toHaveLength(1);
    expect(data.meals[0]?.summary).toBe("fish lunch");
    expect(calls.flatMap((call) => call.binds)).not.toContain("self");
  });

  it("builds the daily review from stored Telegram records when OWNER_USER_ID is self", async () => {
    const { db, calls } = createDashboardDb();

    const review = await buildDailyReview(createEnv(db), "self", "2026-05-18");

    expect(review).toContain("520");
    expect(review).toContain("32");
    expect(calls.flatMap((call) => call.binds)).not.toContain("self");
  });

  it("merges profile patches into profile JSON", async () => {
    const { db } = createProfileReportDb();
    const env = createEnv(db);

    await saveProfilePatch(env, "123456", { age: 28 });
    await saveProfilePatch(env, "123456", { heightCm: 175 });

    await expect(getProfile(env, "123456")).resolves.toEqual({ age: 28, heightCm: 175 });
  });

  it("updates an existing report for the same user type and period", async () => {
    const { db, calls } = createProfileReportDb();
    const env = createEnv(db);

    await saveReport(env, "123456", "daily", "2026-05-18", "first");
    await saveReport(env, "123456", "daily", "2026-05-18", "second");

    expect(calls.some((call) => call.sql.includes("UPDATE reports"))).toBe(true);
  });

  it("builds structured daily review data from meals exercises and measurements", async () => {
    const { db } = createDashboardDb();

    const data = await buildDailyReviewData(createEnv(db), "self", "2026-05-18");

    expect(data.date).toBe("2026-05-18");
    expect(data.mealCount).toBe(1);
    expect(data.totalCaloriesKcal).toBe(520);
    expect(data.totalProteinG).toBe(32);
    expect(data.exerciseCaloriesKcal).toBe(220);
    expect(data.latestWeightKg).toBe(72.4);
  });

  it("builds structured weekly review data for a date range", async () => {
    const { db } = createDashboardDb();

    const data = await buildWeeklyReviewData(createEnv(db), "self", "2026-05-11", "2026-05-17");

    expect(data.periodStart).toBe("2026-05-11");
    expect(data.periodEnd).toBe("2026-05-17");
    expect(data.mealCount).toBe(1);
    expect(data.totalCaloriesKcal).toBe(520);
    expect(data.exerciseCaloriesKcal).toBe(220);
  });

  it("reserves Telegram update ids only once", async () => {
    const { db, calls } = createProcessedUpdateDb();
    const env = createEnv(db);

    await expect(reserveTelegramUpdate(env, 1000, "123456")).resolves.toBe(true);
    await expect(reserveTelegramUpdate(env, 1000, "123456")).resolves.toBe(false);

    expect(calls[0]?.sql).toContain("INSERT OR IGNORE INTO processed_telegram_updates");
  });
});
