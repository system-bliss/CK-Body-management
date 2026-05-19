# Dashboard Telegram Reports Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the confirmed A+B dashboard, conversational Telegram profile/body-data recording, automatic data-based reports, and Beijing-time AI-polished reminders.

**Architecture:** Keep the current Cloudflare Worker/D1/R2/Workers AI architecture. Add small focused helpers for body-data parsing, profile persistence, report aggregation, reminder scheduling, and AI text generation; keep `src/index.ts` as the orchestration layer. Dashboard remains server-rendered HTML but gets a pure rendering helper so it can be tested without a real D1 binding.

**Tech Stack:** Cloudflare Workers, D1, R2, Workers AI, TypeScript, Vitest, Wrangler.

---

## File Structure

- Modify `src/types.ts`
  - Add `BodyProfile`, `ProfilePatch`, `BodyDataPatch`, `DashboardData`, `DailyReviewData`, `WeeklyReviewData`, `ReminderType`, and `ReminderContext` types.

- Modify `src/lib/records.ts`
  - Add basic profile/body parsing for age, height, and weight.
  - Add date helpers for local yesterday, local time, week start, and week end.

- Modify `src/lib/repository.ts`
  - Add profile read/upsert helpers.
  - Make report saving duplicate-safe.
  - Add daily and weekly aggregation helpers.
  - Extend dashboard data with profile, latest measurement, and today summary.

- Modify `src/lib/ai.ts`
  - Add profile context to text estimate prompts.
  - Add AI-polished daily/weekly report generation.
  - Add AI-polished reminder generation with deterministic fallbacks.

- Create `src/lib/reminders.ts`
  - Encapsulate Beijing-time scheduled-event classification and fallback reminder copy.

- Modify `src/lib/dashboard.ts`
  - Add `renderDashboardPage(data)` as a pure renderer.
  - Redesign the dashboard as coach-first plus trend/history sections.

- Modify `src/index.ts`
  - Save profile/body data from Telegram text.
  - Use richer report/reminder generation in `scheduled`.
  - Send two separate 09:30 messages: yesterday review, then breakfast reminder.

- Modify `src/agent.ts`
  - Update callable `recordMessage` to store parsed profile fields.

- Modify `wrangler.jsonc`
  - Replace UTC-wrong cron values with Beijing-time equivalents.

- Modify tests:
  - `tests/text-parser.test.ts`
  - `tests/repository.test.ts`
  - `tests/ai-estimates.test.ts`
  - `tests/dashboard.test.ts`
  - `tests/reminders.test.ts`

---

## Task 1: Parse Basic Profile And Body Data

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/records.ts`
- Test: `tests/text-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add these imports and tests to `tests/text-parser.test.ts`:

```ts
import { localDate, localDateTime, parseBodyDataText, previousLocalDate, weekRangeFor } from "../src/lib/records";
```

```ts
it("extracts age height and weight from natural Chinese body data", () => {
  const patch = parseBodyDataText("我 28 岁，身高 175，今天体重 72.4kg");

  expect(patch.profile).toEqual({ age: 28, heightCm: 175 });
  expect(patch.measurements).toEqual({ weightKg: 72.4 });
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
```

- [ ] **Step 2: Run parser tests and verify RED**

Run:

```powershell
npm test -- tests/text-parser.test.ts
```

Expected: FAIL because `parseBodyDataText`, `previousLocalDate`, and `weekRangeFor` are not exported.

- [ ] **Step 3: Add shared types**

In `src/types.ts`, add:

```ts
export interface BodyProfile {
  age?: number;
  heightCm?: number;
}

export interface ProfilePatch {
  age?: number;
  heightCm?: number;
}

export interface BodyDataPatch {
  profile: ProfilePatch;
  measurements: MeasurementPatch;
}
```

- [ ] **Step 4: Implement parsing and date helpers**

In `src/lib/records.ts`, import the new type and add:

```ts
import type { BodyDataPatch, MealType, MeasurementPatch, ProfilePatch } from "../types";
```

Replace the existing import line with the line above.

Add these functions below `parseMeasurementText`:

```ts
export function parseBodyDataText(text: string): BodyDataPatch {
  return {
    profile: parseProfileText(text),
    measurements: parseMeasurementText(text)
  };
}

export function parseProfileText(text: string): ProfilePatch {
  const result: ProfilePatch = {};
  const age = text.match(/(?:年龄|我)?\s*([1-9][0-9]?)\s*岁/);
  const height = text.match(/(?:身高|身长|高)\s*([1-2][0-9]{2}(?:\.[0-9]+)?)\s*(?:cm|厘米|公分)?/i);

  if (age?.[1]) result.age = Number(age[1]);
  if (height?.[1]) result.heightCm = Number(height[1]);
  return result;
}
```

Add these functions after `localDateTime`:

```ts
export function previousLocalDate(timeZone = "Asia/Shanghai", date = new Date()): string {
  return shiftLocalDate(timeZone, date, -1);
}

export function localTime(timeZone = "Asia/Shanghai", date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function weekRangeFor(timeZone = "Asia/Shanghai", date = new Date()): { start: string; end: string } {
  const localNoon = localDate(timeZone, date);
  const current = new Date(`${localNoon}T12:00:00.000Z`);
  const day = current.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(current);
  monday.setUTCDate(current.getUTCDate() - daysSinceMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: formatUtcDate(monday),
    end: formatUtcDate(sunday)
  };
}

function shiftLocalDate(timeZone: string, date: Date, offsetDays: number): string {
  const current = new Date(`${localDate(timeZone, date)}T12:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + offsetDays);
  return formatUtcDate(current);
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 5: Run parser tests and verify GREEN**

Run:

```powershell
npm test -- tests/text-parser.test.ts
```

Expected: PASS, all parser tests pass.

- [ ] **Step 6: Commit parser slice**

Run:

```powershell
git add src/types.ts src/lib/records.ts tests/text-parser.test.ts
git commit -m "feat: parse profile body data"
```

---

## Task 2: Store Profile Data And Make Reports Duplicate-Safe

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/repository.ts`
- Test: `tests/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add imports in `tests/repository.test.ts`:

```ts
import { buildDailyReview, getDashboardData, getProfile, saveProfilePatch, saveReport } from "../src/lib/repository";
```

