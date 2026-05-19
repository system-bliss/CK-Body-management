# CK Body Management

一个部署在 Cloudflare Workers 上的个人身材管理助手，用 Telegram Bot 记录每天的饮食、运动和身体数据，AI 自动帮你估算营养和热量，最后在 Dashboard 上直观地看到自己的变化趋势。

你只需要像和朋友聊天一样给 Bot 发消息——"早餐吃了两个鸡蛋一杯美式"、"晚上快走 30 分钟"、"今早体重 72 kg"——剩下的数据整理和图表展示都交给它。

> 所有 AI 估算结果仅供个人参考，不构成医疗、营养或训练建议。

## 它能做什么

- **聊天式记录**：用自然语言告诉 Bot 你吃了什么、做了什么运动、体重体脂多少，支持文字和照片
- **AI 智能估算**：自动分析你的餐食照片和文字描述，估算热量、蛋白质、碳水、脂肪等营养素（直接使用 Cloudflare Workers AI，不需要额外申请 API Key）
- **可视化看板**：用手机或电脑打开 Dashboard，就能看到当天的热量摄入、运动消耗、身体数据趋势曲线、最近的复盘报告和照片时间线
- **定时提醒**：每天到点通过 Telegram 提醒你记录餐食和运动，周末自动生成周报
- **数据自由**：所有数据都存在你自己的 Cloudflare 账号下（D1 数据库 + R2 存储），完全由你掌控

## 使用方式示例

直接给 Bot 发这些消息就行：

```
基础资料：年龄 26 岁，身高 176 cm，性别男。今早空腹体重 72 kg，体脂 18%，腰围 82 cm。
```

```
早餐：两个鸡蛋，一个蛋黄没吃，一大杯冰美式。
```

```
午餐，米饭半碗，饮料无糖。
```
（附带餐食照片也可以）

```
晚上快走 30 分钟。
```

系统会自动识别：基础资料（年龄/身高/性别）长期保存，体重/体脂/腰围按时间线记录，每餐的营养数据由 AI 估算后入库。

## 技术栈

| 组件 | 用途 |
|------|------|
| Cloudflare Workers | 托管整个应用，处理 HTTP 请求和定时任务 |
| Cloudflare Workers AI | 分析食物照片和文字，估算营养数据 |
| Cloudflare D1 | 存储所有结构化数据（日志、餐食、运动、身体测量、报告） |
| Cloudflare R2 | 保存 Telegram 发送的照片 |
| Cloudflare Durable Objects | 管理会话状态和教练逻辑 |
| Telegram Bot API | 接收和发送消息 |
| TypeScript + Vitest | 类型安全的代码和单元测试 |

## 目录结构

```
src/
  index.ts              Worker 入口、路由和 Telegram webhook
  agent.ts              BodyCoachAgent 状态管理
  lib/
    ai.ts               AI 估算、报告生成和教练反馈提示词
    dashboard.ts        Dashboard HTML 页面渲染
    dashboard-auth.ts   Dashboard 登录与 Session 管理
    env.ts              环境变量校验
    records.ts          基础资料、身体数据和时间解析
    reminders.ts        定时提醒策略
    repository.ts       D1 数据库操作和查询
    telegram.ts         Telegram 消息收发和图片下载
migrations/             D1 数据库迁移文件
tests/                  单元测试
wrangler.jsonc          Cloudflare Worker 配置文件
```

## 快速开始

### 1. 准备环境

需要 Node.js 和一个 Cloudflare 账号（免费额度足够使用）。

```bash
npm install
cp .dev.vars.example .dev.vars
```

### 2. 创建 Telegram Bot

