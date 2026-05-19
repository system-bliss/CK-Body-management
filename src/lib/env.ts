export const REQUIRED_ENV_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "DASHBOARD_PASSWORD",
  "SESSION_SECRET",
  "OWNER_USER_ID",
  "WORKER_PUBLIC_BASE_URL",
  "TIMEZONE"
] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

export function missingRequiredEnvKeys(env: Partial<Record<RequiredEnvKey, unknown>>): RequiredEnvKey[] {
  return REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    if (typeof value === "string") return value.trim().length === 0;
    return value === undefined || value === null;
  });
}