Add this test database helper after `createDashboardDb`:

```ts
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
            state.profile = String(call.binds[1]);
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
```

Add tests:

```ts
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
```

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```powershell
npm test -- tests/repository.test.ts
```

Expected: FAIL because `getProfile` and `saveProfilePatch` are not exported, and `saveReport` always inserts.

- [ ] **Step 3: Add dashboard data types**

In `src/types.ts`, add:

```ts
export interface DashboardTodaySummary {
  date: string;
  caloriesKcal: number;
  proteinG: number;
  exerciseCaloriesKcal: number;
  mealCount: number;
  hasBreakfast: boolean;
  hasLunch: boolean;
  hasDinner: boolean;
}

export interface DashboardData {
  profile: BodyProfile;
  today: DashboardTodaySummary;
  meals: Array<Record<string, unknown>>;
  exercises: Array<Record<string, unknown>>;
  measurements: Array<Record<string, unknown>>;
  estimates: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
}
```

- [ ] **Step 4: Implement profile helpers**

In `src/lib/repository.ts`, update the import:

```ts
import type { AiEstimate, BodyProfile, DashboardData, Env, MeasurementPatch, ProfilePatch, StoredMessage } from "../types";
```

Add these functions after `saveMeasurements`:

```ts
export async function getProfile(env: Env, userId = env.OWNER_USER_ID): Promise<BodyProfile> {
  const row = await env.DB.prepare("SELECT profile_json FROM profile WHERE user_id = ?").bind(userId).first<{ profile_json: string }>();
  if (!row?.profile_json) return {};
  try {
    const parsed = JSON.parse(row.profile_json) as BodyProfile;
    return {
      age: typeof parsed.age === "number" ? parsed.age : undefined,
      heightCm: typeof parsed.heightCm === "number" ? parsed.heightCm : undefined
    };
  } catch {
    return {};
  }
}

export async function saveProfilePatch(env: Env, userId: string, patch: ProfilePatch): Promise<void> {
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as ProfilePatch;
  if (Object.keys(cleanPatch).length === 0) return;
  const current = await getProfile(env, userId);
  const next = { ...current, ...cleanPatch };
  const existing = await env.DB.prepare("SELECT profile_json FROM profile WHERE user_id = ?").bind(userId).first<{ profile_json: string }>();
  if (existing) {
    await env.DB.prepare("UPDATE profile SET profile_json = ?, updated_at = ? WHERE user_id = ?")
      .bind(JSON.stringify(next), localDateTime(env.TIMEZONE), userId)
      .run();
    return;
  }
  await env.DB.prepare("INSERT INTO profile (user_id, profile_json, updated_at) VALUES (?, ?, ?)")
    .bind(userId, JSON.stringify(next), localDateTime(env.TIMEZONE))
    .run();
}
```

- [ ] **Step 5: Make report saving duplicate-safe**

Replace `saveReport` in `src/lib/repository.ts` with:

```ts
export async function saveReport(env: Env, userId: string, reportType: "daily" | "weekly", periodStart: string, content: string): Promise<void> {
  const createdAt = localDateTime(env.TIMEZONE);
  const existing = await env.DB.prepare("SELECT id FROM reports WHERE user_id = ? AND report_type = ? AND period_start = ?")
    .bind(userId, reportType, periodStart)
    .first<{ id: number }>();

  if (existing) {
    await env.DB.prepare("UPDATE reports SET content = ?, created_at = ? WHERE id = ?").bind(content, createdAt, existing.id).run();
    return;
  }

  await env.DB.prepare("INSERT INTO reports (user_id, report_type, period_start, content, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, reportType, periodStart, content, createdAt)
    .run();
}
```

- [ ] **Step 6: Run repository tests and verify GREEN**

Run:

```powershell
npm test -- tests/repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit repository profile slice**

Run:

```powershell
git add src/types.ts src/lib/repository.ts tests/repository.test.ts
git commit -m "feat: store profile and upsert reports"
```

---

## Task 3: Aggregate Daily And Weekly Report Data

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/repository.ts`
- Test: `tests/repository.test.ts`

- [ ] **Step 1: Write failing aggregation tests**

Add imports:

```ts
import { buildDailyReviewData, buildWeeklyReviewData } from "../src/lib/repository";
```

Add test rows inside `createDashboardDb`:

```ts
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
```

Update `all<T>()` in `createDashboardDb` so:

```ts
if (sql.includes("FROM exercise_entries")) {
  return { results: allUsers || ownerOnly ? ([exerciseRow] as T[]) : [] };
}
if (sql.includes("FROM measurements")) {
  return { results: allUsers || ownerOnly ? ([measurementRow] as T[]) : [] };
}
```

Add tests:

```ts
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
```

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```powershell
npm test -- tests/repository.test.ts
```

Expected: FAIL because `buildDailyReviewData` and `buildWeeklyReviewData` are not exported.

- [ ] **Step 3: Add report data types**

In `src/types.ts`, add:

```ts
export interface DailyReviewData {
  date: string;
  mealCount: number;
  totalCaloriesKcal: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  exerciseMinutes: number;
  exerciseCaloriesKcal: number;
  latestWeightKg?: number;
  meals: Array<Record<string, unknown>>;
  exercises: Array<Record<string, unknown>>;
  profile: BodyProfile;
}

export interface WeeklyReviewData {
  periodStart: string;
  periodEnd: string;
  mealCount: number;
  totalCaloriesKcal: number;
  totalProteinG: number;
  exerciseMinutes: number;
  exerciseCaloriesKcal: number;
  firstWeightKg?: number;
  latestWeightKg?: number;
  profile: BodyProfile;
}
```

- [ ] **Step 4: Implement daily aggregation**

In `src/lib/repository.ts`, add these exported functions before `buildDailyReview`:

```ts
export async function buildDailyReviewData(env: Env, userId: string, date = localDate(env.TIMEZONE)): Promise<DailyReviewData> {
  const ownerUserId = scopedUserId(userId);
  const conditions = ["dl.log_date = ?"];
  const params: unknown[] = [date];
  if (ownerUserId) {
    conditions.unshift("dl.user_id = ?");
    params.unshift(ownerUserId);
  }

  const estimateRows = await allRows<{ estimate_json: string }>(
    env.DB.prepare(
      `SELECT estimate_json FROM ai_estimates ae
       JOIN daily_logs dl ON dl.id = ae.daily_log_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ae.id ASC`
    ),
    params
  );
  const estimates = (estimateRows.results ?? []).map((row) => JSON.parse(row.estimate_json) as AiEstimate);
  const meals = await allRows<Record<string, unknown>>(
    env.DB.prepare(
      `SELECT dl.log_date, me.meal_type, me.calories_kcal, me.protein_g, me.carbs_g, me.fat_g, me.summary
       FROM meal_entries me JOIN daily_logs dl ON dl.id = me.daily_log_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY me.id ASC`
    ),
    params
  );
  const exercises = await allRows<Record<string, unknown>>(
    env.DB.prepare(
      `SELECT dl.log_date, ee.minutes, ee.calories_kcal, ee.summary
       FROM exercise_entries ee JOIN daily_logs dl ON dl.id = ee.daily_log_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ee.id ASC`
    ),
    params
  );
  const measurements = await allRows<{ weight_kg: number | null }>(
    env.DB.prepare(`SELECT weight_kg FROM measurements WHERE measured_at LIKE ? ORDER BY measured_at DESC LIMIT 1`),
    [`${date}%`]
  );

  return {
    date,
    mealCount: estimates.filter((item) => item.entryType === "meal").length,
    totalCaloriesKcal: estimates.reduce((sum, item) => sum + (item.totalCaloriesKcal ?? 0), 0),
    totalProteinG: estimates.reduce((sum, item) => sum + (item.totalProteinG ?? 0), 0),
    totalCarbsG: estimates.reduce((sum, item) => sum + (item.totalCarbsG ?? 0), 0),
    totalFatG: estimates.reduce((sum, item) => sum + (item.totalFatG ?? 0), 0),
    exerciseMinutes: estimates.reduce((sum, item) => sum + (item.exerciseMinutes ?? 0), 0),
    exerciseCaloriesKcal: estimates.reduce((sum, item) => sum + (item.exerciseCaloriesKcal ?? 0), 0),
    latestWeightKg: measurements.results?.[0]?.weight_kg ?? undefined,
    meals: meals.results ?? [],
    exercises: exercises.results ?? [],
    profile: await getProfile(env, userId)
  };
}
```

- [ ] **Step 5: Implement weekly aggregation**

Add:

```ts
export async function buildWeeklyReviewData(env: Env, userId: string, periodStart: string, periodEnd: string): Promise<WeeklyReviewData> {
  const ownerUserId = scopedUserId(userId);
  const conditions = ["dl.log_date BETWEEN ? AND ?"];
  const params: unknown[] = [periodStart, periodEnd];
  if (ownerUserId) {
    conditions.unshift("dl.user_id = ?");
    params.unshift(ownerUserId);
  }

  const rows = await allRows<{ estimate_json: string }>(
    env.DB.prepare(
      `SELECT estimate_json FROM ai_estimates ae
       JOIN daily_logs dl ON dl.id = ae.daily_log_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ae.id ASC`
    ),
    params
  );
  const estimates = (rows.results ?? []).map((row) => JSON.parse(row.estimate_json) as AiEstimate);
  const measurements = await allRows<{ weight_kg: number | null; measured_at: string }>(
    env.DB.prepare(`SELECT weight_kg, measured_at FROM measurements WHERE measured_at BETWEEN ? AND ? ORDER BY measured_at ASC`),
    [`${periodStart} 00:00:00`, `${periodEnd} 23:59:59`]
  );
  const weights = (measurements.results ?? []).map((row) => row.weight_kg).filter((value): value is number => typeof value === "number");

  return {
    periodStart,
    periodEnd,
    mealCount: estimates.filter((item) => item.entryType === "meal").length,
    totalCaloriesKcal: estimates.reduce((sum, item) => sum + (item.totalCaloriesKcal ?? 0), 0),
    totalProteinG: estimates.reduce((sum, item) => sum + (item.totalProteinG ?? 0), 0),
    exerciseMinutes: estimates.reduce((sum, item) => sum + (item.exerciseMinutes ?? 0), 0),
    exerciseCaloriesKcal: estimates.reduce((sum, item) => sum + (item.exerciseCaloriesKcal ?? 0), 0),
    firstWeightKg: weights[0],
    latestWeightKg: weights[weights.length - 1],
    profile: await getProfile(env, userId)
  };
}
```

Update the top import:

```ts
import type { AiEstimate, BodyProfile, DailyReviewData, DashboardData, Env, MeasurementPatch, ProfilePatch, StoredMessage, WeeklyReviewData } from "../types";
```

- [ ] **Step 6: Reuse structured daily data in existing review**

Replace `buildDailyReview` with:

```ts
export async function buildDailyReview(env: Env, userId: string, date = localDate(env.TIMEZONE)): Promise<string> {
  const data = await buildDailyReviewData(env, userId, date);
  return [
    `今日复盘 ${date}`,
    `已记录 ${data.mealCount} 餐，摄入约 ${Math.round(data.totalCaloriesKcal)} kcal，蛋白质约 ${Math.round(data.totalProteinG)} g。`,
    data.exerciseCaloriesKcal ? `运动消耗约 ${Math.round(data.exerciseCaloriesKcal)} kcal。` : "今天还没有明确运动消耗记录。",
    data.latestWeightKg ? `最近体重 ${data.latestWeightKg} kg。` : "今天没有新的体重记录。",
    "建议：晚间避免额外高热量零食，明天优先保证蛋白质和蔬菜；所有数值都是照片/文字估算。"
  ].join("\n");
}
```

- [ ] **Step 7: Run repository tests and verify GREEN**

Run:

```powershell
npm test -- tests/repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit aggregation slice**

Run:

```powershell
git add src/types.ts src/lib/repository.ts tests/repository.test.ts
git commit -m "feat: aggregate report data"
```

---

## Task 4: AI Report And Reminder Text Generation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/ai.ts`
- Test: `tests/ai-estimates.test.ts`

- [ ] **Step 1: Write failing AI tests**

Add imports:

```ts
import {
  buildDailyReportPrompt,
  buildImageEstimatePrompt,
  buildLocalTextFallbackEstimate,
  buildReminderPrompt,
  buildTextEstimatePrompt,
  estimateImageRecord,
  extractModelText,
  generateDailyReport,
  generateReminderText,
  parseAiEstimateJson,
  summarizeEstimate
} from "../src/lib/ai";
```

Add tests:

```ts
it("includes profile context in text estimate prompts when available", () => {
  const prompt = buildTextEstimatePrompt("午餐：鸡胸肉饭", "lunch", { age: 28, heightCm: 175 });

  expect(prompt).toContain("用户基础资料：年龄 28 岁，身高 175 cm");
  expect(prompt).toContain("用户记录：午餐：鸡胸肉饭");
});

it("builds a daily report prompt from structured review data", () => {
  const prompt = buildDailyReportPrompt({
    date: "2026-05-18",
    mealCount: 2,
    totalCaloriesKcal: 1320,
    totalProteinG: 88,
    totalCarbsG: 140,
    totalFatG: 38,
    exerciseMinutes: 35,
    exerciseCaloriesKcal: 220,
    latestWeightKg: 72.4,
    meals: [],
    exercises: [],
    profile: { age: 28, heightCm: 175 }
  });

  expect(prompt).toContain("昨日复盘");
  expect(prompt).toContain("1320 kcal");
  expect(prompt).toContain("蛋白质 88 g");
  expect(prompt).toContain("身高 175 cm");
});

it("falls back to deterministic daily reports when AI fails", async () => {
  const env = {
    AI: {
      run: async () => {
        throw new Error("AI unavailable");
      }
    },
    WORKERS_AI_TEXT_MODEL: "text-model"
  } as unknown as Env;

  const content = await generateDailyReport(env, {
    date: "2026-05-18",
    mealCount: 1,
    totalCaloriesKcal: 520,
    totalProteinG: 32,
    totalCarbsG: 55,
    totalFatG: 12,
    exerciseMinutes: 0,
    exerciseCaloriesKcal: 0,
    meals: [],
    exercises: [],
    profile: {}
  });

  expect(content).toContain("昨日复盘 2026-05-18");
  expect(content).toContain("520 kcal");
});

it("generates short reminder text with fallback", async () => {
  const env = {
    AI: {
      run: async () => ({ response: "午餐时间到了，拍一下今天的饭菜，我来帮你估算热量和蛋白质。" })
    },
    WORKERS_AI_TEXT_MODEL: "text-model"
  } as unknown as Env;

  const content = await generateReminderText(env, {
    type: "lunch",
    localDate: "2026-05-19",
    localTime: "12:30",
    todayMealCount: 1,
    hasMealForType: false,
    profile: { age: 28, heightCm: 175 }
  });

  expect(content).toContain("午餐");
  expect(content.length).toBeLessThan(120);
});

it("builds reminder prompts with current context", () => {
  const prompt = buildReminderPrompt({
    type: "breakfast",
    localDate: "2026-05-19",
    localTime: "09:30",
    todayMealCount: 0,
    hasMealForType: false,
    latestDailyReview: "昨日蛋白质不足",
    profile: { age: 28 }
  });

  expect(prompt).toContain("早餐提醒");
  expect(prompt).toContain("昨日蛋白质不足");
  expect(prompt).toContain("年龄 28 岁");
});
```

- [ ] **Step 2: Run AI tests and verify RED**

Run:

```powershell
npm test -- tests/ai-estimates.test.ts
```

Expected: FAIL because the new prompt/report/reminder functions do not exist and `buildTextEstimatePrompt` has no profile parameter.

- [ ] **Step 3: Add reminder types**

In `src/types.ts`, add:

```ts
export type ReminderType = "breakfast" | "lunch" | "dinner";

export interface ReminderContext {
  type: ReminderType;
  localDate: string;
  localTime: string;
  todayMealCount: number;
  hasMealForType: boolean;
  latestDailyReview?: string;
  profile: BodyProfile;
}
```

- [ ] **Step 4: Add profile context helpers in `src/lib/ai.ts`**

Update import:

```ts
import type { AiEstimate, BodyProfile, DailyReviewData, Env, MealType, ReminderContext, WeeklyReviewData } from "../types";
```

Change signature:

```ts
export function buildTextEstimatePrompt(text: string, fallbackMealType?: MealType, profile: BodyProfile = {}): string {
```

Insert this line before the final user record line:

```ts
    profileContext(profile),
```

Add helper near `confidenceLabel`:

```ts
function profileContext(profile: BodyProfile): string {
  const parts = [
    profile.age !== undefined ? `年龄 ${profile.age} 岁` : "",
    profile.heightCm !== undefined ? `身高 ${profile.heightCm} cm` : ""
  ].filter(Boolean);
  return parts.length ? `用户基础资料：${parts.join("，")}。资料缺失时不要阻塞估算，只在置信度和建议中体现。` : "";
}
```

- [ ] **Step 5: Add daily/weekly report generation**

In `src/lib/ai.ts`, add:

```ts
export function buildDailyReportPrompt(data: DailyReviewData): string {
  return [
    "你是一个中文减脂塑形记录教练。请根据结构化数据写一条 Telegram 昨日复盘。",
    "要求：80-160 字，分 3-5 行；务实、温和；不输出医疗建议；不要 Markdown 表格。",
    profileContext(data.profile),
    `昨日复盘日期：${data.date}`,
    `记录餐数：${data.mealCount}`,
    `估算摄入：${Math.round(data.totalCaloriesKcal)} kcal`,
    `蛋白质 ${Math.round(data.totalProteinG)} g，碳水 ${Math.round(data.totalCarbsG)} g，脂肪 ${Math.round(data.totalFatG)} g`,
    `运动：${Math.round(data.exerciseMinutes)} 分钟，消耗 ${Math.round(data.exerciseCaloriesKcal)} kcal`,
    data.latestWeightKg !== undefined ? `最近体重：${data.latestWeightKg} kg` : "最近体重：未记录",
    "请输出可以直接发给用户的一条中文消息。"
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateDailyReport(env: Env, data: DailyReviewData): Promise<string> {
  try {
    const result = await env.AI.run(env.WORKERS_AI_TEXT_MODEL || DEFAULT_TEXT_MODEL, {
      prompt: buildDailyReportPrompt(data),
      max_tokens: 512,
      temperature: 0.4,
      chat_template_kwargs: { enable_thinking: false }
    });
    return sanitizeShortText(extractModelText(result)) || fallbackDailyReport(data);
  } catch {
    return fallbackDailyReport(data);
  }
}

export function buildWeeklyReportPrompt(data: WeeklyReviewData): string {
  const weightText =
    data.firstWeightKg !== undefined && data.latestWeightKg !== undefined
      ? `体重从 ${data.firstWeightKg} kg 到 ${data.latestWeightKg} kg`
      : "体重趋势：记录不足";
  return [
    "你是一个中文减脂塑形记录教练。请根据一周数据写一条 Telegram 周复盘。",
    "要求：120-220 字，包含做得好的地方、下周重点和记录缺口；不要医疗建议。",
    profileContext(data.profile),
    `周期：${data.periodStart} 到 ${data.periodEnd}`,
    `记录餐数：${data.mealCount}`,
    `估算摄入：${Math.round(data.totalCaloriesKcal)} kcal`,
    `蛋白质：${Math.round(data.totalProteinG)} g`,
    `运动：${Math.round(data.exerciseMinutes)} 分钟，消耗 ${Math.round(data.exerciseCaloriesKcal)} kcal`,
    weightText,
    "请输出可以直接发给用户的一条中文消息。"
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateWeeklyReport(env: Env, data: WeeklyReviewData): Promise<string> {
  try {
    const result = await env.AI.run(env.WORKERS_AI_TEXT_MODEL || DEFAULT_TEXT_MODEL, {
      prompt: buildWeeklyReportPrompt(data),
      max_tokens: 700,
      temperature: 0.4,
      chat_template_kwargs: { enable_thinking: false }
    });
    return sanitizeShortText(extractModelText(result)) || fallbackWeeklyReport(data);
  } catch {
    return fallbackWeeklyReport(data);
  }
}
```

- [ ] **Step 6: Add reminder generation**

Add:

```ts
export function buildReminderPrompt(context: ReminderContext): string {
  const labels: Record<ReminderContext["type"], string> = {
    breakfast: "早餐提醒",
    lunch: "午餐提醒",
    dinner: "晚餐提醒"
  };
  return [
    "你是一个中文减脂塑形记录助手。请写一条短 Telegram 提醒。",
    "要求：35-80 字；自然、具体、不要啰嗦；不要医疗建议；不要使用 Markdown。",
    `提醒类型：${labels[context.type]}`,
    `北京时间：${context.localDate} ${context.localTime}`,
    `今天已记录餐数：${context.todayMealCount}`,
    `当前餐次是否已记录：${context.hasMealForType ? "是" : "否"}`,
    context.latestDailyReview ? `昨日复盘信号：${context.latestDailyReview}` : "",
    profileContext(context.profile),
    "请只输出提醒正文。"
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateReminderText(env: Env, context: ReminderContext): Promise<string> {
  try {
    const result = await env.AI.run(env.WORKERS_AI_TEXT_MODEL || DEFAULT_TEXT_MODEL, {
      prompt: buildReminderPrompt(context),
      max_tokens: 180,
      temperature: 0.5,
      chat_template_kwargs: { enable_thinking: false }
    });
    return sanitizeShortText(extractModelText(result), 120) || fallbackReminderText(context);
  } catch {
    return fallbackReminderText(context);
  }
}
```

Add helper functions:

```ts
function sanitizeShortText(value: string, maxLength = 280): string {
  return value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function fallbackDailyReport(data: DailyReviewData): string {
  return [
    `昨日复盘 ${data.date}`,
    `记录 ${data.mealCount} 餐，摄入约 ${Math.round(data.totalCaloriesKcal)} kcal，蛋白质约 ${Math.round(data.totalProteinG)} g。`,
    data.exerciseCaloriesKcal ? `运动消耗约 ${Math.round(data.exerciseCaloriesKcal)} kcal。` : "昨天没有明确运动消耗记录。",
    "今天先把早餐记录好，蛋白质和蔬菜优先。"
  ].join("\n");
}

function fallbackWeeklyReport(data: WeeklyReviewData): string {
  return [
    `本周复盘 ${data.periodStart} - ${data.periodEnd}`,
    `本周记录 ${data.mealCount} 餐，估算摄入约 ${Math.round(data.totalCaloriesKcal)} kcal，蛋白质约 ${Math.round(data.totalProteinG)} g。`,
    data.exerciseCaloriesKcal ? `运动消耗约 ${Math.round(data.exerciseCaloriesKcal)} kcal。` : "本周运动记录还不完整。",
    "下周继续稳定记录三餐，训练日优先保证蛋白质和睡眠。"
  ].join("\n");
}

function fallbackReminderText(context: ReminderContext): string {
  if (context.type === "breakfast") return "早上好，记得记录今天早餐。拍照或直接发文字都可以，我来帮你估算热量和蛋白质。";
  if (context.type === "lunch") return "午餐时间到了，拍一下饭菜或发文字记录，我来帮你估算今天的摄入。";
  return "晚餐记得补一条记录，也可以顺手说一下今天有没有运动。";
}
```

- [ ] **Step 7: Run AI tests and verify GREEN**

Run:

```powershell
npm test -- tests/ai-estimates.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit AI generation slice**

Run:

```powershell
git add src/types.ts src/lib/ai.ts tests/ai-estimates.test.ts
git commit -m "feat: generate AI reports and reminders"
```

---

## Task 5: Schedule Classification And Cron Fix

**Files:**
- Create: `src/lib/reminders.ts`
- Modify: `wrangler.jsonc`
- Test: `tests/reminders.test.ts`

- [ ] **Step 1: Write failing reminder schedule tests**

Create `tests/reminders.test.ts`:

```ts
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
```

- [ ] **Step 2: Run schedule tests and verify RED**

Run:

```powershell
npm test -- tests/reminders.test.ts
```

Expected: FAIL because `src/lib/reminders.ts` does not exist.

- [ ] **Step 3: Implement reminder schedule helper**

Create `src/lib/reminders.ts`:

```ts
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
```

- [ ] **Step 4: Update Wrangler crons**

In `wrangler.jsonc`, replace:

```jsonc
"crons": [
  "0 8,12,18,22 * * *",
  "0 21 * * SUN"
]
```

with:

```jsonc
"crons": [
  "30 1 * * *",
  "30 4 * * *",
  "0 10 * * *",
  "0 13 * * SUN"
]
```

- [ ] **Step 5: Run schedule tests and verify GREEN**

Run:

```powershell
npm test -- tests/reminders.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit scheduling slice**

