import { z } from "zod";
import type { AiEstimate, BodyProfile, DailyReviewData, DashboardData, Env, MealType, ReminderContext, WeeklyReviewData } from "../types";
import { detectMealType, parseBodyDataText, summarizeBodyDataPatch } from "./records";

const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const DEFAULT_IMAGE_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

const estimateSchema = z.object({
  entryType: z.enum(["meal", "exercise", "measurement", "unknown"]).catch("unknown"),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack", "unknown"]).optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        amount: z.string().optional(),
        caloriesKcal: z.coerce.number().nonnegative().optional(),
        proteinG: z.coerce.number().nonnegative().optional(),
        carbsG: z.coerce.number().nonnegative().optional(),
        fatG: z.coerce.number().nonnegative().optional()
      })
    )
    .catch([]),
  totalCaloriesKcal: z.coerce.number().nonnegative().optional(),
  totalProteinG: z.coerce.number().nonnegative().optional(),
  totalCarbsG: z.coerce.number().nonnegative().optional(),
  totalFatG: z.coerce.number().nonnegative().optional(),
  exerciseMinutes: z.coerce.number().nonnegative().optional(),
  exerciseCaloriesKcal: z.coerce.number().nonnegative().optional(),
  confidence: z.enum(["low", "medium", "high"]).catch("low"),
  notes: z.string().optional()
});

const mealLabels: Record<MealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
  unknown: "餐食"
};

export function parseAiEstimateJson(output: string): AiEstimate {
  const jsonText = extractJsonObject(output);
  if (!jsonText) return fallbackEstimate("AI 没有返回可解析的 JSON");

  try {
    const parsed = estimateSchema.parse(JSON.parse(jsonText));
    return { ...parsed, items: parsed.items, estimated: true };
  } catch {
    return fallbackEstimate("AI 输出格式异常，已按低置信度记录");
  }
}

export function summarizeEstimate(estimate: AiEstimate): string {
  if (estimate.entryType === "exercise") {
    const minutes = estimate.exerciseMinutes ? `${estimate.exerciseMinutes} 分钟` : "运动";
    const calories = estimate.exerciseCaloriesKcal ? `，约消耗 ${Math.round(estimate.exerciseCaloriesKcal)} kcal` : "";
    return `已记录：${minutes}${calories}。`;
  }

  if (estimate.entryType === "measurement") {
    return "已记录身体数据。";
  }

  if (estimate.entryType === "meal") {
    const meal = mealLabels[estimate.mealType ?? "unknown"];
    return [
      `✅ 已记录${meal}`,
      summarizeMealItems(estimate),
      summarizeMealTotals(estimate)
    ]
      .filter(Boolean)
      .join("\n");
  }

  return "已收到记录，但需要你补充一下内容。";
}

export function buildTextEstimatePrompt(text: string, fallbackMealType?: MealType, profile: BodyProfile = {}): string {
  return [
    "你是一个中文减脂塑形记录助手。请把用户的饮食、运动或身体数据记录解析成严格 JSON。",
    "只输出一个 JSON 对象，不要 Markdown，不要解释文字，不要代码块。",
    "JSON 字段必须使用：entryType, mealType, items, totalCaloriesKcal, totalProteinG, totalCarbsG, totalFatG, exerciseMinutes, exerciseCaloriesKcal, confidence, notes。",
    "entryType 只能是 meal/exercise/measurement/unknown；mealType 只能是 breakfast/lunch/dinner/snack/unknown；confidence 只能是 low/medium/high。",
    "出现“早餐/早饭/午餐/午饭/晚餐/晚饭/加餐”等餐次词时，entryType 必须优先判为 meal，除非用户明确是在记录运动或身体数据。",
    "常见错别字要结合饮食语境纠正，例如“一大杯美食”很可能是“一大杯美式咖啡”，不要因此判成 unknown 或 exercise。",
    "餐食记录必须尽量拆成 items；每个 item 尽量给 name、amount、caloriesKcal、proteinG、carbsG、fatG。",
    "如果用户给了数量但没有重量，请按中国常见份量估算，并在 notes 里写明关键假设。",
    "如果是饮品，注意是否可能无糖；不确定时按低热量饮品估算，并在 notes 里提醒补充是否加糖/奶。",
    "如果信息不足，不要把餐食判为 unknown；应输出 meal + low confidence + notes 说明需要补充什么。",
    fallbackMealType ? `外部规则已识别餐次为 ${fallbackMealType}，除非用户文本明显矛盾，否则 mealType 使用它。` : "",
    profileContext(profile),
    `用户记录：${text}`
  ]
    .filter(Boolean)
    .join("\n");
}

