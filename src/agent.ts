import { Agent, callable } from "agents";
import type { AiEstimate, Env } from "./types";
import { estimateTextRecord, summarizeEstimate } from "./lib/ai";
import { detectMealType, localDate, parseBodyDataText } from "./lib/records";
import { buildDailyReview, saveMeasurements, saveProfilePatch, saveReport } from "./lib/repository";

export interface BodyCoachState {
  goal: "fat_loss";
  recentSummary: string;
  reminderSettings: {
    breakfast: string;
    lunch: string;
    dinner: string;
    dailyReview: string;
    weeklyReport: string;
  };
  profile: Record<string, unknown>;
}

export class BodyCoachAgent extends Agent<Env, BodyCoachState> {
  initialState: BodyCoachState = {
    goal: "fat_loss",
    recentSummary: "",
    reminderSettings: {
      breakfast: "08:00",
      lunch: "12:00",
      dinner: "18:00",
      dailyReview: "22:00",
      weeklyReport: "Sunday 21:00"
    },
    profile: {}
  };

  @callable()
  async recordMessage(input: { text: string; userId: string }): Promise<{ estimate: AiEstimate; summary: string }> {
    const estimate = await estimateTextRecord(this.env, input.text, detectMealType(input.text));
    const bodyData = parseBodyDataText(input.text);
    await saveProfilePatch(this.env, input.userId, bodyData.profile);
    await saveMeasurements(this.env, input.userId, bodyData.measurements);
    const summary = summarizeEstimate(estimate);
    this.setState({ ...this.state, recentSummary: summary });
    return { estimate, summary };
  }

  @callable()
  async generateDailyReview(date = localDate(this.env.TIMEZONE)): Promise<string> {
    const review = await buildDailyReview(this.env, this.env.OWNER_USER_ID, date);
    await saveReport(this.env, this.env.OWNER_USER_ID, "daily", date, review);
    this.setState({ ...this.state, recentSummary: review });
    return review;
  }

  @callable()
  async generateWeeklyReport(weekStart: string): Promise<string> {
    const content = `周报 ${weekStart}\n请查看 dashboard 的餐食、运动和身体趋势。建议下一周继续稳定记录三餐照片，优先保证蛋白质和训练连续性。`;
    await saveReport(this.env, this.env.OWNER_USER_ID, "weekly", weekStart, content);
    this.setState({ ...this.state, recentSummary: content });
    return content;
  }

  @callable()
  async updateProfile(profilePatch: Record<string, unknown>): Promise<BodyCoachState["profile"]> {
    const profile = { ...this.state.profile, ...profilePatch };
    this.setState({ ...this.state, profile });
    await this.env.DB.prepare("INSERT INTO profile (user_id, profile_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at")
      .bind(this.env.OWNER_USER_ID, JSON.stringify(profile))
      .run();
    return profile;
  }

  @callable()
  async scheduleReminders(settings: Partial<BodyCoachState["reminderSettings"]>): Promise<BodyCoachState["reminderSettings"]> {
    const reminderSettings = { ...this.state.reminderSettings, ...settings };
    this.setState({ ...this.state, reminderSettings });
    await this.env.DB.prepare("INSERT INTO reminder_settings (user_id, settings_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at")
      .bind(this.env.OWNER_USER_ID, JSON.stringify(reminderSettings))
      .run();
    return reminderSettings;
  }
}
