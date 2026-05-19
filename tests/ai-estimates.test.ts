import { describe, expect, it } from "vitest";
import {
  buildRecordCoachPrompt,
  buildDailyReportPrompt,
  buildImageEstimatePrompt,
  buildLocalTextFallbackEstimate,
  buildReminderPrompt,
  buildTextEstimatePrompt,
  estimateImageRecord,
  estimateTextRecord,
  extractModelText,
  generateRecordCoachFeedback,
  generateDailyReport,
  generateReminderText,
  parseAiEstimateJson,
  summarizeEstimate
} from "../src/lib/ai";
import type { DashboardData, Env } from "../src/types";

describe("AI estimate parsing", () => {
  it("extracts valid estimate JSON from fenced model output", () => {
    const parsed = parseAiEstimateJson(`Here is the estimate:\n\`\`\`json\n{
      "entryType": "meal",
      "mealType": "breakfast",
      "items": [{"name":"鸡蛋","amount":"2个","caloriesKcal":156,"proteinG":12}],
      "totalCaloriesKcal": 420,
      "confidence": "medium",
      "notes": "照片估算"
    }\n\`\`\``);

    expect(parsed.entryType).toBe("meal");
    expect(parsed.mealType).toBe("breakfast");
    expect(parsed.totalCaloriesKcal).toBe(420);
    expect(parsed.confidence).toBe("medium");
  });

  it("returns a low-confidence fallback when model output is invalid", () => {
    const parsed = parseAiEstimateJson("无法判断");

    expect(parsed.entryType).toBe("unknown");
    expect(parsed.confidence).toBe("low");
    expect(parsed.estimated).toBe(true);
  });

  it("summarizes meal estimates with calories without confidence labels", () => {
    const summary = summarizeEstimate({
      entryType: "meal",
      mealType: "breakfast",
      items: [{ name: "鸡蛋", amount: "2个", caloriesKcal: 156, proteinG: 12 }],
      totalCaloriesKcal: 420,
      totalProteinG: 22,
      confidence: "medium",
      estimated: true
    });

    expect(summary).toContain("早餐");
    expect(summary).toContain("约 420 kcal");
    expect(summary).toContain("蛋白质约 22 g");
    expect(summary).not.toContain("置信度");
    expect(summary).not.toContain("判断依据");
    expect(summary).not.toContain("可补充");
  });

  it("summarizes meal estimates with item details only", () => {
    const summary = summarizeEstimate({
      entryType: "meal",
      mealType: "breakfast",
      items: [
        { name: "鸡蛋", amount: "2个", caloriesKcal: 156, proteinG: 12, fatG: 10 },
        { name: "美式咖啡", amount: "一大杯", caloriesKcal: 10 }
      ],
      totalCaloriesKcal: 166,
      totalProteinG: 12,
      totalCarbsG: 1,
      totalFatG: 10,
      confidence: "medium",
      notes: "用户写了“一大杯美食”，按常见早餐语境推测为美式咖啡。",
      estimated: true
    });

    expect(summary).toContain("✅ 已记录早餐");
    expect(summary).toContain("鸡蛋 2个");
    expect(summary).toContain("约 156 kcal");
    expect(summary).toContain("合计估算");
    expect(summary).toContain("碳水约 1 g");
    expect(summary).not.toContain("判断依据");
    expect(summary).not.toContain("可补充");
  });

  it("tells the model to prefer meal classification when meal keywords are present", () => {
    const prompt = buildTextEstimatePrompt("早餐：两个鸡蛋，一大杯美式", "breakfast");

    expect(prompt).toContain("出现“早餐/早饭/午餐/午饭/晚餐/晚饭/加餐”等餐次词时，entryType 必须优先判为 meal");
    expect(prompt).toContain("常见错别字");
    expect(prompt).toContain("用户记录：早餐：两个鸡蛋，一大杯美式");
  });

  it("includes profile context in text estimate prompts when available", () => {
    const prompt = buildTextEstimatePrompt("午餐：鸡胸肉饭", "lunch", { age: 28, heightCm: 175 });

    expect(prompt).toContain("用户基础资料：年龄 28 岁，身高 175 cm");
    expect(prompt).toContain("用户记录：午餐：鸡胸肉饭");
  });

  it("extracts Kimi chat-completion content from Workers AI responses", () => {
    const text = extractModelText({
      choices: [
        {
          message: {
            role: "assistant",
            content: "{\"entryType\":\"meal\",\"mealType\":\"breakfast\",\"items\":[],\"confidence\":\"low\"}"
          }
        }
      ]
    });

    expect(text).toContain("\"entryType\":\"meal\"");
  });

  it("extracts text-completion choices from Workers AI responses", () => {
    const text = extractModelText({
      choices: [
        {
          finish_reason: "stop",
          text: "{\"entryType\":\"meal\",\"mealType\":\"lunch\",\"items\":[],\"confidence\":\"medium\"}"
        }
      ]
    });

    expect(text).toContain("\"mealType\":\"lunch\"");
  });

  it("extracts Kimi array content text from Workers AI responses", () => {
    const text = extractModelText({
      choices: [
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "{\"entryType\":\"meal\",\"items\":[],\"confidence\":\"low\"}" }]
          }
        }
      ]
    });

    expect(text).toContain("\"entryType\":\"meal\"");
  });

  it("extracts object response content from Workers AI vision responses", () => {
    const text = extractModelText({
      response: {
        entryType: "meal",
        mealType: "lunch",
        items: [{ name: "米饭", amount: "小碗" }],
        totalCaloriesKcal: 650,
        totalProteinG: 35,
        confidence: "medium",
        notes: "按图片估算"
      },
      usage: { total_tokens: 1234 }
    });

    const parsed = parseAiEstimateJson(text);

    expect(parsed.entryType).toBe("meal");
    expect(parsed.mealType).toBe("lunch");
    expect(parsed.totalCaloriesKcal).toBe(650);
    expect(parsed.items.map((item) => item.name)).toContain("米饭");
  });

  it("tells the vision model to estimate visible foods instead of asking for more info", () => {
    const prompt = buildImageEstimatePrompt("午餐");

    expect(prompt).toContain("必须基于图片中可见内容给出估算");
    expect(prompt).toContain("不要因为无法精确称重就输出 unknown");
    expect(prompt).toContain("食堂餐盘");
    expect(prompt).toContain("用户补充：午餐");
  });

  it("uses a local meal fallback for obvious food text when model output is unusable", () => {
    const estimate = buildLocalTextFallbackEstimate("早餐：两个鸡蛋，一大杯库迪咖啡的冰美式", "breakfast");

    expect(estimate).not.toBeNull();
    if (!estimate) throw new Error("Expected a local fallback estimate");
    expect(estimate.entryType).toBe("meal");
    expect(estimate.mealType).toBe("breakfast");
    expect(estimate.totalCaloriesKcal).toBeGreaterThanOrEqual(150);
    expect(estimate.items.map((item) => item.name)).toContain("鸡蛋");
    expect(estimate.items.map((item) => item.name)).toContain("冰美式咖啡");
  });

  it("uses a local meal fallback for boiled eggs and typoed iced americano", () => {
    const estimate = buildLocalTextFallbackEstimate("早餐两个水煮鸡蛋，一个蛋黄未吃 一大杯冰美食", "breakfast");

    expect(estimate).not.toBeNull();
    if (!estimate) throw new Error("Expected a local fallback estimate");
    expect(estimate.entryType).toBe("meal");
    expect(estimate.mealType).toBe("breakfast");
    expect(estimate.totalCaloriesKcal).toBeGreaterThan(80);
    expect(estimate.items.map((item) => item.name)).toContain("水煮鸡蛋");
    expect(estimate.items.map((item) => item.name)).toContain("冰美式咖啡");
  });

  it("uses a local measurement fallback when body data text is obvious", async () => {
    const env = {
      AI: {
        run: async () => "无法判断"
      }
    } as unknown as Env;

    const estimate = await estimateTextRecord(env, "今早空腹体重 72kg身高176CM，年龄26岁，性别男", "unknown");

    expect(estimate.entryType).toBe("measurement");
    expect(estimate.confidence).toBe("high");
    expect(estimate.notes).toContain("体重");
  });

  it("keeps a captioned meal photo recordable when the vision model output is unusable", async () => {
    const env = {
      AI: {
        run: async () => "unusable"
      }
    } as unknown as Env;

    const estimate = await estimateImageRecord(env, new Uint8Array([1, 2, 3]).buffer, "image/jpeg", "午餐");

    expect(estimate.entryType).toBe("meal");
    expect(estimate.mealType).toBe("lunch");
    expect(estimate.confidence).toBe("low");
    expect(estimate.items.length).toBeGreaterThan(0);
  });

  it("uses pure base64 vision description before structured image estimates", async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const env = {
      WORKERS_AI_IMAGE_MODEL: "vision-model",
      WORKERS_AI_TEXT_MODEL: "text-model",
      AI: {
        run: async (model: string, input: Record<string, unknown>) => {
          calls.push({ model, input });
          if (model === "vision-model") {
            return { response: "A cafeteria lunch tray with rice, egg drop soup, vegetables, fish, chicken soup, and yogurt." };
          }
          return {
            response: {
              entryType: "meal",
              mealType: "lunch",
              items: [{ name: "米饭", amount: "小碗", caloriesKcal: 116, proteinG: 3 }],
              totalCaloriesKcal: 900,
              totalProteinG: 70,
              confidence: "medium",
              notes: "按图片描述估算"
            }
          };
        }
      }
    } as unknown as Env;

    const estimate = await estimateImageRecord(env, new Uint8Array([1, 2, 3]).buffer, "image/jpeg", "午餐");

    expect(calls).toHaveLength(2);
    expect(calls[0]?.model).toBe("vision-model");
    expect(calls[0]?.input.image).toBe("AQID");
    expect(String(calls[0]?.input.image)).not.toContain("data:image");
    expect(calls[1]?.model).toBe("text-model");
    expect(String(calls[1]?.input.prompt)).toContain("cafeteria lunch tray");
    expect(calls[1]?.input.max_tokens).toBe(1024);
    expect(estimate.entryType).toBe("meal");
    expect(estimate.totalCaloriesKcal).toBe(900);
    expect(estimate.totalProteinG).toBe(70);
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

  it("builds an AI coach prompt with 100-point scoring and recent state", () => {
    const prompt = buildRecordCoachPrompt(
      {
        entryType: "meal",
        mealType: "breakfast",
        items: [{ name: "水煮鸡蛋", amount: "2个", caloriesKcal: 101, proteinG: 12 }],
        totalCaloriesKcal: 111,
        totalProteinG: 12,
        totalCarbsG: 2,
        totalFatG: 5,
        confidence: "medium",
        estimated: true
      },
      { dashboard: dashboardData() }
    );

    expect(prompt).toContain("100 分制");
    expect(prompt).toContain("本餐评分");
    expect(prompt).toContain("下一餐建议");
    expect(prompt).toContain("运动建议");
    expect(prompt).toContain("今日综合评分");
    expect(prompt).toContain("今日已记录：1 餐");
    expect(prompt).toContain("最近身体数据：72.4 kg");
  });

  it("generates AI coach feedback with scores and filters confidence text", async () => {
    const env = {
      AI: {
        run: async () => ({
          response:
            "本餐评分：82/100。蛋白质不错，热量轻，适合作为早餐。\n下一餐建议：午餐补足蔬菜和优质蛋白，主食适量，少油少糖。\n运动建议：今天目标 8000 步，午饭后走 10-15 分钟。\n今日综合评分：78/100。继续补齐午晚餐记录。\n置信度：高。"
        })
      },
      WORKERS_AI_TEXT_MODEL: "text-model"
    } as unknown as Env;

    const feedback = await generateRecordCoachFeedback(
      env,
      {
        entryType: "meal",
        mealType: "breakfast",
        items: [{ name: "水煮鸡蛋", amount: "2个", caloriesKcal: 101, proteinG: 12 }],
        totalCaloriesKcal: 111,
        totalProteinG: 12,
        totalCarbsG: 2,
        totalFatG: 5,
        confidence: "medium",
        estimated: true
      },
      { dashboard: dashboardData() }
    );

    expect(feedback).toContain("本餐评分：82/100");
    expect(feedback).toContain("下一餐建议");
    expect(feedback).toContain("运动建议");
    expect(feedback).toContain("今日综合评分：78/100");
    expect(feedback).not.toContain("置信度");
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

  it("deduplicates repeated reminder sentences before sending", async () => {
    const repeatedSentence = "下午容易犯困，起来接杯水、站几分钟，比坐着刷手机更解乏。";
    const env = {
      AI: {
        run: async () => ({
          response: `午餐已经记录了，别催吃饭，可以温和提醒下午的饮水或活动。午餐已记录，提醒下午补水或走动。${repeatedSentence}${repeatedSentence}${repeatedSentence.slice(0, 20)}`
        })
      },
      WORKERS_AI_TEXT_MODEL: "text-model"
    } as unknown as Env;

    const content = await generateReminderText(env, {
      type: "lunch",
      localDate: "2026-05-19",
      localTime: "12:30",
      todayMealCount: 2,
      hasMealForType: true,
      profile: {}
    });

    expect(content).toBe("午餐已记录，下午记得补水或走动。下午容易犯困，起来接杯水、站几分钟，比坐着刷手机更解乏。");
  });

  it("normalizes recorded dinner reminders without afternoon wording", async () => {
    const env = {
      AI: {
        run: async () => ({ response: "晚餐已记录，提醒补水或轻微活动。" })
      },
      WORKERS_AI_TEXT_MODEL: "text-model"
    } as unknown as Env;

    const content = await generateReminderText(env, {
      type: "dinner",
      localDate: "2026-05-19",
      localTime: "18:00",
      todayMealCount: 3,
      hasMealForType: true,
      profile: {}
    });

    expect(content).toBe("晚餐已记录，今晚适当走动，记得补水。");
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
});

function dashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    profile: { age: 28, heightCm: 175 },
    today: {
      date: "2026-05-19",
      caloriesKcal: 111,
      proteinG: 12,
      exerciseCaloriesKcal: 0,
      mealCount: 1,
      hasBreakfast: true,
      hasLunch: false,
      hasDinner: false
    },
    meals: [{ log_date: "2026-05-19", meal_type: "breakfast", calories_kcal: 111, protein_g: 12, summary: "水煮鸡蛋、冰美式咖啡" }],
    exercises: [],
    measurements: [{ measured_at: "2026-05-19 09:20:00", weight_kg: 72.4, body_fat_percent: null, waist_cm: null }],
    estimates: [],
    reports: [],
    ...overrides
  };
}
