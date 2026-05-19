import type { DashboardData, Env } from "../types";
import { getDashboardData } from "./repository";

export async function renderDashboard(env: Env): Promise<string> {
  return renderDashboardPage(await getDashboardData(env));
}

export function renderDashboardPage(data: DashboardData): string {
  const latestMeasurements = data.measurements.slice(0, 8);
  const latestWeight = latestMeasurements.find((row) => row.weight_kg);
  const meals = data.meals.slice(0, 30);
  const exercises = data.exercises.slice(0, 12);
  const photos = data.estimates.filter((row) => typeof row.photo_r2_key === "string").slice(0, 12);
  const reports = data.reports.slice(0, 6);
  const suggestion = dashboardSuggestion(data);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>身材管理 Dashboard</title>
  <style>
    :root{color-scheme:light;--ink:#142033;--muted:#667085;--line:#dbe3ef;--paper:#fff;--bg:#f3f6fa;--brand:#27566b;--brand2:#3f7c6b;--accent:#d98245;--soft:#f8fafc;--good:#2f7d57;--warn:#c56a2d}
    *{box-sizing:border-box}
    body{margin:0;font-family:Inter,Arial,"Microsoft YaHei",sans-serif;background:var(--bg);color:var(--ink);letter-spacing:0}
    .wrap{max-width:1220px;margin:0 auto}
    .app-header{background:linear-gradient(135deg,#101928 0%,#1d4f63 62%,#2f6e5e 100%);color:white;border-bottom:1px solid rgba(255,255,255,.14);padding:20px 24px}
    .header-inner{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center}
    .brand-block h1{margin:0;font-size:26px;line-height:1.2}.brand-block p{margin:8px 0 0;color:rgba(255,255,255,.82);font-size:14px}.brand-mark{width:34px;height:2px;background:var(--accent);border-radius:999px;margin-top:10px}
    .header-actions{display:flex;align-items:center;gap:16px;justify-content:flex-end;flex-wrap:wrap}
    h2{margin:0 0 14px;font-size:18px} h3{margin:0 0 8px;font-size:15px}.muted{color:var(--muted)}
    .logout-link button{border:0;background:transparent;color:rgba(255,255,255,.84);padding:0;font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:4px}
    .logout-link button:hover{color:white}
    main{max-width:1220px;margin:0 auto;padding:24px;display:grid;gap:18px}
    section{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:18px;box-shadow:0 12px 30px rgba(15,23,42,.06)}
    .status-panel{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:18px;align-items:stretch}
    .status-main{min-width:0}.section-kicker{margin:-6px 0 14px;color:var(--muted);font-size:13px}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .metric{border:1px solid var(--line);border-radius:8px;padding:13px;background:#fbfcfe;min-height:82px}
    .metric span{display:block;color:var(--muted);font-size:12px;margin-bottom:7px}.metric strong{display:block;font-size:23px;line-height:1.1;word-break:break-word}.metric small{display:block;color:var(--muted);font-size:12px;margin-top:8px}
    .mini-bar{height:4px;background:#e9eef5;border-radius:999px;overflow:hidden;margin-top:10px}.mini-bar i{display:block;height:100%;width:var(--p);background:linear-gradient(90deg,var(--brand2),var(--accent));border-radius:inherit}
    .pillrow{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.pill{border:1px solid rgba(255,255,255,.32);border-radius:999px;padding:7px 10px;background:rgba(255,255,255,.1);font-size:13px;color:white}
    .rhythm{height:100%;display:flex;flex-direction:column;gap:13px;background:#f8fbf8;border:1px solid #d9eadf;border-radius:8px;padding:16px}
    .rhythm-row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #e4efe7;padding-bottom:10px}.rhythm-row:last-of-type{border-bottom:0}.rhythm-row span{color:#52645c;font-size:12px}.rhythm-row strong{font-variant-numeric:tabular-nums}
    .meal-segments{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.meal-segments i{height:7px;border-radius:999px;background:#dfe8e2}.meal-segments i.done{background:var(--good)}
    .suggestion-note{margin:auto 0 0;color:#254c3f;line-height:1.65;border-top:1px solid #d9eadf;padding-top:12px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
    .wide{grid-column:1/-1}
    table{width:100%;border-collapse:collapse;font-size:14px} th,td{padding:10px;border-bottom:1px solid #edf0f3;text-align:left;vertical-align:top}
    th{font-size:12px;color:var(--muted);font-weight:700}
    tbody tr:nth-child(even){background:#fafbfc} tbody tr:hover{background:#f0f4f8}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.photo-thumb{width:100%;aspect-ratio:4/3;object-fit:contain;background:#f5f7f9;border-radius:8px;border:1px solid var(--line)}
    .report{background:var(--soft);border:1px solid #edf1f6;border-radius:8px;padding:12px;margin:8px 0}.report-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}.date-badge{background:#e7eef5;color:#24465a;border-radius:6px;padding:4px 7px;font-size:12px;font-weight:700}.report-type{color:var(--muted);font-size:12px}.report-body{white-space:pre-wrap;line-height:1.55;max-height:118px;overflow:auto}
    .empty-state{border:1px dashed #cfd9e6;border-radius:8px;padding:14px;background:#fbfcfe;color:var(--muted);line-height:1.55}
    @media (max-width:900px){.header-inner,.status-panel,.grid{grid-template-columns:1fr}.header-actions{justify-content:flex-start}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pillrow{justify-content:flex-start}}
    @media (max-width:560px){.app-header{padding:18px 14px}main{padding:16px 14px 28px}.metrics{grid-template-columns:1fr}table{font-size:13px}th,td{padding:8px}}
  </style>
</head>
<body>
  <header class="app-header">
    <div class="wrap header-inner">
      <div class="brand-block">
        <h1>身材管理 Dashboard</h1>
        <div class="brand-mark"></div>
        <p class="muted">AI 估算饮食、运动和身体趋势；缺失数据不会阻塞计算。</p>
      </div>
      <div class="header-actions">
        <div class="pillrow">${profilePills(data.profile, latestWeight)}</div>
        <form class="logout-link" method="post" action="/api/dashboard/logout"><button type="submit">退出登录</button></form>
      </div>
    </div>
  </header>
  <main>
    <section class="status-panel">
      <div class="status-main">
        <h2>今日状态</h2>
        <p class="section-kicker">记录优先，目标值稍后可配置；当前进度仅作节奏参考。</p>
        <div class="metrics">
          ${metric("热量", kcal(data.today.caloriesKcal), "今日累计", progress(data.today.caloriesKcal, 1800))}
          ${metric("蛋白质", gram(data.today.proteinG), "今日累计", progress(data.today.proteinG, 100))}
          ${metric("运动", kcal(data.today.exerciseCaloriesKcal), "估算消耗", progress(data.today.exerciseCaloriesKcal, 300))}
          ${metric("餐次", `${data.today.mealCount} 餐`, `${completedMealCount(data.today)}/3 完成`, progress(completedMealCount(data.today), 3))}
        </div>
      </div>
      ${rhythmPanel(data, suggestion)}
    </section>
    <div class="grid">
      <section>
        <h2>身体数据趋势</h2>
        ${table(["时间", "体重", "体脂", "腰围"], latestMeasurements.map((row) => [row.measured_at, kg(row.weight_kg), pct(row.body_fat_percent), cm(row.waist_cm)]), { numeric: [1, 2, 3], empty: emptyState("body") })}
      </section>
      <section>
        <h2>最近报告</h2>
        ${reports.map(renderReport).join("") || emptyState("reports")}
      </section>
      <section class="wide">
        <h2>餐食记录</h2>
        ${table(["日期", "餐次", "热量", "蛋白质", "摘要"], meals.map((row) => [row.log_date, mealLabel(String(row.meal_type)), kcal(row.calories_kcal), gram(row.protein_g), row.summary]), { numeric: [2, 3], empty: emptyState("meals") })}
      </section>
      <section>
        <h2>运动记录</h2>
        ${table(["日期", "时长", "消耗", "摘要"], exercises.map((row) => [row.log_date, minute(row.minutes), kcal(row.calories_kcal), row.summary]), { numeric: [1, 2], empty: emptyState("exercises") })}
      </section>
      <section>
        <h2>照片时间线</h2>
        <div class="photos">${photos.map((row) => `<img class="photo-thumb" src="/api/photos/${encodeURIComponent(String(row.photo_r2_key))}" alt="${escapeHtml(String(row.created_at))}">`).join("") || emptyState("photos")}</div>
      </section>
    </div>
  </main>
</body>
</html>`;
}

export function renderLogin(error = false): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录</title>
  <style>body{font-family:Arial,"Microsoft YaHei",sans-serif;background:#f3f6fa;display:grid;place-items:center;min-height:100vh;margin:0}.box{background:white;border:1px solid #dbe3ef;border-radius:8px;padding:24px;width:min(360px,calc(100vw - 48px));box-shadow:0 14px 32px rgba(15,23,42,.08)}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:6px;border:1px solid #cfd6dd}button{background:#27566b;color:white;border:0;font-weight:700}.error{color:#b42318}</style></head>
  <body><form class="box" method="post" action="/api/dashboard/login"><h1>身材管理 Dashboard</h1>${error ? '<p class="error">密码错误</p>' : ""}<input name="password" type="password" placeholder="管理密码" autofocus><button>登录</button></form></body></html>`;
}

function table(headers: string[], rows: unknown[][], options: { numeric?: number[]; empty?: string } = {}): string {
  if (rows.length === 0) return options.empty ?? emptyState("default");
  const numeric = new Set(options.numeric ?? []);
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell, index) => `<td${numeric.has(index) ? ' class="num"' : ""}>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function emptyState(type: "body" | "meals" | "exercises" | "photos" | "reports" | "default"): string {
  const text =
    type === "body"
      ? "还未记录体重数据，发「体重70kg」到 bot 即可"
      : type === "meals"
        ? "还没有餐食记录，发照片或文字到 bot 即可"
        : type === "exercises"
          ? "暂无运动记录"
          : type === "photos"
            ? "暂无照片记录"
            : type === "reports"
              ? "暂无复盘报告"
              : "暂无数据";
  return `<p class="empty-state">${escapeHtml(text)}</p>`;
}

function metric(label: string, value: string, hint: string, percent: number): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "0")}</strong><div class="mini-bar" style="--p:${percent}%"><i></i></div><small>${escapeHtml(hint)}</small></div>`;
}

function rhythmPanel(data: DashboardData, suggestion: string): string {
  const completedMeals = completedMealCount(data.today);
  return `<div class="rhythm">
    <h2>今日节奏</h2>
    <div class="meal-segments">
      <i class="${data.today.hasBreakfast ? "done" : ""}"></i>
      <i class="${data.today.hasLunch ? "done" : ""}"></i>
      <i class="${data.today.hasDinner ? "done" : ""}"></i>
    </div>
    ${rhythmRow("餐次完成", `${completedMeals}/3 完成`)}
    ${rhythmRow("记录次数", `${data.today.mealCount} 餐`)}
    ${rhythmRow("热量累计", kcal(data.today.caloriesKcal) || "0")}
    ${rhythmRow("蛋白质", gram(data.today.proteinG) || "0")}
    ${rhythmRow("运动消耗", kcal(data.today.exerciseCaloriesKcal) || "0")}
    <p class="suggestion-note">${escapeHtml(suggestion)}</p>
  </div>`;
}

function rhythmRow(label: string, value: string): string {
  return `<div class="rhythm-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function completedMealCount(today: DashboardData["today"]): number {
  return [today.hasBreakfast, today.hasLunch, today.hasDinner].filter(Boolean).length;
}

function progress(value: unknown, reference: number): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || reference <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((numeric / reference) * 100)));
}

function renderReport(row: Record<string, unknown>): string {
  return `<div class="report">
    <div class="report-head">
      <span class="date-badge">${escapeHtml(String(row.period_start ?? ""))}</span>
      <span class="report-type">${escapeHtml(reportTypeLabel(String(row.report_type)))}</span>
      <span class="report-type">${escapeHtml(formatReportTime(row.created_at))}</span>
    </div>
    <div class="report-body">${escapeHtml(String(row.content ?? ""))}</div>
  </div>`;
}

function profilePills(profile: DashboardData["profile"], latestWeight: Record<string, unknown> | undefined): string {
  const values = [
    profile.age !== undefined ? `${profile.age} 岁` : "",
    profile.heightCm !== undefined ? `${profile.heightCm} cm` : "",
    profile.gender ? (profile.gender === "male" ? "男" : "女") : "",
    latestWeight?.weight_kg ? `${latestWeight.weight_kg} kg` : ""
  ].filter(Boolean);
  return values.length ? values.map((value) => `<span class="pill">${escapeHtml(value)}</span>`).join("") : '<span class="pill">基础资料待补充</span>';
}

function dashboardSuggestion(data: DashboardData): string {
  if (!data.today.hasBreakfast) return "先记录今天早餐。发照片或文字都可以，系统会自动估算热量和蛋白质。";
  if (!data.today.hasLunch) return "午餐还没记录，拍一下饭菜可以让今天的摄入趋势更完整。";
  if (!data.today.hasDinner) return "晚餐记录后，今晚或明早的复盘会更准确。";
  if (data.today.proteinG < 80) return "今天蛋白质看起来偏低，下一餐优先补一点瘦肉、蛋、奶或豆制品。";
  return "今天记录节奏不错，继续保持三餐和运动信息完整。";
}

function mealLabel(value: string): string {
  return ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐", unknown: "未知" } as Record<string, string>)[value] ?? value;
}

function kg(value: unknown): string {
  return value ? `${value} kg` : "";
}

function pct(value: unknown): string {
  return value ? `${value}%` : "";
}

function cm(value: unknown): string {
  return value ? `${value} cm` : "";
}

function kcal(value: unknown): string {
  return value ? `${Math.round(Number(value))} kcal` : "";
}

function gram(value: unknown): string {
  return value ? `${Math.round(Number(value))} g` : "";
}

function minute(value: unknown): string {
  return value ? `${Math.round(Number(value))} min` : "";
}

function reportTypeLabel(value: string): string {
  return value === "weekly" ? "周报" : "日报";
}

function formatReportTime(value: unknown): string {
  const text = String(value ?? "");
  return text ? text.slice(0, 16) : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
