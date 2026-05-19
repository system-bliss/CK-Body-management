import { routeAgentRequest } from "agents";
import { BodyCoachAgent } from "./agent";
import type { AiEstimate, Env } from "./types";
import { estimateImageRecord, estimateTextRecord, generateDailyReport, generateRecordReviewFeedback, generateReminderText, generateWeeklyReport, summarizeEstimate } from "./lib/ai";
import { clearSessionCookie, createSessionCookie, verifyPassword, verifySessionCookie } from "./lib/dashboard-auth";
import { renderDashboard, renderLogin } from "./lib/dashboard";
import { missingRequiredEnvKeys } from "./lib/env";
import { detectMealType, localDate, parseBodyDataText, recordDateForText, summarizeBodyDataPatch, previousLocalDate, weekRangeFor } from "./lib/records";
import {
  buildDailyReviewData,
  buildWeeklyReviewData,
  getDashboardData,
  getProfile,
  reserveTelegramUpdate,
  saveIncomingMessage,
  saveMeasurements,
  saveProfilePatch,
  saveReport
} from "./lib/repository";
import { classifyScheduledReminder, reminderTypeForAction, type ScheduledAction } from "./lib/reminders";
import {
  fetchTelegramPhoto,
  normalizeTelegramUpdate,
  sendTelegramText,
  telegramMessageToStoredMessage,
  type TelegramInboundMessage,
  type TelegramUpdate
} from "./lib/telegram";

export { BodyCoachAgent };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const envError = validateEnv(env);
    if (envError) return envError;

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/telegram/webhook") return handleTelegramWebhook(request, env, ctx);
      if (url.pathname === "/dashboard") return handleDashboard(request, env);
      if (url.pathname === "/api/dashboard/login") return handleDashboardLogin(request, env);
      if (url.pathname === "/api/dashboard/logout") return handleDashboardLogout(request);
      if (url.pathname.startsWith("/api/photos/")) return handlePhoto(request, env);
      if (url.pathname === "/") return Response.redirect(new URL("/dashboard", request.url), 302);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ event: "request_error", message: error instanceof Error ? error.message : String(error) }));
      return new Response("Internal error", { status: 500 });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (validateEnv(env)) return;
    ctx.waitUntil(handleScheduled(event, env));
  }
};

function validateEnv(env: Env): Response | null {
  const missing = missingRequiredEnvKeys(env);
  if (missing.length === 0) return null;
  console.error(JSON.stringify({ event: "env_validation_failed", missing }));
  return new Response("Server misconfigured", { status: 500 });
}

async function handleTelegramWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const payload = (await request.json()) as TelegramUpdate;
  const message = normalizeTelegramUpdate(payload);
  if (!message) return Response.json({ ok: true, ignored: true });

  const reserved = await reserveTelegramUpdate(env, message.updateId, String(message.userId || message.chatId));
  if (!reserved) return Response.json({ ok: true, duplicate: true });

  ctx.waitUntil(handleIncomingTelegramMessage(env, message));
  return Response.json({ ok: true });
}