在 Telegram 找 [@BotFather](https://t.me/BotFather)，发送 `/newbot`，按提示创建 Bot。你会得到一个类似 `123456:ABC-DEF1234ghijkl` 的 Token。

### 3. 配置本地环境

编辑 `.dev.vars`，填入你的信息：

```text
TIMEZONE=Asia/Shanghai
OWNER_USER_ID=self
WORKER_PUBLIC_BASE_URL=http://localhost:8787
TELEGRAM_BOT_TOKEN=刚才从 BotFather 拿到的 Token
OWNER_TELEGRAM_CHAT_ID=先留空，部署后第一次给 Bot 发消息就能看到
DASHBOARD_PASSWORD=自己设一个密码
SESSION_SECRET=随便打一串足够长的随机字符
```

### 4. 本地启动

```bash
npx wrangler d1 migrations apply ck-body-management-db --local
npm run dev
```

然后打开浏览器访问 `http://localhost:8787/dashboard`，用你设置的密码登录。

### 5. 部署到 Cloudflare

先创建线上资源：

```bash
npx wrangler login                                # 登录 Cloudflare
npx wrangler d1 create ck-body-management-db      # 创建 D1 数据库
npx wrangler r2 bucket create ck-body-management-photos  # 创建 R2 存储桶
npx wrangler d1 migrations apply ck-body-management-db --remote  # 初始化数据库表
```

创建 D1 后会输出一个 `database_id`，把它填到 `wrangler.jsonc` 对应的两处 `00000000-0000-0000-0000-000000000000` 位置。

设置生产环境的私密变量（不会提交到 Git）：

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put OWNER_TELEGRAM_CHAT_ID
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put SESSION_SECRET
```

部署：

```bash
npm run deploy
```

### 6. 连接 Telegram

部署成功后会得到一个 Worker URL（比如 `https://ck-body-management.你的用户名.workers.dev`）。设置 Telegram Webhook：

```bash
curl "https://api.telegram.org/bot<你的Token>/setWebhook?url=https://你的域名/api/telegram/webhook"
```

设置完成后，给 Bot 发一条消息试试。如果还没填 `OWNER_TELEGRAM_CHAT_ID`，可以通过 `npx wrangler tail` 查看日志找到你的 chat_id，再填入 secret。

---

搞定！之后只要正常给 Bot 发消息记录饮食和运动就行，数据会实时同步到 Dashboard。

## 路由说明

| 路由 | 说明 |
|------|------|
| `POST /api/telegram/webhook` | Telegram 消息接收 |
| `GET /dashboard` | 个人仪表盘（需密码登录） |
| `POST /api/dashboard/login` | Dashboard 登录 |
| `POST /api/dashboard/logout` | Dashboard 登出 |
| `GET /api/photos/:key` | 查看 R2 中的照片（需登录） |
| `GET /` | 重定向到 Dashboard |

## 定时任务

| Cron（UTC）| 北京时间 | 用途 |
|------------|----------|------|
| `30 1 * * *` | 09:30 | 早餐提醒 |
| `30 4 * * *` | 12:30 | 午餐提醒 |
| `0 10 * * *` | 18:00 | 晚餐提醒 |
| `0 13 * * SUN` | 周日 21:00 | 周报生成 |

## 隐私与安全

这个项目设计时把隐私放在第一位——所有数据都在你自己的 Cloudflare 账号下，没有第三方服务器介入。但发布代码时请注意：

**绝对不要提交到 Git 的内容：**
- `.dev.vars` / `.env` 文件
- Telegram Bot Token
- Dashboard 密码和 `SESSION_SECRET`
- Cloudflare API Token 等各种凭证

**当前仓库已配置 `.gitignore` 忽略这些文件。** 提交前建议跑一遍 `git status` 确认没有意外暂存敏感文件。

## 清理测试数据

如果录入了测试数据想清理，可以用数据库命令按日期或按用户删除记录。**正式使用时建议用 `--remote` 操作线上数据库，本地测试用 `--local`。**

<details>
<summary>展开查看数据清理命令</summary>

按日期查看记录：

```bash
npx wrangler d1 execute ck-body-management-db --remote \
  --command "SELECT id, user_id, log_date, created_at FROM daily_logs WHERE log_date >= '2026-05-19' ORDER BY created_at DESC;"
```

按日期删除所有关联记录：

```bash
npx wrangler d1 execute ck-body-management-db --remote --command "
DELETE FROM meal_entries WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '2026-05-19');
DELETE FROM exercise_entries WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '2026-05-19');
DELETE FROM measurements WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '2026-05-19');
DELETE FROM ai_estimates WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE log_date >= '2026-05-19');
DELETE FROM daily_logs WHERE log_date >= '2026-05-19';
DELETE FROM reports WHERE period_start >= '2026-05-19';
"
```

删除 R2 中的照片：

```bash
npx wrangler r2 object delete "ck-body-management-photos/<photo_r2_key>" --remote
```

按用户清理全部数据：

```bash
npx wrangler d1 execute ck-body-management-db --remote --command "
DELETE FROM meal_entries WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE user_id = '用户ID');
DELETE FROM exercise_entries WHERE daily_log_id IN (SELECT id FROM daily_logs WHERE user_id = '用户ID');
DELETE FROM measurements WHERE user_id = '用户ID' OR daily_log_id IN (SELECT id FROM daily_logs WHERE user_id = '用户ID');
DELETE FROM ai_estimates WHERE user_id = '用户ID' OR daily_log_id IN (SELECT id FROM daily_logs WHERE user_id = '用户ID');
DELETE FROM reports WHERE user_id = '用户ID';
DELETE FROM daily_logs WHERE user_id = '用户ID';
DELETE FROM processed_telegram_updates WHERE user_id = '用户ID';
"
```

</details>

## 开发

```bash
npm test              # 运行单元测试
npm run typecheck     # TypeScript 类型检查
npx wrangler deploy --dry-run  # 部署前验证
npm run cf-typegen    # 更新 Cloudflare 类型定义
```

## License

目前未声明许可证。公开发布前建议根据你的使用意图选择 MIT、Apache-2.0 或保留版权。
