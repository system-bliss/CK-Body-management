import type { BodyDataPatch, MealType, MeasurementPatch, ProfilePatch } from "../types";

export function detectMealType(text: string): MealType {
  if (/早饭|早餐|早上|breakfast/i.test(text)) return "breakfast";
  if (/午饭|午餐|中饭|中午|lunch/i.test(text)) return "lunch";
  if (/晚饭|晚餐|晚上|dinner/i.test(text)) return "dinner";
  if (/加餐|零食|夜宵|snack/i.test(text)) return "snack";
  return "unknown";
}

export function parseMeasurementText(text: string): MeasurementPatch {
  const result: MeasurementPatch = {};
  const weight = text.match(/体重\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kg|公斤)?/i);
  const bodyFat = text.match(/体脂\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i);
  const waist = text.match(/腰围\s*([0-9]+(?:\.[0-9]+)?)\s*(?:cm|厘米)?/i);
  if (weight?.[1]) result.weightKg = Number(weight[1]);
  if (bodyFat?.[1]) result.bodyFatPercent = Number(bodyFat[1]);
  if (waist?.[1]) result.waistCm = Number(waist[1]);
  return result;
}

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
  const gender = text.match(/(?:性别\s*)?(男|女)|男性|女性/);

  if (age?.[1]) result.age = Number(age[1]);
  if (height?.[1]) result.heightCm = Number(height[1]);
  if (gender?.[0]) result.gender = gender[0].includes("男") ? "male" : "female";
  return result;
}

export function summarizeBodyDataPatch(patch: BodyDataPatch): string {
  const profileParts = [
    patch.profile.age !== undefined ? `年龄 ${patch.profile.age} 岁` : "",
    patch.profile.heightCm !== undefined ? `身高 ${formatNumber(patch.profile.heightCm)} cm` : "",
    patch.profile.gender ? `性别 ${patch.profile.gender === "male" ? "男" : "女"}` : ""
  ].filter(Boolean);
  const measurementParts = [
    patch.measurements.weightKg !== undefined ? `体重 ${formatNumber(patch.measurements.weightKg)} kg` : "",
    patch.measurements.bodyFatPercent !== undefined ? `体脂 ${formatNumber(patch.measurements.bodyFatPercent)}%` : "",
    patch.measurements.waistCm !== undefined ? `腰围 ${formatNumber(patch.measurements.waistCm)} cm` : ""
  ].filter(Boolean);
  const lines = [];
  if (profileParts.length) lines.push(`已更新基础资料：${profileParts.join("，")}。`);
  if (measurementParts.length) lines.push(`已记录身体数据：${measurementParts.join("，")}。`);
  return lines.join("\n");
}

export function localDate(timeZone = "Asia/Shanghai", date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function localDateTime(timeZone = "Asia/Shanghai", date = new Date()): string {
  const day = localDate(timeZone, date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
  return `${day} ${time}`;
}

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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}
