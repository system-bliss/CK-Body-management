import type { AiEstimate, BodyProfile, DailyReviewData, DashboardData, Env, MeasurementPatch, ProfilePatch, StoredMessage, WeeklyReviewData } from "../types";
import { localDate, localDateTime } from "./records";

export async function reserveTelegramUpdate(env: Env, updateId: number | undefined, userId: string): Promise<boolean> {
  if (updateId === undefined) return true;
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_telegram_updates (update_id, user_id, created_at)
     VALUES (?, ?, ?)`
  )
    .bind(String(updateId), userId, localDateTime(env.TIMEZONE))
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function ensureDailyLog(env: Env, userId: string, date = localDate(env.TIMEZONE)): Promise<number> {
  const existing = await env.DB.prepare("SELECT id FROM daily_logs WHERE user_id = ? AND log_date = ?").bind(userId, date).first<{ id: number }>();
  if (existing) return existing.id;
  const inserted = await env.DB.prepare("INSERT INTO daily_logs (user_id, log_date, created_at) VALUES (?, ?, ?) RETURNING id")
    .bind(userId, date, localDateTime(env.TIMEZONE))
    .first<{ id: number }>();
  if (!inserted) throw new Error("Failed to create daily log");
  return inserted.id;
}

export async function saveIncomingMessage(
  env: Env,
  message: StoredMessage,
  estimate: AiEstimate,
  options: { rawText?: string | undefined; photoKey?: string | undefined; contentType?: string | undefined } = {}
): Promise<number> {
  const date = localDate(env.TIMEZONE);
  const dailyLogId = await ensureDailyLog(env, message.fromUserName, date);
  const record = await env.DB.prepare(
    `INSERT INTO ai_estimates
      (daily_log_id, user_id, source_msg_id, entry_type, meal_type, raw_text, photo_r2_key, photo_content_type, estimate_json, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(
      dailyLogId,
      message.fromUserName,
      message.msgId ?? null,
      estimate.entryType,
      estimate.mealType ?? null,
      options.rawText ?? null,
      options.photoKey ?? null,
      options.contentType ?? null,
      JSON.stringify(estimate),
      estimate.confidence,
      localDateTime(env.TIMEZONE)
    )
    .first<{ id: number }>();
  if (!record) throw new Error("Failed to save AI estimate");

  if (estimate.entryType === "meal") {
    await env.DB.prepare(
      `INSERT INTO meal_entries
        (daily_log_id, estimate_id, meal_type, calories_kcal, protein_g, carbs_g, fat_g, summary, estimated, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(
        dailyLogId,
        record.id,
        estimate.mealType ?? "unknown",
        estimate.totalCaloriesKcal ?? null,
        estimate.totalProteinG ?? null,
        estimate.totalCarbsG ?? null,
        estimate.totalFatG ?? null,
        estimate.items.map((item) => `${item.name}${item.amount ? item.amount : ""}`).join("、"),
        localDateTime(env.TIMEZONE)
      )
      .run();
  }

  if (estimate.entryType === "exercise") {
    await env.DB.prepare(
      `INSERT INTO exercise_entries
        (daily_log_id, estimate_id, minutes, calories_kcal, summary, estimated, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(
        dailyLogId,
        record.id,
        estimate.exerciseMinutes ?? null,
        estimate.exerciseCaloriesKcal ?? null,
        estimate.notes ?? options.rawText ?? "运动记录",
        localDateTime(env.TIMEZONE)
      )
      .run();
  }

  return record.id;
}

export async function saveMeasurements(env: Env, userId: string, measurements: MeasurementPatch): Promise<void> {
  if (Object.keys(measurements).length === 0) return;
  const dailyLogId = await ensureDailyLog(env, userId);
  await env.DB.prepare(
    `INSERT INTO measurements
      (daily_log_id, user_id, weight_kg, body_fat_percent, waist_cm, measured_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      dailyLogId,
      userId,
      measurements.weightKg ?? null,
      measurements.bodyFatPercent ?? null,
      measurements.waistCm ?? null,
      localDateTime(env.TIMEZONE)
    )
    .run();
}

export async function getProfile(env: Env, userId = env.OWNER_USER_ID): Promise<BodyProfile> {
  const scopedId = scopedUserId(userId);
  const row = scopedId
    ? await env.DB.prepare("SELECT profile_json FROM profile WHERE user_id = ?").bind(scopedId).first<{ profile_json: string }>()
    : await env.DB.prepare("SELECT profile_json FROM profile ORDER BY updated_at DESC LIMIT 1").first<{ profile_json: string }>();
  if (!row?.profile_json) return {};
  try {
    const parsed = JSON.parse(row.profile_json) as BodyProfile;
    const profile: BodyProfile = {};
    if (typeof parsed.age === "number") profile.age = parsed.age;
    if (typeof parsed.heightCm === "number") profile.heightCm = parsed.heightCm;
    if (parsed.gender === "male" || parsed.gender === "female") profile.gender = parsed.gender;
    return profile;
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

export async function getDashboardData(env: Env, userId = env.OWNER_USER_ID): Promise<DashboardData> {
  const date = localDate(env.TIMEZONE);
  const profile = await getProfile(env, userId);
  const ownerUserId = scopedUserId(userId);
  const dailyLogScope = ownerUserId ? "WHERE dl.user_id = ?" : "";
  const dailyLogParams = ownerUserId ? [ownerUserId] : [];
  const directScope = ownerUserId ? "WHERE user_id = ?" : "";
  const directParams = ownerUserId ? [ownerUserId] : [];

  const meals = await allRows<Record<string, unknown>>(
    env.DB.prepare(
    `SELECT dl.log_date, me.meal_type, me.calories_kcal, me.protein_g, me.summary
     FROM meal_entries me JOIN daily_logs dl ON dl.id = me.daily_log_id
     ${dailyLogScope} ORDER BY dl.log_date DESC, me.id DESC LIMIT 120`
    ),
    dailyLogParams
  );
  const exercises = await allRows<Record<string, unknown>>(
    env.DB.prepare(
    `SELECT dl.log_date, ee.minutes, ee.calories_kcal, ee.summary
     FROM exercise_entries ee JOIN daily_logs dl ON dl.id = ee.daily_log_id
     ${dailyLogScope} ORDER BY dl.log_date DESC, ee.id DESC LIMIT 80`
    ),
    dailyLogParams
  );
  const measurements = await allRows<Record<string, unknown>>(
    env.DB.prepare(
    `SELECT measured_at, weight_kg, body_fat_percent, waist_cm
     FROM measurements ${directScope} ORDER BY measured_at DESC LIMIT 80`
    ),
    directParams
  );
  const estimates = await allRows<Record<string, unknown>>(
    env.DB.prepare(
    `SELECT created_at, entry_type, meal_type, photo_r2_key, estimate_json, confidence
     FROM ai_estimates ${directScope} ORDER BY created_at DESC LIMIT 80`
    ),
    directParams
  );
  const reports = await allRows<Record<string, unknown>>(
    env.DB.prepare(
    `SELECT report_type, period_start, content, created_at
     FROM reports ${directScope} ORDER BY created_at DESC LIMIT 20`
    ),
    directParams
  );
  const todayMeals = (meals.results ?? []).filter((meal) => meal.log_date === date);
  const todayExercises = (exercises.results ?? []).filter((exercise) => exercise.log_date === date);
  const today = {
    date,
    caloriesKcal: sumRows(todayMeals, "calories_kcal"),
    proteinG: sumRows(todayMeals, "protein_g"),
    exerciseCaloriesKcal: sumRows(todayExercises, "calories_kcal"),
    mealCount: todayMeals.length,
    hasBreakfast: todayMeals.some((meal) => meal.meal_type === "breakfast"),
    hasLunch: todayMeals.some((meal) => meal.meal_type === "lunch"),
    hasDinner: todayMeals.some((meal) => meal.meal_type === "dinner")
  };
  return {
    profile,
    today,
    meals: meals.results ?? [],
    exercises: exercises.results ?? [],
    measurements: measurements.results ?? [],
    estimates: estimates.results ?? [],
    reports: reports.results ?? []
  };
}

export async function buildDailyReviewData(env: Env, userId: string, date = localDate(env.TIMEZONE)): Promise<DailyReviewData> {
  const ownerUserId = scopedUserId(userId);
  const conditions = ["dl.log_date = ?"];
  const params: unknown[] = [date];
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
  const measurementScope = ownerUserId ? "AND user_id = ?" : "";
  const measurementParams = ownerUserId ? [`${date}%`, ownerUserId] : [`${date}%`];
  const measurements = await allRows<{ weight_kg: number | null }>(
    env.DB.prepare(`SELECT weight_kg FROM measurements WHERE measured_at LIKE ? ${measurementScope} ORDER BY measured_at DESC LIMIT 1`),
    measurementParams
  );
  const mealRows = meals.results ?? [];
  const exerciseRows = exercises.results ?? [];
  const latestWeightKg = measurements.results?.[0]?.weight_kg ?? undefined;
  const data: DailyReviewData = {
    date,
    mealCount: estimates.filter((item) => item.entryType === "meal").length || mealRows.length,
    totalCaloriesKcal: sumRows(mealRows, "calories_kcal") || estimates.reduce((sum, item) => sum + (item.totalCaloriesKcal ?? 0), 0),
    totalProteinG: sumRows(mealRows, "protein_g") || estimates.reduce((sum, item) => sum + (item.totalProteinG ?? 0), 0),
    totalCarbsG: sumRows(mealRows, "carbs_g") || estimates.reduce((sum, item) => sum + (item.totalCarbsG ?? 0), 0),
    totalFatG: sumRows(mealRows, "fat_g") || estimates.reduce((sum, item) => sum + (item.totalFatG ?? 0), 0),
    exerciseMinutes: sumRows(exerciseRows, "minutes") || estimates.reduce((sum, item) => sum + (item.exerciseMinutes ?? 0), 0),
    exerciseCaloriesKcal: sumRows(exerciseRows, "calories_kcal") || estimates.reduce((sum, item) => sum + (item.exerciseCaloriesKcal ?? 0), 0),
    meals: mealRows,
    exercises: exerciseRows,
    profile: await getProfile(env, userId)
  };
  if (typeof latestWeightKg === "number") data.latestWeightKg = latestWeightKg;
  return data;
}

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
  const meals = await allRows<Record<string, unknown>>(
    env.DB.prepare(
      `SELECT dl.log_date, me.meal_type, me.calories_kcal, me.protein_g, me.summary
       FROM meal_entries me JOIN daily_logs dl ON dl.id = me.daily_log_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY dl.log_date ASC, me.id ASC`
    ),
    params
  );
  const exercises = await allRows<Record<string, unknown>>(
    env.DB.prepare(
      `SELECT dl.log_date, ee.minutes, ee.calories_kcal, ee.summary
       FROM exercise_entries ee JOIN daily_logs dl ON dl.id = ee.daily_log_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY dl.log_date ASC, ee.id ASC`
    ),
    params
  );
  const measurementScope = ownerUserId ? "AND user_id = ?" : "";
  const measurementParams = ownerUserId ? [`${periodStart} 00:00:00`, `${periodEnd} 23:59:59`, ownerUserId] : [`${periodStart} 00:00:00`, `${periodEnd} 23:59:59`];
  const measurements = await allRows<{ weight_kg: number | null; measured_at: string }>(
    env.DB.prepare(`SELECT weight_kg, measured_at FROM measurements WHERE measured_at BETWEEN ? AND ? ${measurementScope} ORDER BY measured_at ASC`),
    measurementParams
  );
  const mealRows = meals.results ?? [];
  const exerciseRows = exercises.results ?? [];
  const weights = (measurements.results ?? []).map((row) => row.weight_kg).filter((value): value is number => typeof value === "number");

  const data: WeeklyReviewData = {
    periodStart,
    periodEnd,
    mealCount: estimates.filter((item) => item.entryType === "meal").length || mealRows.length,
    totalCaloriesKcal: sumRows(mealRows, "calories_kcal") || estimates.reduce((sum, item) => sum + (item.totalCaloriesKcal ?? 0), 0),
    totalProteinG: sumRows(mealRows, "protein_g") || estimates.reduce((sum, item) => sum + (item.totalProteinG ?? 0), 0),
    exerciseMinutes: sumRows(exerciseRows, "minutes") || estimates.reduce((sum, item) => sum + (item.exerciseMinutes ?? 0), 0),
    exerciseCaloriesKcal: sumRows(exerciseRows, "calories_kcal") || estimates.reduce((sum, item) => sum + (item.exerciseCaloriesKcal ?? 0), 0),
    profile: await getProfile(env, userId)
  };
  const firstWeight = weights[0];
  const latestWeight = weights[weights.length - 1];
  if (typeof firstWeight === "number") data.firstWeightKg = firstWeight;
  if (typeof latestWeight === "number") data.latestWeightKg = latestWeight;
  return data;
}

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

function sumRows(rows: Array<Record<string, unknown>>, key: string): number {
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
}

function scopedUserId(userId: string | undefined): string | undefined {
  const normalized = userId?.trim();
  if (!normalized || normalized === "self" || normalized === "*") return undefined;
  return normalized;
}

function allRows<T>(statement: D1PreparedStatement, params: unknown[]): Promise<D1Result<T>> {
  return params.length ? statement.bind(...params).all<T>() : statement.all<T>();
}