export async function estimateTextRecord(env: Env, text: string, fallbackMealType?: MealType, profile: BodyProfile = {}): Promise<AiEstimate> {
  const prompt = buildTextEstimatePrompt(text, fallbackMealType, profile);

  const result = await env.AI.run(env.WORKERS_AI_TEXT_MODEL || DEFAULT_TEXT_MODEL, {
    prompt,
    max_completion_tokens: 1024,
    temperature: 0.2,
    response_format: { type: "json_object" },
    chat_template_kwargs: { enable_thinking: false }
  });
  const parsed = parseAiEstimateJson(extractModelText(result));
  if (parsed.entryType === "unknown") return buildLocalTextFallbackEstimate(text, fallbackMealType) ?? parsed;
  return parsed;
}

function summarizeMealItems(estimate: AiEstimate): string {
  if (estimate.items.length === 0) return "明细：暂未拆出具体食物。";
  const lines = estimate.items.slice(0, 6).map((item) => {
    const macros = [
      item.caloriesKcal !== undefined ? `约 ${Math.round(item.caloriesKcal)} kcal` : "",
      item.proteinG !== undefined ? `蛋白 ${Math.round(item.proteinG)} g` : "",
      item.carbsG !== undefined ? `碳水 ${Math.round(item.carbsG)} g` : "",
      item.fatG !== undefined ? `脂肪 ${Math.round(item.fatG)} g` : ""
    ].filter(Boolean);
    const amount = item.amount ? ` ${item.amount}` : "";
    return `- ${item.name}${amount}${macros.length ? `：${macros.join("，")}` : ""}`;
  });
  return ["明细：", ...lines].join("\n");
}

function summarizeMealTotals(estimate: AiEstimate): string {
  const totals = [
    estimate.totalCaloriesKcal !== undefined ? `热量约 ${Math.round(estimate.totalCaloriesKcal)} kcal` : "",
    estimate.totalProteinG !== undefined ? `蛋白质约 ${Math.round(estimate.totalProteinG)} g` : "",
    estimate.totalCarbsG !== undefined ? `碳水约 ${Math.round(estimate.totalCarbsG)} g` : "",
    estimate.totalFatG !== undefined ? `脂肪约 ${Math.round(estimate.totalFatG)} g` : ""
  ].filter(Boolean);
  return totals.length ? `合计估算：${totals.join("，")}。` : "合计估算：热量和营养待确认。";
}

export async function estimateImageRecord(env: Env, image: ArrayBuffer, contentType: string, hint?: string): Promise<AiEstimate> {
  const base64 = arrayBufferToBase64(image);
  const visionResult = await env.AI.run(env.WORKERS_AI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL, {
    prompt: buildImageVisionPrompt(hint),
    image: base64,
    max_tokens: 1024,
    temperature: 0.1
  });
  const visionText = extractModelText(visionResult);
  const directVisionEstimate = parseAiEstimateJson(visionText);
  if (directVisionEstimate.entryType !== "unknown") return directVisionEstimate;

  const result = await env.AI.run(env.WORKERS_AI_TEXT_MODEL || DEFAULT_TEXT_MODEL, {
    prompt: buildImageDescriptionEstimatePrompt(visionText, hint),
    max_tokens: 1024,
    temperature: 0.2,
    response_format: { type: "json_object" },
    chat_template_kwargs: { enable_thinking: false }
  });
  const parsed = parseAiEstimateJson(extractModelText(result));
  if (parsed.entryType === "unknown") return buildLocalImageFallbackEstimate(hint) ?? parsed;
  return parsed;
}

