# 生产版飞书 API 同步方案

本仓库新增了一套生产同步实现，不替换本地 Chrome 抓取版本：

- 本地版本仍使用 `amazon-dashboard.html`、`server.mjs`、`refresh-data.mjs`。
- 生产版本使用 `production-dashboard.html` 和 `api/` 下的 Vercel Functions。
- 生产版本通过飞书开放 API 读取数据，不依赖本机 Chrome、登录 Cookie 或 `127.0.0.1`。
- 业务计算继续复用现有 `build-data.mjs`，明确不读取 `引用表-不读取` 和任何 WOOT 表。

## 需要用户提供/配置的内容

请在飞书开放平台创建企业自建应用，并将应用添加到目标电子表格，授予电子表格只读权限。需要在 Vercel Production 环境配置：

```text
FEISHU_APP_ID=飞书应用 App ID
FEISHU_APP_SECRET=飞书应用 App Secret
FEISHU_SPREADSHEET_TOKEN=R4Bks0mjWhnjDbtYmwdcffFsnZd
BLOB_READ_WRITE_TOKEN=Vercel Blob 的读写 Token
CRON_SECRET=随机生成的定时任务密钥
```

不要把 `FEISHU_APP_SECRET`、`BLOB_READ_WRITE_TOKEN` 或 `CRON_SECRET` 写入 HTML、JavaScript 或 GitHub。

## Vercel 设置

1. 在 Vercel 项目的 `Settings → Storage` 创建 Blob Store，并把 `BLOB_READ_WRITE_TOKEN` 连接到 Production。
2. 在 `Settings → Environment Variables` 配置上面的 Production 变量。
3. 重新部署一次。
4. 生产根路径现在指向 `production-dashboard.html`。
5. 页面点击“立即更新数据”会调用 `POST /api/refresh`；数据成功后写入 Blob，页面从 `GET /api/data` 读取。

`vercel.json` 已配置北京时间 12:00 和 18:00 对应的 UTC Cron：

- UTC 04:00 = Asia/Shanghai 12:00
- UTC 10:00 = Asia/Shanghai 18:00

Vercel Hobby 计划对 Cron 的执行频率和精确时间有限制；如果需要每天稳定执行两次，使用支持多次 Cron 的计划。

## 首次上线验证

配置环境变量并重新部署后，依次检查：

```text
GET  /api/data
GET  /api/refresh/status
POST /api/refresh
```

首次部署前 `/api/data` 返回“生产数据尚未初始化”是正常的。先点击网页的“立即更新数据”，同步成功后再检查 `/api/data`。

如果飞书 API 返回权限错误，需要在飞书开放平台给应用增加电子表格读取权限，并在目标表格的协作者设置中加入该应用。

## 当前生产读取白名单

生产接口只读取以下工作表：

- 所有产品对应表
- Coupon对应表
- 硬件_2026年目标数据
- PM_年月数据
- PM_周度数据
- 领星_月度订单利润
- 领星_周度订单利润
- 库存表

不会读取：

- 引用表-不读取
- WOOT登记表
- 任何未列入白名单的工作表