async function handleIncomingTelegramMessage(env: Env, message: TelegramInboundMessage): Promise<void> {
  const storedMessage = telegramMessageToStoredMessage(message);

  if (message.photoFileId) {
    const media = await fetchTelegramPhoto(env, message.photoFileId);
    const photoKey = `telegram/${message.chatId}/${Date.now()}-${crypto.randomUUID()}`;
    await env.PHOTOS.put(photoKey, media.bytes, { httpMetadata: { contentType: media.contentType } });
    const estimate = await estimateImageRecord(env, media.bytes, media.contentType, message.content);
    await saveIncomingMessage(env, storedMessage, estimate, {
      rawText: message.content || undefined,
      photoKey,
      contentType: media.contentType
    });
    const recordDate = localDate(env.TIMEZONE);
    const daily = await buildDailyReviewData(env, storedMessage.fromUserName, recordDate);
    const coachFeedback = await generateRecordReviewFeedback(env, estimate, {
      daily,
      recordDate,
      localDate: recordDate,
      rawText: message.content || undefined
    });
    await sendTelegramText(env, message.chatId, [summarizeEstimate(estimate), coachFeedback, "照片已保存，热量为 AI 估算。"].filter(Boolean).join("\n"));
    return;
  }

  if (message.content) {
    const recordDate = recordDateForText(message.content, env.TIMEZONE);
    const mealType = detectMealType(message.content);
    const bodyData = parseBodyDataText(message.content);
    const profile = await getProfile(env, storedMessage.fromUserName);
    const estimate = await estimateTextRecord(env, message.content, mealType, { ...profile, ...bodyData.profile });
    await saveIncomingMessage(env, storedMessage, estimate, { rawText: message.content, logDate: recordDate });
    await saveProfilePatch(env, storedMessage.fromUserName, bodyData.profile);
    await saveMeasurements(env, storedMessage.fromUserName, bodyData.measurements, recordDate);
    const daily = await buildDailyReviewData(env, storedMessage.fromUserName, recordDate);
    await sendTelegramText(env, message.chatId, await buildTextRecordReply(env, estimate, bodyData, daily, recordDate, localDate(env.TIMEZONE), message.content));
    return;
  }

  const estimate: AiEstimate = { entryType: "unknown", items: [], confidence: "low", estimated: true, notes: "Empty Telegram message" };
  await saveIncomingMessage(env, storedMessage, estimate);
  await sendTelegramText(env, message.chatId, "已收到，但我需要文字或图片才能帮你记录。");
}

async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const ok = await verifySessionCookie(request.headers.get("cookie"), env.SESSION_SECRET);
  if (!ok) return html(renderLogin());
  return html(await renderDashboard(env));
}

async function handleDashboardLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!(await verifyPassword(password, env.DASHBOARD_PASSWORD))) return html(renderLogin(true), 401);
  return new Response(null, {
    status: 302,
    headers: {
      location: "/dashboard",
      "set-cookie": await createSessionCookie(env.SESSION_SECRET)
    }
  });
}

function handleDashboardLogout(request: Request): Response {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  return new Response(null, {
    status: 302,
    headers: {
      location: "/dashboard",
      "set-cookie": clearSessionCookie()
    }
  });
}

async function handlePhoto(request: Request, env: Env): Promise<Response> {
  const ok = await verifySessionCookie(request.headers.get("cookie"), env.SESSION_SECRET);
  if (!ok) return new Response("Unauthorized", { status: 401 });
  const key = decodeURIComponent(new URL(request.url).pathname.replace("/api/photos/", ""));
  const object = await env.PHOTOS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=3600"
    }
  });
}

async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const decision = classifyScheduledReminder(new Date(event.scheduledTime), env.TIMEZONE);
  for (const action of decision.actions) {
    await handleScheduledAction(env, action, decision.localDate, decision.localTime);
  }
}

async function sendReminder(env: Env, content: string): Promise<void> {
  if (env.OWNER_TELEGRAM_CHAT_ID) await sendTelegramText(env, env.OWNER_TELEGRAM_CHAT_ID, content);
}

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

async function buildTextRecordReply(
  env: Env,
  estimate: AiEstimate,
  bodyData: ReturnType<typeof parseBodyDataText>,
  daily: Awaited<ReturnType<typeof buildDailyReviewData>>,
  recordDate: string,
  currentDate: string,
  rawText: string
): Promise<string> {
  const bodySummary = summarizeBodyDataPatch(bodyData);
  if (estimate.entryType === "unknown" && bodySummary) {
    return `${bodySummary}\n这些基础资料会用于后续 AI 估算；缺失围度不影响记录。`;
  }

  const lines = [summarizeEstimate(estimate)];
  if (bodySummary) lines.push(bodySummary);
  if (estimate.entryType !== "unknown") {
    lines.push(
      await generateRecordReviewFeedback(env, estimate, {
        daily,
        recordDate,
        localDate: currentDate,
        rawText,
        bodySummary
      })
    );
  }
  else lines.push("你可以继续补充份量、体重或运动情况。");
  return lines.join("\n");
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