export function buildImageVisionPrompt(hint?: string): string {
  return [
    "This image is a meal photo. It does not contain people. Describe only the visible foods, containers, and likely portions.",
    "Focus on food recognition for nutrition logging. Do not identify people or discuss identity.",
    "Mention staple food, soup, vegetables, meat/fish/egg/tofu, drinks/yogurt, and visible portion sizes.",
    hint ? `User caption: ${hint}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildImageDescriptionEstimatePrompt(description: string, hint?: string): string {
  return [
    "你是中文营养估算助手。下面是视觉模型对一张餐食照片的描述，请基于描述自行估算热量和营养，不要要求用户补充。",
    "只输出一个 JSON 对象，不要 Markdown，不要解释文字，不要代码块。",
    "JSON 字段必须使用：entryType, mealType, items, totalCaloriesKcal, totalProteinG, totalCarbsG, totalFatG, confidence, notes。",
    "entryType 必须是 meal；mealType 根据用户补充或描述判断，无法判断用 unknown；confidence 只能是 low/medium/high。",
    "items 每项尽量给 name, amount, caloriesKcal, proteinG, carbsG, fatG；份量不确定时按常见食堂餐盘估算并在 notes 说明。",
    hint ? `用户补充：${hint}` : "",
    `视觉描述：${description}`
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildLocalImageFallbackEstimate(hint?: string): AiEstimate | null {
  const mealType = hint ? detectMealType(hint) : "unknown";
  if (mealType === "unknown") return null;
  return {
    entryType: "meal",
    mealType,
    items: [{ name: "照片餐食", amount: "按图片可见份量待确认" }],
    confidence: "low",
    notes: "图片 AI 未返回可用明细，已根据餐次文字先保存为餐食记录；补充食物名称或份量后可再修正。",
    estimated: true
  };
}

export function buildImageEstimatePrompt(hint?: string): string {
  return [
    "你是一个会看图记录饮食的中文生活助手和营养估算师。",
    "必须基于图片中可见内容给出估算，不要因为无法精确称重就输出 unknown，也不要只要求用户补充。",
    "如果图片是食堂餐盘、外卖、家庭餐或餐厅菜，请按可见容器大小和常见份量拆分每一道食物。",
    "请主动识别主食、汤、蔬菜、肉/鱼/蛋/豆制品、饮品/酸奶/水果等；看不清时也要按最可能类别做低置信度估算。",
    "每个 item 都要尽量给 name、amount、caloriesKcal、proteinG、carbsG、fatG；合计 totalCaloriesKcal、totalProteinG、totalCarbsG、totalFatG。",
    "notes 要像生活助手一样写判断依据，例如“按小碗米饭约100g、清炒蔬菜少油、鱼肉约120g估算”。",
    "只输出一个 JSON 对象，不要 Markdown，不要解释文字，不要代码块。",
    "JSON 字段必须使用：entryType, mealType, items, totalCaloriesKcal, totalProteinG, totalCarbsG, totalFatG, confidence, notes。",
    "entryType 必须是 meal；mealType 根据用户补充或拍摄时间判断，无法判断用 unknown；confidence 用 low/medium/high。",
    hint ? `用户补充：${hint}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

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

export interface RecordCoachContext {
  dashboard: DashboardData;
  bodySummary?: string | undefined;
}

export function buildRecordCoachPrompt(estimate: AiEstimate, context: RecordCoachContext): string {
  const today = context.dashboard.today;
  return [
    "你是一个中文减脂塑形生活教练。请根据本次记录、今日累计和近期身体状态，写一段 Telegram 回复中的教练反馈。",
    "必须使用 100 分制。评分要基于真实日常生活，不要用固定模板硬套；可以结合餐次、食材结构、油脂/糖分风险、蛋白质、今日累计和近期身体状态。",
    "只输出 5 行，不要 Markdown，不要表格，不要医疗建议，不要输出置信度、判断依据或可补充。",
    "固定行名：本餐评分、菜品评价、下一餐建议、运动建议、今日综合评分。",
    "下一餐建议要具体，例如午餐过油时提醒下午少吃碳水、不摄入糖分、低油；早餐偏轻时提醒午餐补充蔬菜和优质蛋白。",
    "运动建议要贴近日常，例如 8000 步、饭后 10-15 分钟散步、久坐起身活动；需要根据近期身体状态调整语气。",
    `本次餐次：${mealLabels[estimate.mealType ?? "unknown"]}`,
    `本次明细：${estimate.items.map((item) => `${item.name}${item.amount ? ` ${item.amount}` : ""}`).join("，") || "未拆分"}`,
    `本次合计：${mealTotalText(estimate)}`,
    `今日已记录：${today.mealCount} 餐，${Math.round(today.caloriesKcal)} kcal，蛋白 ${Math.round(today.proteinG)} g，运动消耗 ${Math.round(today.exerciseCaloriesKcal)} kcal`,
    `今日餐次状态：早餐${today.hasBreakfast ? "已记录" : "未记录"}，午餐${today.hasLunch ? "已记录" : "未记录"}，晚餐${today.hasDinner ? "已记录" : "未记录"}`,
    `最近身体数据：${latestBodyStateText(context.dashboard)}`,
    context.bodySummary ? `本次身体资料更新：${context.bodySummary}` : "",
    "请直接输出给用户看的中文内容。"
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateRecordCoachFeedback(env: Env, estimate: AiEstimate, context: RecordCoachContext): Promise<string> {
  if (estimate.entryType !== "meal") return "";
  try {
    const result = await env.AI.run(env.WORKERS_AI_TEXT_MODEL || DEFAULT_TEXT_MODEL, {
      prompt: buildRecordCoachPrompt(estimate, context),
      max_tokens: 512,
      temperature: 0.55,
      chat_template_kwargs: { enable_thinking: false }
    });
    return sanitizeCoachFeedback(extractModelText(result)) || fallbackRecordCoachFeedback(estimate, context);
  } catch {
    return fallbackRecordCoachFeedback(estimate, context);
  }
}

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
    "如果当前餐次已记录，不要催促记录这餐，只提醒补水或轻微活动。",
    "请只输出最终一条提醒正文，不要输出分析、候选文案或重复句子。"
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
    return sanitizeReminderText(extractModelText(result), context, 120) || fallbackReminderText(context);
  } catch {
    return fallbackReminderText(context);
  }
}

function extractJsonObject(output: string): string | null {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? output;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function extractModelText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const object = result as Record<string, unknown>;
    if (typeof object.response === "string") return object.response;
    if (object.response && typeof object.response === "object") return JSON.stringify(object.response);
    if (typeof object.result === "string") return object.result;
    if (object.result && typeof object.result === "object") return extractModelText(object.result);
    if (typeof object.text === "string") return object.text;
    const choiceText = extractChoiceText(object.choices);
    if (choiceText) return choiceText;
  }
  return JSON.stringify(result);
}

export function buildLocalTextFallbackEstimate(text: string, fallbackMealType?: MealType): AiEstimate | null {
  const mealType = fallbackMealType ?? inferMealType(text);
  const items = [];
  const bodyData = parseBodyDataText(text);
  const bodyDataSummary = summarizeBodyDataPatch(bodyData);

  const eggMatch = text.match(/([一二两三四五六七八九十\d]+)\s*(?:个|颗)?(?:水煮|白煮|煮|蒸)?鸡蛋/);
  if (eggMatch) {
    const count = chineseNumberToInt(eggMatch[1] ?? "") ?? 1;
    const yolkSkipped = /(?:一个|1个|一颗|1颗)?蛋黄(?:未吃|没吃|不吃|去掉|去除)/.test(text);
    items.push({
      name: /水煮|白煮|煮/.test(text) ? "水煮鸡蛋" : "鸡蛋",
      amount: `${count}个${yolkSkipped ? "（1个蛋黄未吃）" : ""}`,
      caloriesKcal: Math.max(0, count * 78 - (yolkSkipped ? 55 : 0)),
      proteinG: count * 6,
      carbsG: count * 0.6,
      fatG: Math.max(0, count * 5 - (yolkSkipped ? 5 : 0))
    });
  }

  if (/冰美食|美式|冰美式|咖啡|库迪/i.test(text)) {
    const hasMilkOrSugar = /奶|拿铁|糖|甜|加糖|椰乳|厚乳/i.test(text);
    items.push({
      name: /冰美食|冰美式|冰/.test(text) ? "冰美式咖啡" : "美式咖啡",
      amount: /大杯|一大杯/.test(text) ? "一大杯" : undefined,
      caloriesKcal: hasMilkOrSugar ? 80 : 10,
      proteinG: hasMilkOrSugar ? 3 : 0,
      carbsG: hasMilkOrSugar ? 8 : 1,
      fatG: hasMilkOrSugar ? 3 : 0
    });
  }

  if (items.length === 0) {
    if (!bodyDataSummary) return null;
    return {
      entryType: "measurement",
      items: [],
      confidence: "high",
      notes: bodyDataSummary,
      estimated: true
    };
  }
  if (mealType === "unknown") return null;
  const totals = items.reduce(
    (sum, item) => ({
      caloriesKcal: sum.caloriesKcal + (item.caloriesKcal ?? 0),
      proteinG: sum.proteinG + (item.proteinG ?? 0),
      carbsG: sum.carbsG + (item.carbsG ?? 0),
      fatG: sum.fatG + (item.fatG ?? 0)
    }),
    { caloriesKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
  return {
    entryType: "meal",
    mealType,
    items,
    totalCaloriesKcal: totals.caloriesKcal,
    totalProteinG: totals.proteinG,
    totalCarbsG: totals.carbsG,
    totalFatG: totals.fatG,
    confidence: "medium",
    notes: "模型输出不可用时，根据文本中的明确食物和常见份量做了保守估算。",
    estimated: true
  };
}

function extractChoiceText(choices: unknown): string {
  if (!Array.isArray(choices)) return "";
  const texts: string[] = [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const text = (choice as Record<string, unknown>).text;
    if (typeof text === "string") texts.push(text);
    const message = (choice as Record<string, unknown>).message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") texts.push(content);
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== "object") continue;
          const text = (part as Record<string, unknown>).text;
          if (typeof text === "string") texts.push(text);
        }
      }
    }
  }
  return texts.join("\n");
}

