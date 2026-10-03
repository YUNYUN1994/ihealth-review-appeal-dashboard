# iHealth 差评申诉周报（腾讯云生产版）

这是 iHealth Amazon 差评申诉周报的生产代码，目标平台为腾讯云 Serverless Cloud Function（SCF）+ API 网关 + COS。仓库不再依赖 Vercel、Vercel Blob、本机 Chrome、飞书 Cookie 或 Amazon 登录。

## 生产路由

部署后由 API 网关把请求转发给 `tencent-scf.js`：

- `/`、`/review-appeal`、`/review-appeal.html`：周报网页
- `GET /api/review-refresh/status`：刷新状态
- `POST /api/review-refresh`：手动重新抓取飞书并生成网页数据
- `GET /api/cron/review-refresh`：受保护的 HTTP 定时入口

每次手动刷新或腾讯云定时刷新，都会重新调用飞书开放平台 API，读取两份源表并生成最新快照。源表申诉状态包含“已删除”时计入删除成功。

## 腾讯云架构

- **SCF**：运行 Node.js 20 的统一函数入口 `tencent-scf.main`。
- **API 网关**：提供网页和刷新接口。
- **COS**：保存 `review-appeal/data.json` 与 `review-appeal/refresh-status.json`。
- **定时触发器**：每天北京时间 22:00 执行一次刷新，cron 为 `0 0 22 * * * *`。
- **CAM 运行角色**：推荐给 SCF 绑定仅允许访问目标 COS Bucket 的角色，不在网页或 GitHub 中保存密钥。

## 本地检查

需要 Node.js 20+：

```powershell
npm install
npm run check
```

本地只做语法检查；生产运行由腾讯云 SCF 提供 COS 和飞书 API 环境变量。

## 腾讯云部署

推荐使用 Serverless Cloud Framework（CLI 命令通常为 `serverless` 或 `sls`）：

```powershell
npm install -g serverless
serverless login
.\deploy-tencent.ps1
```

部署参数读取当前机器环境变量，配置模板见 `serverless.yml` 和 `.env.example`。不要把 `.env.tencent`、真实 App Secret、COS 密钥或部署密钥提交到 GitHub。

如果部署后首次没有快照，打开 API 网关地址并点击一次“刷新数据”。部署完成后检查：

```text
GET  /api/review-refresh/status
GET  /
```

## 必填生产输入

部署前需要在本机安全环境变量或 `.env.tencent` 中配置：

```text
TENCENT_REGION
TENCENT_COS_BUCKET
TENCENT_FUNCTION_NAME
TENCENT_SCF_ROLE
FEISHU_APP_ID
FEISHU_APP_SECRET
CRON_SECRET
```

可选或有默认值：

```text
FEISHU_REVIEW_OLD_SPREADSHEET_TOKEN=L58cs18QnhC9ketyJUYcJhQNnZe
FEISHU_REVIEW_NEW_SPREADSHEET_TOKEN=Zoa9sSFYhhUYRutX1yOcoObTnFf
TENCENT_COS_REGION（默认跟随 TENCENT_REGION）
CORS_ORIGIN
```

`FEISHU_APP_SECRET`、`CRON_SECRET`、`TENCENT_SECRET_KEY` 和腾讯云 CLI 密钥不要发在聊天中；配置完成后只需告诉 Codex“已配置”。