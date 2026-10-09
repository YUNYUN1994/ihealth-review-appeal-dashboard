# iHealth 差评申诉周报

这是部署在腾讯云现有 Ubuntu 服务器上的独立差评申诉看板。生产运行不依赖 Vercel、SCF、COS、本机 Chrome 或飞书浏览器登录态；后端通过飞书开放平台 API 读取本应用独立的 `FEISHU_SOURCES_FILE`，并把成功快照写入独立本地数据目录。

## 生产路由

- `/apps/review-appeals/`：网页
- `/apps/review-appeals/healthz`：本应用健康检查
- `/apps/review-appeals/api/data`：真实统计数据
- `/apps/review-appeals/api/refresh/status`：刷新状态
- `POST /apps/review-appeals/api/refresh`：重新读取飞书并生成新快照

Nginx 会将外部前缀去掉后代理到本应用的 `127.0.0.1:8771`。前端 API 通过注入的应用前缀访问，不调用 Amazon 看板的根 `/api/*`。

## 数据和安全口径

- 源表申诉状态包含“已删除”才计入删除成功；不再用 Amazon 前台页面状态替代源表口径。
- 空白记录或空字段不进入对应统计。
- “产品-负责人”模板页、 “引用表-不读取” 和 “WOOT登记表”不读取。
- 每次手动刷新都会重新调用飞书 API，读取申诉源表和独立的 `领星_周度订单利润` 销量源表；先严格校验 spreadsheet token、sheetId、expectedTitle 和必需字段；失败时保留上一次成功数据。
- “留评时间”维度按 `ASIN + ISO 周` 关联销量，展示当周销量和差评率（当周新增差评数 ÷ 当周销量）；销量缺失时不把未知销量静默当作 0。
- App Secret 和完整表格 Token 只保存在服务器受保护配置文件，不进入 GitHub、前端或公开 API。

## 本地检查

```powershell
npm install
npm run check
```

本地启动需要提供与生产相同结构的环境变量：`APP_SLUG`、`APP_BASE_PATH`、`HOST`、`PORT`、`APP_DATA_DIR`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_SOURCES_FILE`。

## 自动更新

当前生产部署不创建定时器，页面显示“自动更新：未启用 · 手动刷新”。确认频率后再为本应用单独增加 systemd timer；不会修改 Amazon 看板既有的 12:00 / 18:00 timer。
