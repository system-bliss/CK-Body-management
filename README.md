# CK Body Management

CK Body Management 是一个部署在 Cloudflare Workers 上的个人身材管理助手。它通过 Telegram Bot 收集文字、照片和定时事件，用 Workers AI 做餐食、运动和身体数据估算，并把结构化记录保存到 D1、把照片归档到 R2，最后在密码保护的 dashboard 中展示每日状态、身体趋势、餐食记录、运动记录、照片时间线和复盘报告。

> AI 估算只用于个人记录和趋势参考，不构成医疗、营养或训练建议。

## 项目亮点

- **Telegram 即记录**：支持文字、图片和图片 caption。早餐、午餐、晚餐、运动、体重等自然语言都可以直接发给 Bot。
- **Workers AI 估算**：文本和图片都通过 Cloudflare Workers AI 绑定运行，不需要额外的第三方 LLM API Key。
- **结构化数据链路**：D1 保存 `daily_logs`、`ai_estimates`、`meal_entries`、`exercise_entries`、`measurements`、`reports` 等表，方便后续统计和复盘。
- **R2 照片归档**：Telegram 图片会保存到 R2，dashboard 登录后可查看最近照片时间线。
- **个人 dashboard**：`/dashboard` 使用密码登录，展示今日热量、蛋白质、运动、餐次完成度、身体数据趋势、最近报告和照片。
- **定时提醒与复盘**：Cron Triggers 支持早餐、午餐、晚餐提醒，以及周报/复盘类任务。
- **重复消息防护**：`processed_telegram_updates` 记录 Telegram update id，避免 webhook 重试导致重复入库。
- **发布前安全友好**：真实密钥放在 `.dev.vars` 或 Cloudflare Secrets 中，仓库只保留 `.dev.vars.example` 占位模板。

## 技术栈

- Cloudflare Workers
- Cloudflare Workers AI
- Cloudflare D1
- Cloudflare R2
- Cloudflare Agents SDK / Durable Objects
- Telegram Bot Webhook
- TypeScript + Vitest

## 目录结构

```text
src/
  index.ts              Worker 入口、路由、Telegram webhook、定时任务
  agent.ts              BodyCoachAgent 状态方法
  lib/
    ai.ts               文本/图片估算、报告、提醒和教练反馈 prompt
    dashboard.ts        dashboard HTML 渲染
    dashboard-auth.ts   dashboard session cookie 与密码校验
    env.ts              必填环境变量校验
    records.ts          基础资料、身体数据、餐次和时间解析
    reminders.ts        定时提醒策略
    repository.ts       D1 读写和聚合查询
    telegram.ts         Telegram webhook 解析、发消息、下载图片
migrations/             D1 schema 和后续迁移
tests/                  单元测试
wrangler.jsonc          Cloudflare Worker 配置模板
```

## 发布前隐私检查

不要提交这些内容：

- `.dev.vars`、`.env`、`.env.*`
- Telegram Bot Token
- dashboard 密码
- `SESSION_SECRET`
- Cloudflare API Token
- GitHub Personal Access Token
- 私钥、证书、数据库导出和真实用户数据

当前仓库已经忽略 `.dev.vars`、`.env`、`.wrangler/`、`.wrangler-dev-logs/`、`node_modules/`、`dist/`、`coverage/` 和 `.superpowers/`。提交前建议执行：

```powershell
git status --short
git grep -n -I -E "bot[0-9]+:[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{30,}|github_pat_|AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH |EC |)PRIVATE KEY|sk-[A-Za-z0-9]{20,}"
```

`wrangler.jsonc` 中的 `database_id` 和 `WORKER_PUBLIC_BASE_URL` 使用占位值。部署到你自己的 Cloudflare 账号前，需要替换成真实资源信息。

## 本地开发

安装依赖：

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```text
TIMEZONE=Asia/Shanghai
OWNER_USER_ID=self
WORKER_PUBLIC_BASE_URL=http://localhost:8787
WORKERS_AI_TEXT_MODEL=@cf/moonshotai/kimi-k2.6
WORKERS_AI_IMAGE_MODEL=@cf/meta/llama-3.2-11b-vision-instruct
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
OWNER_TELEGRAM_CHAT_ID=your-chat-id-after-first-message
DASHBOARD_PASSWORD=your-dashboard-password
SESSION_SECRET=replace-with-a-long-random-string
```

说明：

