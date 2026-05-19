# Dashboard, Telegram Recording, Reports, and Reminders Design

Date: 2026-05-19
Project: CK Body Management

## Context

The project is a Cloudflare Workers application with Telegram Bot webhook input, Workers AI estimation, D1 storage, R2 photo storage, a password-protected dashboard, scheduled reminders, and basic daily report generation.

Current behavior:

- Telegram text and photo messages are recorded as AI estimates.
- Meal, exercise, and measurement entries are persisted in D1.
- Dashboard shows recent measurements, reports, meal records, and photos.
- Daily report generation exists through `buildDailyReview`, but it is rule-template based.
- Weekly report is mostly a fixed template.
- Reminder times are wrong because Cloudflare Cron Triggers execute in UTC, while the desired schedule is Beijing time.

Reference: Cloudflare Cron Triggers execute in UTC: <https://developers.cloudflare.com/workers/configuration/cron-triggers/>

## Goals

1. Improve the dashboard so it feels like a useful personal body-management cockpit rather than a plain data table.
2. Allow the user to provide recent body data conversationally through Telegram.
3. Ensure recent reports are automatically generated; implement the missing parts where current behavior is only a placeholder.
4. Fix Telegram reminder times and improve reminder content with AI-polished Chinese messages.

## Non-Goals

- Do not require complete body circumference data.
- Do not make missing profile data block calorie, nutrition, or report generation.
- Do not build a full multi-user product UI.
- Do not replace the current Telegram webhook/R2/D1 architecture.
- Do not add a new external AI provider; continue using the existing Workers AI binding.

## Dashboard Design

Use the confirmed A+B mixed direction:

- Top section: coach-style daily status.
- Lower sections: data-style trends and history.

The first viewport should show:

- Today's calories, protein, exercise summary, and record completion status.
- Latest basic profile/body data: age, height, latest weight when present.
- AI next-step suggestion based on today's current records.
- Latest report summary when available.

Below the first viewport:

- Basic body data trend, especially weight.
- Recent meals and exercises.
- Recent daily/weekly reports.
- Photo timeline.

Empty or missing optional data should not create noisy empty panels. For example, waist/body-fat cards only appear when data exists.

## Telegram Body Data Recording

Telegram should support natural-language basic profile and body data input, for example:

- `我 28 岁，身高 175，今天体重 72.4kg`
- `年龄 28，身高 175cm`
- `今天体重 72.1`

Data handling:

- Age and height are profile-level fields.
- Weight is time-series measurement data.
- Existing waist/body-fat support can remain optional.
- Missing age, height, body fat, or circumference data must not block AI estimates or reports.
- Existing profile data should be passed into AI prompt context where useful so estimates and reports can be more personalized.

Recommended storage:

- Store age and height in the existing `profile` table as JSON.
- Continue storing weight and optional body measurements in `measurements`.
- Keep backward compatibility with existing measurement rows.

## Report Generation

Daily reports:

- Generate a report for yesterday every day at Beijing time 09:30.
- Save it to the `reports` table as a `daily` report.
- Send it as a Telegram message.
- The report should summarize yesterday's meals, protein, calories, exercise, and visible gaps.
- Prefer AI-polished wording, with a deterministic fallback if Workers AI fails.

Weekly reports:

- Keep weekly report generation.
- Replace fixed-template content with a data-based weekly summary.
- Summarize meal consistency, protein, estimated calories, exercise, and weight trend when present.
- Use AI-polished wording with fallback.

Report idempotency:

- Avoid duplicate reports for the same user, report type, and period when the same scheduled event retries or is manually triggered.
- Prefer upsert-style save behavior for reports.

## Reminder Schedule

All user-facing reminder times are Beijing time:

- 09:30: send yesterday's daily review.
- 09:30: send today's breakfast reminder as a separate Telegram message.
- 12:30: send lunch reminder.
- 18:00: send dinner reminder.

Because Cloudflare Cron Triggers execute in UTC, Wrangler cron values must use UTC equivalents:

- Beijing 09:30 -> UTC 01:30.
- Beijing 12:30 -> UTC 04:30.
- Beijing 18:00 -> UTC 10:00.
- Weekly Beijing Sunday 21:00 -> UTC Sunday 13:00.

Recommended `wrangler.jsonc` cron expressions:

- `30 1 * * *`
- `30 4 * * *`
- `0 10 * * *`
- `0 13 * * SUN`

The scheduled handler should branch by local Beijing time derived from `event.scheduledTime`, not by UTC cron text alone, except where needed to distinguish weekly behavior.

## AI-Polished Reminders

Reminder generation should combine deterministic context with AI phrasing:

- Reminder type: breakfast, lunch, dinner.
- Local date and time.
- Whether today already has relevant records.
- Latest daily review signal when useful.
- Existing profile basics when present.

The AI output should be a short Chinese Telegram message. It should be practical and calm, not medical advice.

Fallback reminder text must be available when Workers AI fails or returns unusable content.

## Components and Data Flow

Suggested module changes:

- `src/lib/records.ts`
  - Extend body/profile parsing for age and height.
  - Keep existing weight/body-fat/waist parsing.
  - Add date helpers for yesterday and week start if needed.

- `src/lib/repository.ts`
  - Add profile read/write helpers.
  - Add report upsert or duplicate-safe save behavior.
  - Add richer daily/weekly data aggregation helpers.
  - Extend dashboard data with profile and daily summary values.

- `src/lib/ai.ts`
  - Add report and reminder prompt builders.
  - Add parsing/sanitizing for short AI text outputs.
  - Include profile context in estimate prompts where useful.

- `src/lib/dashboard.ts`
  - Redesign HTML/CSS for A+B mixed layout.
  - Keep server-rendered dashboard.
  - Avoid decorative over-complexity; prioritize scannability.

- `src/index.ts`
  - Save profile/body data extracted from Telegram text.
  - Update scheduled handling for Beijing-time reminders.
  - Send two separate 09:30 messages: yesterday review, then breakfast reminder.

## Error Handling

- Telegram webhook should still acknowledge quickly by using `ctx.waitUntil`.
- If AI estimate/report/reminder generation fails, store/send deterministic fallback text.
- If photo analysis fails but caption indicates a meal, keep current low-confidence meal fallback pattern.
- Missing profile fields are normal, not errors.

## Testing Strategy

Add focused tests before implementation:

- Parser tests for age, height, weight, and optional circumference/body-fat text.
- Repository tests for profile upsert/read and report duplicate prevention.
- Report aggregation tests for daily and weekly summaries.
- Reminder schedule tests for Beijing local time derived from UTC scheduled time.
- AI prompt/output tests for report and reminder generation fallbacks.
- Dashboard render tests for key labels and empty-state behavior.

Run:

- `npm test`
- `npm run typecheck`

## Acceptance Criteria

- Dashboard first screen shows a polished A+B mixed body-management overview.
- Telegram accepts natural basic data messages and records age, height, and weight correctly.
- Missing optional measurements do not prevent AI calculations.
- Daily report is generated for yesterday at Beijing 09:30 and sent to Telegram.
- Breakfast reminder is sent as a separate 09:30 message.
- Lunch and dinner reminders send at Beijing 12:30 and 18:00.
- Reminder content is AI-polished when possible and has safe fallbacks.
- Weekly report is data-based rather than fixed template only.
- Existing tests pass, and new tests cover the new behavior.

## Open Implementation Notes

- Current workspace is not a git repository, so this design document cannot be committed here.
- `.superpowers/brainstorm/` contains visual companion artifacts and should be ignored if this directory is later initialized as a git repository.