function inferMealType(text: string): MealType {
  if (/早餐|早饭|早上|早晨/.test(text)) return "breakfast";
  if (/午餐|午饭|中饭|中午/.test(text)) return "lunch";
  if (/晚餐|晚饭|晚上/.test(text)) return "dinner";
  if (/加餐|零食|夜宵/.test(text)) return "snack";
  return "unknown";
}

function chineseNumberToInt(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[value] ?? null;
}

function fallbackEstimate(notes: string): AiEstimate {
  return {
    entryType: "unknown",
    items: [],
    confidence: "low",
    notes,
    estimated: true
  };
}

function profileContext(profile: BodyProfile): string {
  const parts = [
    profile.age !== undefined ? `年龄 ${profile.age} 岁` : "",
    profile.heightCm !== undefined ? `身高 ${profile.heightCm} cm` : "",
    profile.gender ? `性别 ${profile.gender === "male" ? "男" : "女"}` : ""
  ].filter(Boolean);
  return parts.length ? `用户基础资料：${parts.join("，")}。资料缺失时不要阻塞估算，只在置信度和建议中体现。` : "";
}

function sanitizeShortText(value: string, maxLength = 280): string {
  return stripModelTextDecorations(value)
    .slice(0, maxLength)
    .trim();
}

function stripModelTextDecorations(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
}