- `TELEGRAM_BOT_TOKEN`：从 Telegram BotFather 获取。
- `OWNER_TELEGRAM_CHAT_ID`：可以先留空；第一次收到私聊消息后，从 Cloudflare 日志或 D1 记录中获取 chat id，再填入用于主动提醒。
- `DASHBOARD_PASSWORD`：dashboard 登录密码。
- `SESSION_SECRET`：用于签名 dashboard session cookie，建议使用足够长的随机字符串。
- `OWNER_USER_ID`：默认 `self` 表示 dashboard 展示所有用户记录；如果只想展示某个 Telegram 用户，填对应 user id。
- `WORKER_PUBLIC_BASE_URL`：线上填 Worker 公开访问地址，本地可填 `http://localhost:8787`。

初始化本地 D1 并启动开发服务：

```powershell
npx wrangler d1 migrations apply ck-body-management-db --local
npm run dev
```

本地访问：

- Dashboard: `http://localhost:8787/dashboard`
- Cron 测试入口：`http://localhost:8787/__scheduled`

## Cloudflare 资源创建

登录 Wrangler：

```powershell
npx wrangler login
npx wrangler whoami
```

创建 D1：

```powershell
npx wrangler d1 create ck-body-management-db
```

把输出中的 `database_id` 填入 `wrangler.jsonc` 的两个 D1 binding：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "ck-body-management-db",
    "database_id": "<your-d1-database-id>",
    "migrations_dir": "./migrations"
  },
  {
    "binding": "ck_body_management_db",
    "database_name": "ck-body-management-db",
    "database_id": "<your-d1-database-id>"
  }
]
```

创建 R2 bucket：

```powershell
npx wrangler r2 bucket create ck-body-management-photos
```

如果你修改了 bucket 名称，也要同步修改 `wrangler.jsonc` 的两个 R2 binding。

应用线上 D1 迁移：

```powershell
npx wrangler d1 migrations apply ck-body-management-db --remote
```

## 生产环境 Secrets

以下变量不要写进 Git。使用 Cloudflare Secrets 保存：

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put OWNER_TELEGRAM_CHAT_ID
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put SESSION_SECRET
```

`TIMEZONE`、`OWNER_USER_ID`、`WORKER_PUBLIC_BASE_URL`、模型名等非敏感配置可以放在 `wrangler.jsonc` 的 `vars` 中。线上部署前，把 `WORKER_PUBLIC_BASE_URL` 改成你的 Worker 域名或自定义域名。

## 部署 Worker

先做本地验证：

