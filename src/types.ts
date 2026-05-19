import type { BodyCoachAgent } from "./agent";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "unknown";
export type EntryType = "meal" | "exercise" | "measurement" | "unknown";
export type Confidence = "low" | "medium" | "high";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  AI: Ai;
  BODY_COACH_AGENT: DurableObjectNamespace<BodyCoachAgent>;
  WORKERS_AI_TEXT_MODEL?: string;
  WORKERS_AI_IMAGE_MODEL?: string;
  TELEGRAM_BOT_TOKEN: string;
  OWNER_TELEGRAM_CHAT_ID?: string;
  DASHBOARD_PASSWORD: string;
  SESSION_SECRET: string;
  OWNER_USER_ID: string;
  WORKER_PUBLIC_BASE_URL: string;
  TIMEZONE: string;
}

export interface AiEstimateItem {
  name: string;
  amount?: string | undefined;
  caloriesKcal?: number | undefined;
  proteinG?: number | undefined;
  carbsG?: number | undefined;
  fatG?: number | undefined;
}

export interface AiEstimate {
  entryType: EntryType;
  mealType?: MealType | undefined;
  items: AiEstimateItem[];
  totalCaloriesKcal?: number | undefined;
  totalProteinG?: number | undefined;
  totalCarbsG?: number | undefined;
  totalFatG?: number | undefined;
  exerciseMinutes?: number | undefined;
  exerciseCaloriesKcal?: number | undefined;
  confidence: Confidence;
  notes?: string | undefined;
  estimated: true;
}

export interface MeasurementPatch {
  weightKg?: number;
  bodyFatPercent?: number;
  waistCm?: number;
}

export interface BodyProfile {
  age?: number;
  heightCm?: number;
  gender?: "male" | "female";
}

export interface ProfilePatch {
  age?: number;
  heightCm?: number;
  gender?: "male" | "female";
}

export interface BodyDataPatch {
  profile: ProfilePatch;
  measurements: MeasurementPatch;
}

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

export interface StoredMessage {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  msgType: "text" | "image" | string;
  content?: string | undefined;
  mediaId?: string | undefined;
  picUrl?: string | undefined;
  msgId?: string | undefined;
}