function sanitizeCoachFeedback(value: string, maxLength = 520): string {
  const blocked = /置信度|判断依据|可补充/;
  const lines = stripModelTextDecorations(value)
    .replace(/^\s*[-*]\s+/gm, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !blocked.test(line));

  const text = lines.join("\n").trim();
  if (text.length <= maxLength) return text;
  const truncatedLines: string[] = [];
  for (const line of lines) {
    if ((truncatedLines.join("\n") + "\n" + line).trim().length > maxLength) break;
    truncatedLines.push(line);
  }
  return truncatedLines.join("\n").trim() || text.slice(0, maxLength).trim();
}

function mealTotalText(estimate: AiEstimate): string {
  return [
    estimate.totalCaloriesKcal !== undefined ? `${Math.round(estimate.totalCaloriesKcal)} kcal` : "",
    estimate.totalProteinG !== undefined ? `蛋白 ${Math.round(estimate.totalProteinG)} g` : "",
    estimate.totalCarbsG !== undefined ? `碳水 ${Math.round(estimate.totalCarbsG)} g` : "",
    estimate.totalFatG !== undefined ? `脂肪 ${Math.round(estimate.totalFatG)} g` : ""
  ]
    .filter(Boolean)
    .join("，") || "暂无合计";
}

function latestBodyStateText(dashboard: DashboardData): string {
  const latestMeasurement = dashboard.measurements[0];
  if (!latestMeasurement) return "未记录";
  const values = [
    formatOptionalMetric(latestMeasurement.weight_kg, "kg"),
    formatOptionalMetric(latestMeasurement.body_fat_percent, "%"),
    formatOptionalMetric(latestMeasurement.waist_cm, "cm")
  ].filter(Boolean);
  return values.join("，") || "未记录";
}

