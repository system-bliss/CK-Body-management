import { describe, expect, it } from "vitest";
import { missingRequiredEnvKeys } from "../src/lib/env";

describe("environment validation", () => {
  it("reports missing required runtime variables without inspecting secret values", () => {
    expect(
      missingRequiredEnvKeys({
        TELEGRAM_BOT_TOKEN: " ",
        DASHBOARD_PASSWORD: "password",
        SESSION_SECRET: "",
        OWNER_USER_ID: "self",
        WORKER_PUBLIC_BASE_URL: "https://example.com",
        TIMEZONE: "Asia/Shanghai"
      })
    ).toEqual(["TELEGRAM_BOT_TOKEN", "SESSION_SECRET"]);
  });

  it("accepts a complete required environment", () => {
    expect(
      missingRequiredEnvKeys({
        TELEGRAM_BOT_TOKEN: "token",
        DASHBOARD_PASSWORD: "password",
        SESSION_SECRET: "secret",
        OWNER_USER_ID: "self",
        WORKER_PUBLIC_BASE_URL: "https://example.com",
        TIMEZONE: "Asia/Shanghai"
      })
    ).toEqual([]);
  });
});