```powershell
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

部署：

```powershell
npx wrangler deploy
```

部署后记下 Worker URL，例如：

```text
https://ck-body-management.<your-subdomain>.workers.dev
```

如果你使用自定义域名，也可以在 Cloudflare Dashboard 中给 Worker 绑定 route 或 custom domain，并同步更新 `WORKER_PUBLIC_BASE_URL`。

## 配置 Telegram Webhook

部署完成后，把 Telegram webhook 指向 Worker：

```powershell
$baseUrl = "https://your-worker-domain.example.com"
$token = "replace-with-telegram-bot-token"
Invoke-RestMethod "https://api.telegram.org/bot$token/setWebhook?url=$baseUrl/api/telegram/webhook"
```

检查 webhook：

```powershell
Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo"
```

给 Bot 发一条私聊消息，例如：

```text
基础资料：年龄 26 岁，身高 176 cm，性别男。今早空腹体重 72 kg。
```

如果 `OWNER_TELEGRAM_CHAT_ID` 还没填，可以从日志或 D1 中查到 chat id 后再设置 secret：

```powershell
npx wrangler tail
npx wrangler secret put OWNER_TELEGRAM_CHAT_ID
```

## 常用记录方式

基础资料和身体数据：

```text
基础资料：年龄 26 岁，身高 176 cm，性别男。今早空腹体重 72 kg，体脂 18%，腰围 82 cm。
```

餐食文字：

```text
早餐：两个鸡蛋，一个蛋黄没吃，一大杯冰美式。
```

餐食照片：

```text
午餐，米饭半碗，饮料无糖。
```

运动：

```text
晚上快走 30 分钟。
```

当前代码会长期保存 `年龄 / 身高 / 性别` 作为基础资料；`体重 / 体脂 / 腰围` 会作为时间序列保存到身体趋势中。

## 路由

- `POST /api/telegram/webhook`：Telegram Bot Webhook，支持文字、图片和图片 caption。
- `GET /dashboard`：密码保护的个人 dashboard。
- `POST /api/dashboard/login`：dashboard 登录。
- `POST /api/dashboard/logout`：dashboard 登出。
- `GET /api/photos/:key`：登录后读取 R2 照片。
- `GET /`：重定向到 `/dashboard`。

## Cron Triggers

`wrangler.jsonc` 默认配置：

```jsonc
"triggers": {
  "crons": [
    "30 1 * * *",
    "30 4 * * *",
    "0 10 * * *",
    "0 13 * * SUN"
  ]
}
```

Cloudflare Cron 使用 UTC。当前项目在代码里按 `TIMEZONE=Asia/Shanghai` 处理本地日期和提醒语义，因此调整 cron 时要同时考虑 UTC 时间和本地时间。

## 清理测试数据

生产环境请使用 `--remote`，本地开发环境把命令里的 `--remote` 改成 `--local`。删除前先预览，确认日期、用户和照片 key 后再执行。

按日期查看记录：

```powershell
$since = "2026-05-19"
npx wrangler d1 execute ck-body-management-db --remote --command "SELECT id, user_id, log_date, created_at FROM daily_logs WHERE log_date >= '$since' ORDER BY created_at DESC;"
npx wrangler d1 execute ck-body-management-db --remote --command "SELECT id, user_id, entry_type, meal_type, raw_text, photo_r2_key, created_at FROM ai_estimates WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '$since') ORDER BY created_at DESC;"
```

删除 R2 照片：

```powershell
npx wrangler r2 object delete "ck-body-management-photos/<photo_r2_key>" --remote
```

按日期删除 D1 记录：

```powershell
$since = "2026-05-19"
$sql = @"
DELETE FROM meal_entries WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '$since');
DELETE FROM exercise_entries WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '$since');
DELETE FROM measurements WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '$since');
DELETE FROM ai_estimates WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '$since');
DELETE FROM daily_logs WHERE log_date >= '$since';
DELETE FROM reports WHERE period_start >= '$since';
"@
npx wrangler d1 execute ck-body-management-db --remote --command $sql
```

如果你想清理某个用户的全部测试数据，先预览该用户记录：

```powershell
$userId = "123456789"
npx wrangler d1 execute ck-body-management-db --remote --command "SELECT id, user_id, log_date, created_at FROM daily_logs WHERE user_id = '$userId' ORDER BY created_at DESC;"
npx wrangler d1 execute ck-body-management-db --remote --command "SELECT id, photo_r2_key, created_at FROM ai_estimates WHERE user_id = '$userId' AND photo_r2_key IS NOT NULL ORDER BY created_at DESC;"
```

确认后按用户删除 D1 记录：

```powershell
$userId = "123456789"
$sql = @"
DELETE FROM meal_entries WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE user_id = '$userId');
DELETE FROM exercise_entries WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE user_id = '$userId');
DELETE FROM measurements WHERE user_id = '$userId' OR daily_log_id IN (SELECT id FROM daily_logs WHERE user_id = '$userId');
DELETE FROM ai_estimates WHERE user_id = '$userId' OR daily_log_id IN (SELECT id FROM daily_logs WHERE user_id = '$userId');
DELETE FROM reports WHERE user_id = '$userId';
DELETE FROM daily_logs WHERE user_id = '$userId';
DELETE FROM processed_telegram_updates WHERE user_id = '$userId';
"@
npx wrangler d1 execute ck-body-management-db --remote --command $sql
```

复查数量：

```powershell
npx wrangler d1 execute ck-body-management-db --remote --command "SELECT (SELECT COUNT(*) FROM daily_logs) AS daily_logs, (SELECT COUNT(*) FROM ai_estimates) AS ai_estimates, (SELECT COUNT(*) FROM meal_entries) AS meal_entries, (SELECT COUNT(*) FROM exercise_entries) AS exercise_entries, (SELECT COUNT(*) FROM measurements) AS measurements, (SELECT COUNT(*) FROM reports) AS reports, (SELECT COUNT(*) FROM processed_telegram_updates) AS processed_telegram_updates;"
```

## 测试与质量检查

```powershell
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

如果修改了 `wrangler.jsonc` 的 binding，建议重新生成类型：

```powershell
npm run cf-typegen
```

## GitHub 发布建议

首次发布到 GitHub：

```powershell
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/system-bliss/CK-Body-management.git
git push -u origin main
```

如果本地已有 Git 历史并且历史里包含不想公开的基础设施标识，建议发布一个干净的当前快照，而不是直接推送完整历史。

## License

当前仓库未声明许可证。公开发布前可以按你的使用意图补充 MIT、Apache-2.0 或私有版权声明。
