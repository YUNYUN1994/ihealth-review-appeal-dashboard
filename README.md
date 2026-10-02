# iHealth 差评申诉周报

这是 iHealth Amazon 差评申诉周报生产版，部署在 GitHub + Vercel 后，不依赖本机 Chrome、飞书 Cookie 或 Amazon 登录。

## 页面入口

- 根路径：`/`
- 周报页面：`/review-appeal`
- 动态页面接口：`/api/review-dashboard`
- 手动刷新：`POST /api/review-refresh`
- 刷新状态：`GET /api/review-refresh/status`
- 定时刷新：`/api/cron/review-refresh`

根路径和 `/review-appeal` 均会打开差评申诉周报，不再指向 Amazon 经营数据驾驶舱。

## 生产数据流程

网页点击“刷新数据”后，Vercel Function 会通过飞书开放平台 API：

1. 获取企业自建应用 `tenant_access_token`；
2. 读取两份差评申诉源表；
3. 排除“产品-负责人”模板页；
4. 按评论链接去重；
5. 以源表申诉状态包含“已删除”作为删除成功判定；
6. 生成产品、申诉周、留评周、负责人四个维度的周报；
7. 将最新快照写入 Vercel Blob；
8. 网页加载最新快照并显示刷新状态。

## Vercel 环境变量

在 Vercel Production 环境配置：

```text
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_REVIEW_OLD_SPREADSHEET_TOKEN=L58cs18QnhC9ketyJUYcJhQNnZe
FEISHU_REVIEW_NEW_SPREADSHEET_TOKEN=Zoa9sSFYhhUYRutX1yOcoObTnFf
BLOB_READ_WRITE_TOKEN=
CRON_SECRET=
```

真实的 App Secret、Blob Token、Cron Secret、表格密码、Amazon 登录信息和浏览器会话不得提交到 GitHub。

## 自动刷新

`vercel.json` 配置 Vercel Cron 每天 UTC 14:00 运行，对应北京时间每天 22:00。每次手动或自动刷新都会重新抓取飞书数据。

## 本地检查

```powershell
npm install
npm run check
```

本项目使用 Node.js 22 或更高版本。