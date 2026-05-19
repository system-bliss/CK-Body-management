import { describe, expect, it } from "vitest";
import { clearSessionCookie, createSessionCookie, verifyPassword, verifySessionCookie } from "../src/lib/dashboard-auth";

describe("dashboard auth", () => {
  it("verifies password without exposing the expected value", async () => {
    await expect(verifyPassword("secret", "secret")).resolves.toBe(true);
    await expect(verifyPassword("nope", "secret")).resolves.toBe(false);
  });

  it("creates and verifies an expiring signed session cookie", async () => {
    const cookie = await createSessionCookie("secret", 1_700_000_000);

    await expect(verifySessionCookie(cookie, "secret", 1_700_000_100)).resolves.toBe(true);
    await expect(verifySessionCookie(cookie, "secret", 1_710_000_000)).resolves.toBe(false);
    await expect(verifySessionCookie(cookie, "other", 1_700_000_100)).resolves.toBe(false);
  });

  it("creates a cookie header that clears the dashboard session", () => {
    const cookie = clearSessionCookie();

    expect(cookie).toContain("ck_session=;");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/");
  });
});
