# 差评申诉周报：GitHub + Vercel + 飞书 API 部署

这套生产版周报不依赖本机 Chrome、Chrome profile、飞书登录 Cookie 或 Amazon 前台登录。用户点击“刷新数据”时，Vercel Function 会：

1. 使用飞书开放平台企业自建应用获取 `tenant_access_token`。
2. 读取两份飞书电子表格的指定工作表。
3. 排除第一份表中的“产品-负责人”模板页；第二份表的负责人统一记为“晕晕+欧阳”。
4. 按评论链接去重、重建周报统计，并按源表申诉状态包含“已删除”判定删除成功。
5. 将最新数据快照写入 Vercel Blob，网页重新加载后显示新数据。

## 一、飞书开放平台配置

1. 创建“企业自建应用”，取得 `App ID` 和 `App Secret`。
2. 为应用开通电子表格只读权限（至少需要读取电子表格/工作表数据的权限）。
3. 将该应用添加为两份源表的协作者或可查看成员。仅知道飞书表格密码不能替代开放平台应用授权。
4. 确认第一份 Wiki 页面背后的实际电子表格 token 是：

   `L58cs18QnhC9ketyJUYcJhQNnZe`

   如果实际 token 已变化，在 Vercel 中覆盖 `FEISHU_REVIEW_OLD_SPREADSHEET_TOKEN`。

## 二、Vercel 配置

将 GitHub 仓库导入 Vercel，并在 **Settings → Environment Variables** 的 **Production** 环境配置：

```text
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_REVIEW_OLD_SPREADSHEET_TOKEN=L58cs18QnhC9ketyJUYcJhQNnZe
FEISHU_REVIEW_NEW_SPREADSHEET_TOKEN=Zoa9sSFYhhUYRutX1yOcoObTnFf
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx
CRON_SECRET=随机长字符串
```

`BLOB_READ_WRITE_TOKEN` 需要来自 Vercel Blob Store。不要把真实值写入 GitHub、HTML 或前端 JavaScript；仓库只保留 `.env.example`。

## 三、生产地址和接口

部署后：

- 周报页面：`/review-appeal.html`
- 手动刷新：`POST /api/review-refresh`
- 刷新状态：`GET /api/review-refresh/status`
- 动态页面接口：`GET /api/review-dashboard`

打开周报后点击“刷新数据”，页面会显示“正在同步飞书”以及完成/失败状态。刷新失败时保留上一次成功快照。

## 四、自动刷新

`vercel.json` 已配置：

```text
0 14 * * * UTC = 北京时间每天 22:00
```

Vercel Cron 到点调用 `/api/cron/review-refresh`，重新抓取两份飞书表并写入 Blob。`CRON_SECRET` 用于保护该定时接口。

## 五、首次部署检查

部署后依次检查：

```text
GET  https://你的域名/review-appeal.html
GET  https://你的域名/api/review-refresh/status
```

首次部署还没有数据快照时，先在网页点击一次“刷新数据”。如果出现权限错误，优先检查：

- App ID / App Secret 是否填在 Vercel Production 环境；
- 飞书应用是否已发布/启用；
- 应用是否已加入两份表格的协作者；
- spreadsheet token 和工作表 ID 是否仍与源表一致；
- Vercel Blob Store 是否已连接并生成 `BLOB_READ_WRITE_TOKEN`。

## 六、安全边界

以下内容不能提交到 GitHub：飞书 App Secret、Vercel Blob Token、Cron Secret、源表密码、Amazon 登录信息、Chrome profile、源表原始抓取文件和包含真实评论链接的数据快照。