function formatOptionalMetric(value: unknown, unit: string): string {
  return typeof value === "number" ? `${value} ${unit}` : "";
}

function fallbackRecordCoachFeedback(estimate: AiEstimate, context: RecordCoachContext): string {
  const meal = mealLabels[estimate.mealType ?? "unknown"];
  const score = estimate.totalProteinG && estimate.totalProteinG >= 20 ? 82 : 76;
  const dailyScore = context.dashboard.today.mealCount >= 3 ? 84 : 78;
  return [
    `本餐评分：${score}/100。${meal}已记录，整体结构可以继续优化。`,
    "菜品评价：优点是记录清楚；如果蔬菜或优质蛋白偏少，下一餐补上会更稳。",
    "下一餐建议：主食适量，少油少糖，优先补充蔬菜和优质蛋白。",
    "运动建议：今天先守住 8000 步，餐后轻松走 10-15 分钟。",
    `今日综合评分：${dailyScore}/100。继续把剩余餐次记录完整，晚点复盘会更准。`
  ].join("\n");
}

function sanitizeReminderText(value: string, context: ReminderContext, maxLength = 120): string {
  const cleaned = stripModelTextDecorations(value).replace(/\s+/g, " ");
  const sentences = cleaned.match(/[^。！？!?]+[。！？!?]?/g) ?? [cleaned];
  const accepted: string[] = [];
  const seen = new Set<string>();

  for (const rawSentence of sentences) {
    const sentence = normalizeReminderSentence(rawSentence, context);
    if (!sentence) continue;

    const key = sentence.replace(/[。！？!?，,、\s]/g, "");
    if (!key) continue;
    if (seen.has(key) || [...seen].some((item) => item.startsWith(key) || key.startsWith(item))) continue;

    const next = accepted.join("") + sentence;
    if (next.length > maxLength) {
      if (accepted.length > 0) break;
      return sentence.slice(0, maxLength).trim();
    }

    accepted.push(sentence);
    seen.add(key);
  }

  return accepted.join("").trim();
}

function normalizeReminderSentence(value: string, context: ReminderContext): string {
  const sentence = value.trim();
  if (!sentence) return "";
  if (!/[。！？!?]$/.test(sentence) && sentence.length < 24) return "";

  if (context.hasMealForType && isRecordedMealReminderSentence(sentence, context.type)) {
    return recordedMealFollowUp(context.type);
  }

  return /[。！？!?]$/.test(sentence) ? sentence : `${sentence}。`;
}

function recordedMealFollowUp(type: ReminderContext["type"]): string {
  if (type === "breakfast") return "早餐已记录，上午记得补水或走动。";
  if (type === "lunch") return "午餐已记录，下午记得补水或走动。";
  return "晚餐已记录，今晚适当走动，记得补水。";
}

function isRecordedMealReminderSentence(sentence: string, type: ReminderContext["type"]): boolean {
  const meal = mealLabels[type];
  return (
    sentence.includes(`${meal}已记录`) ||
    sentence.includes(`${meal}已经记录`) ||
    sentence.includes("别催吃饭") ||
    sentence.includes("温和提醒")
  ) && /补水|饮水|走动|活动|接杯水|站/.test(sentence);
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