Run:

```powershell
git add src/lib/reminders.ts tests/reminders.test.ts wrangler.jsonc
git commit -m "fix: schedule reminders in Beijing time"
```

---

## Task 6: Wire Telegram Profile Saving And Scheduled Reports

**Files:**
- Modify: `src/index.ts`
- Modify: `src/agent.ts`
- Test: existing focused tests plus typecheck

- [ ] **Step 1: Update imports in `src/index.ts`**

Replace the records import with:

```ts
import { detectMealType, localDate, parseBodyDataText, previousLocalDate, weekRangeFor } from "./lib/records";
```

Replace repository import with:

```ts
import {
  buildDailyReviewData,
  buildWeeklyReviewData,
  getDashboardData,
  getProfile,
  saveIncomingMessage,
  saveMeasurements,
  saveProfilePatch,
  saveReport
} from "./lib/repository";
```

Import AI/report helpers:

```ts
import { estimateImageRecord, estimateTextRecord, generateDailyReport, generateReminderText, generateWeeklyReport, summarizeEstimate } from "./lib/ai";
```

Import reminder helpers:

```ts
import { classifyScheduledReminder, reminderTypeForAction, type ScheduledAction } from "./lib/reminders";
```

- [ ] **Step 2: Save parsed profile and body data from Telegram text**

In `handleIncomingTelegramMessage`, replace:

```ts
const mealType = detectMealType(message.content);
const estimate = await estimateTextRecord(env, message.content, mealType);
await saveIncomingMessage(env, storedMessage, estimate, { rawText: message.content });
await saveMeasurements(env, storedMessage.fromUserName, parseMeasurementText(message.content));
await sendTelegramText(env, message.chatId, `${summarizeEstimate(estimate)}\n你可以继续补充份量、体重或运动情况。`);
```

with:

```ts
const mealType = detectMealType(message.content);
const bodyData = parseBodyDataText(message.content);
const profile = await getProfile(env, storedMessage.fromUserName);
const estimate = await estimateTextRecord(env, message.content, mealType, { ...profile, ...bodyData.profile });
await saveIncomingMessage(env, storedMessage, estimate, { rawText: message.content });
await saveProfilePatch(env, storedMessage.fromUserName, bodyData.profile);
await saveMeasurements(env, storedMessage.fromUserName, bodyData.measurements);
await sendTelegramText(env, message.chatId, `${summarizeEstimate(estimate)}\n你可以继续补充份量、体重或运动情况。`);
```

- [ ] **Step 3: Replace scheduled handler orchestration**

Replace `handleScheduled` with:

```ts
async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const decision = classifyScheduledReminder(new Date(event.scheduledTime), env.TIMEZONE);
  for (const action of decision.actions) {
    await handleScheduledAction(env, action, decision.localDate, decision.localTime);
  }
}
```

Add:

```ts
async function handleScheduledAction(env: Env, action: ScheduledAction, localDateValue: string, localTimeValue: string): Promise<void> {
  if (action === "daily-review") {
    const reportDate = previousLocalDate(env.TIMEZONE, new Date(`${localDateValue}T12:00:00.000Z`));
    const data = await buildDailyReviewData(env, env.OWNER_USER_ID, reportDate);
    const content = await generateDailyReport(env, data);
    await saveReport(env, env.OWNER_USER_ID, "daily", reportDate, content);
    await sendReminder(env, content);
    return;
  }

  if (action === "weekly-review") {
    const range = weekRangeFor(env.TIMEZONE, new Date(`${localDateValue}T12:00:00.000Z`));
    const data = await buildWeeklyReviewData(env, env.OWNER_USER_ID, range.start, range.end);
    const content = await generateWeeklyReport(env, data);
    await saveReport(env, env.OWNER_USER_ID, "weekly", range.start, content);
    await sendReminder(env, content);
    return;
  }

  const reminderType = reminderTypeForAction(action);
  if (!reminderType) return;
  const dashboardData = await getDashboardData(env);
  const content = await generateReminderText(env, {
    type: reminderType,
    localDate: localDateValue,
    localTime: localTimeValue,
    todayMealCount: dashboardData.today.mealCount,
    hasMealForType: mealRecorded(dashboardData.meals, localDateValue, reminderType),
    latestDailyReview: String(dashboardData.reports[0]?.content ?? ""),
    profile: dashboardData.profile
  });
  await sendReminder(env, content);
}

function mealRecorded(meals: Array<Record<string, unknown>>, date: string, reminderType: "breakfast" | "lunch" | "dinner"): boolean {
  return meals.some((meal) => meal.log_date === date && meal.meal_type === reminderType);
}
```

- [ ] **Step 4: Remove old fixed reminder text function**

Delete `reminderText` from `src/index.ts` after scheduled orchestration no longer references it.

- [ ] **Step 5: Update Agent callable profile saving**

In `src/agent.ts`, replace imports:

```ts
import { detectMealType, localDate, parseBodyDataText } from "./lib/records";
import { buildDailyReview, saveMeasurements, saveProfilePatch, saveReport } from "./lib/repository";
```

In `recordMessage`, replace:

```ts
const measurements = parseMeasurementText(input.text);
await saveMeasurements(this.env, input.userId, measurements);
```

with:

```ts
const bodyData = parseBodyDataText(input.text);
await saveProfilePatch(this.env, input.userId, bodyData.profile);
await saveMeasurements(this.env, input.userId, bodyData.measurements);
```

- [ ] **Step 6: Run typecheck and targeted tests**

Run:

```powershell
npm run typecheck
npm test -- tests/text-parser.test.ts tests/repository.test.ts tests/ai-estimates.test.ts tests/reminders.test.ts
```

Expected: typecheck PASS and targeted tests PASS.

- [ ] **Step 7: Commit integration slice**

Run:

```powershell
git add src/index.ts src/agent.ts
git commit -m "feat: wire telegram profile and scheduled reports"
```

---

## Task 7: Dashboard Data And A+B Mixed UI

**Files:**
- Modify: `src/lib/repository.ts`
- Modify: `src/lib/dashboard.ts`
- Test: `tests/dashboard.test.ts`

- [ ] **Step 1: Write failing dashboard render tests**

Create `tests/dashboard.test.ts`:

```ts
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
    meals: [
      { log_date: "2026-05-19", meal_type: "lunch", calories_kcal: 570, protein_g: 52, summary: "米饭、鱼块、蔬菜" }
    ],
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
    expect(html).toContain("AI 下一步建议");
  });

  it("hides optional body-fat and waist values when missing", () => {
    const html = renderDashboardPage(dashboardData());

    expect(html).not.toContain("null%");
    expect(html).not.toContain("null cm");
  });
});
```

- [ ] **Step 2: Run dashboard tests and verify RED**

Run:

```powershell
npm test -- tests/dashboard.test.ts
```

Expected: FAIL because `renderDashboardPage` is not exported and `DashboardData` is incomplete until previous tasks are done.

- [ ] **Step 3: Extend dashboard repository data**

In `src/lib/repository.ts`, update `getDashboardData` return type to `Promise<DashboardData>`.

At the beginning of `getDashboardData`, add:

```ts
const date = localDate(env.TIMEZONE);
const profile = await getProfile(env, userId);
```

After fetching reports, compute:

```ts
const todayMeals = (meals.results ?? []).filter((meal) => meal.log_date === date);
const today = {
  date,
  caloriesKcal: todayMeals.reduce((sum, meal) => sum + Number(meal.calories_kcal ?? 0), 0),
  proteinG: todayMeals.reduce((sum, meal) => sum + Number(meal.protein_g ?? 0), 0),
  exerciseCaloriesKcal: (exercises.results ?? [])
    .filter((exercise) => exercise.log_date === date)
    .reduce((sum, exercise) => sum + Number(exercise.calories_kcal ?? 0), 0),
  mealCount: todayMeals.length,
  hasBreakfast: todayMeals.some((meal) => meal.meal_type === "breakfast"),
  hasLunch: todayMeals.some((meal) => meal.meal_type === "lunch"),
  hasDinner: todayMeals.some((meal) => meal.meal_type === "dinner")
};
```

Return:

```ts
return {
  profile,
  today,
  meals: meals.results ?? [],
  exercises: exercises.results ?? [],
  measurements: measurements.results ?? [],
  estimates: estimates.results ?? [],
  reports: reports.results ?? []
};
```

- [ ] **Step 4: Split dashboard renderer**

In `src/lib/dashboard.ts`, replace `renderDashboard` body with:

```ts
export async function renderDashboard(env: Env): Promise<string> {
  return renderDashboardPage(await getDashboardData(env));
}

export function renderDashboardPage(data: DashboardData): string {
  const latestMeasurements = data.measurements.slice(0, 8);
  const latestWeight = latestMeasurements.find((row) => row.weight_kg);
  const meals = data.meals.slice(0, 30);
  const exercises = data.exercises.slice(0, 12);
  const photos = data.estimates.filter((row) => typeof row.photo_r2_key === "string").slice(0, 12);
  const reports = data.reports.slice(0, 6);
  const suggestion = dashboardSuggestion(data);

  return `<!doctype html>
  ...
  </html>`;
}
```

Replace `...` with the A+B mixed HTML in Step 5.

- [ ] **Step 5: Implement A+B mixed HTML and CSS**

Use this structure in `renderDashboardPage`:

```ts
return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>身材管理 Dashboard</title>
  <style>
    :root{color-scheme:light;--ink:#142033;--muted:#667085;--line:#dbe3ef;--paper:#fff;--bg:#f3f6fa;--brand:#27566b;--brand2:#3f7c6b;--accent:#d98245}
    *{box-sizing:border-box}
    body{margin:0;font-family:Inter,Arial,"Microsoft YaHei",sans-serif;background:var(--bg);color:var(--ink);letter-spacing:0}
    header{background:linear-gradient(135deg,#142033,#27566b 58%,#3f7c6b);color:white;padding:28px 24px 34px}
    .wrap{max-width:1220px;margin:0 auto}
    .hero{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);gap:20px;align-items:end}
    h1{margin:0;font-size:30px;line-height:1.2} h2{margin:0 0 14px;font-size:18px} h3{margin:0 0 8px;font-size:15px}
    .hero p,.muted{color:var(--muted)} header .muted{color:rgba(255,255,255,.72)}
    main{max-width:1220px;margin:-22px auto 0;padding:0 24px 32px;display:grid;gap:18px}
    section{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:18px;box-shadow:0 12px 30px rgba(15,23,42,.06)}
    .coach{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .metric{border:1px solid var(--line);border-radius:8px;padding:14px;background:#fbfcfe;min-height:92px}
    .metric span{display:block;color:var(--muted);font-size:12px;margin-bottom:8px}.metric strong{font-size:24px;line-height:1.1}
    .pillrow{display:flex;flex-wrap:wrap;gap:8px}.pill{border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:#fbfcfe;font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
    .wide{grid-column:1/-1}
    table{width:100%;border-collapse:collapse;font-size:14px} th,td{padding:10px;border-bottom:1px solid #edf0f3;text-align:left;vertical-align:top}
    th{font-size:12px;color:var(--muted);font-weight:700}
    .photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
    .report{white-space:pre-wrap;line-height:1.55;background:#f8fafc;border:1px solid #edf1f6;border-radius:8px;padding:12px;margin:8px 0}
    .suggestion{font-size:16px;line-height:1.7;background:#f8fbf8;border-color:#d9eadf}
    @media (max-width:900px){.hero,.coach,.grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:560px){header{padding:24px 18px 32px}main{padding:0 14px 28px}.metrics{grid-template-columns:1fr}table{font-size:13px}th,td{padding:8px}}
  </style>
</head>
<body>
  <header>
    <div class="wrap hero">
      <div><h1>身材管理 Dashboard</h1><p class="muted">AI 估算饮食、运动和身体趋势；缺失数据不会阻塞计算。</p></div>
      <div class="pillrow">${profilePills(data.profile, latestWeight)}</div>
    </div>
  </header>
  <main>
    <section class="coach">
      <div>
        <h2>今日状态</h2>
        <div class="metrics">
          ${metric("热量", kcal(data.today.caloriesKcal), "今日已记录")}
          ${metric("蛋白质", gram(data.today.proteinG), "今日已记录")}
          ${metric("运动", kcal(data.today.exerciseCaloriesKcal), "估算消耗")}
          ${metric("餐次", `${data.today.mealCount}/3`, "早餐/午餐/晚餐")}
        </div>
      </div>
      <section class="suggestion">
        <h2>AI 下一步建议</h2>
        <p>${escapeHtml(suggestion)}</p>
      </section>
    </section>
    <div class="grid">
      <section>
        <h2>身体数据趋势</h2>
        ${table(["时间", "体重", "体脂", "腰围"], latestMeasurements.map((row) => [row.measured_at, kg(row.weight_kg), pct(row.body_fat_percent), cm(row.waist_cm)]))}
      </section>
      <section>
        <h2>最近报告</h2>
        ${reports.map((row) => `<div class="report"><strong>${escapeHtml(String(row.period_start))}</strong> ${escapeHtml(reportTypeLabel(String(row.report_type)))}\n${escapeHtml(String(row.content))}</div>`).join("") || empty()}
      </section>
      <section class="wide">
        <h2>餐食记录</h2>
        ${table(["日期", "餐次", "热量", "蛋白质", "摘要"], meals.map((row) => [row.log_date, mealLabel(String(row.meal_type)), kcal(row.calories_kcal), gram(row.protein_g), row.summary]))}
      </section>
      <section>
        <h2>运动记录</h2>
        ${table(["日期", "时长", "消耗", "摘要"], exercises.map((row) => [row.log_date, minute(row.minutes), kcal(row.calories_kcal), row.summary]))}
      </section>
      <section>
        <h2>照片时间线</h2>
        <div class="photos">${photos.map((row) => `<img src="/api/photos/${encodeURIComponent(String(row.photo_r2_key))}" alt="${escapeHtml(String(row.created_at))}">`).join("") || empty()}</div>
      </section>
    </div>
  </main>
</body>
</html>`;
```

- [ ] **Step 6: Add dashboard helper functions**

Add below existing formatter helpers:

```ts
function metric(label: string, value: string, hint: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "0")}</strong><span>${escapeHtml(hint)}</span></div>`;
}

function profilePills(profile: DashboardData["profile"], latestWeight: Record<string, unknown> | undefined): string {
  const values = [
    profile.age !== undefined ? `${profile.age} 岁` : "",
    profile.heightCm !== undefined ? `${profile.heightCm} cm` : "",
    latestWeight?.weight_kg ? `${latestWeight.weight_kg} kg` : ""
  ].filter(Boolean);
  return values.length ? values.map((value) => `<span class="pill">${escapeHtml(value)}</span>`).join("") : '<span class="pill">基础资料待补充</span>';
}

function dashboardSuggestion(data: DashboardData): string {
  if (!data.today.hasBreakfast) return "先记录今天早餐。发照片或文字都可以，系统会自动估算热量和蛋白质。";
  if (!data.today.hasLunch) return "午餐还没记录，拍一下饭菜可以让今天的摄入趋势更完整。";
  if (!data.today.hasDinner) return "晚餐记录后，今晚或明早的复盘会更准确。";
  if (data.today.proteinG < 80) return "今天蛋白质看起来偏低，下一餐优先补一点瘦肉、蛋、奶或豆制品。";
  return "今天记录节奏不错，继续保持三餐和运动信息完整。";
}

function minute(value: unknown): string {
  return value ? `${Math.round(Number(value))} min` : "";
}

function reportTypeLabel(value: string): string {
  return value === "weekly" ? "周报" : "日报";
}
```

Update imports in `src/lib/dashboard.ts`:

```ts
import type { DashboardData, Env } from "../types";
```

- [ ] **Step 7: Run dashboard tests and verify GREEN**

Run:

```powershell
npm test -- tests/dashboard.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit dashboard slice**

Run:

```powershell
git add src/lib/repository.ts src/lib/dashboard.ts tests/dashboard.test.ts
git commit -m "feat: redesign body dashboard"
```

---

## Task 8: Final Verification And Cleanup

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm test
```

Expected: PASS with all test files and all tests passing.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS with exit code 0.

- [ ] **Step 3: Run Wrangler validation**

Run:

```powershell
npx wrangler check
```

Expected: PASS. If Wrangler reports a current CLI command mismatch, run `npx wrangler deploy --dry-run` and record the result.

- [ ] **Step 4: Inspect git status**

Run:

```powershell
git status --short
```

Expected: no unstaged or staged changes.

- [ ] **Step 5: Record implementation summary**

Prepare final response with:

- Commit hashes created after the initial baseline.
- Verification commands and pass/fail status.
- Any deployment note, especially that Cloudflare cron triggers are UTC and `wrangler.jsonc` now stores UTC equivalents for Beijing times.

---

## Self-Review Checklist

- Spec coverage:
  - Dashboard A+B mixed overview: Task 7.
  - Telegram age/height/weight parsing: Task 1 and Task 6.
  - Missing optional measurements do not block estimates: Task 1, Task 4, Task 7.
  - Daily report for yesterday at Beijing 09:30: Task 4, Task 5, Task 6.
  - Separate 09:30 breakfast reminder: Task 5 and Task 6.
  - Lunch and dinner at Beijing 12:30 and 18:00: Task 5 and Task 6.
  - AI-polished reminder content with fallback: Task 4 and Task 6.
  - Data-based weekly report: Task 3, Task 4, Task 6.
  - Tests and typecheck: Task 8.

- Placeholder scan:
  - No unresolved placeholders are intentionally left in the plan.

- Type consistency:
  - `BodyProfile`, `ProfilePatch`, `BodyDataPatch`, `DailyReviewData`, `WeeklyReviewData`, and `ReminderContext` are defined in `src/types.ts` before use.
  - `ReminderType` values match existing meal types for breakfast/lunch/dinner.
  - `renderDashboardPage(data: DashboardData)` is pure and testable.
