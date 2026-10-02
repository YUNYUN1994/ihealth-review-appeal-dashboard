# Amazon 经营数据驾驶舱

这是 Amazon 经营数据可视化网页，数据源为现有飞书多维表格。网页支持 PM 与领星口径、月度/季度/周度/年度分析、分类与明细查看、2026 年硬件目标完成度，以及手动和定时数据更新。

## 运行环境

- Windows
- Node.js 22 或更高版本
- Google Chrome
- 可访问飞书数据源的网络和已验证浏览器会话

## 启动网页

```powershell
npm start
```

访问：`http://127.0.0.1:8765/amazon-dashboard.html`

若本机链接无法连接，可执行 `powershell -ExecutionPolicy Bypass -File .\install-dashboard-server.ps1`，安装并启动后台网页服务。服务以隐藏窗口运行，登录时启动；停止后每 5 分钟尝试补启动。此操作不修改每天 12:00、18:00 的数据刷新任务。

已安装服务后，执行 `powershell -ExecutionPolicy Bypass -File .\start-dashboard.ps1 -OpenBrowser` 可自动启动并打开网页。网页服务仍要求电脑开机且用户已登录。

## 数据更新

页面顶部的“立即更新数据”按钮会调用本地服务，依次抓取 8 张飞书表格（含库存表）。全部表格通过名称、列数、记录数和数据截止日期校验后，才会替换网页数据；抓取失败时继续保留上一次成功数据。

抓取范围使用固定业务表名单，明确排除“引用表-不读取”，不打开或提取该表单元格。库存新增的右侧列需等待加载并稳定后保存，不能将尚未加载的数据当作空白库存。

## 库存与可售周数

库存来自同一工作簿的“库存表”，按最新 `snapshot-date` 取数。产品对照优先使用 SKU + ASIN 一致的记录；SKU 未匹配时使用 ASIN，SKU 命中另一 ASIN 时保留冲突提示，避免错归产品。产品表中 ASIN 为空但 SKU 一致时可用 SKU 对照。

指定库存 SKU 规则优先于一般去重规则：`B00J6P2KB2` 只计 `PO3-20151014`，`B0D3T1X1FS` 只计 `COV-FLU-4`。同 ASIN 的其他 SKU 无论库存是否相同均排除，产品分类也以指定 SKU 对照；若该 ASIN 在最新库存快照中存在但指定 SKU 缺失，停止本次发布并保留上次成功快照，绝不改取其他 SKU。指定排除与普通重复分别审计，合计扣除量仍与原始库存守恒。此规则仅作用于库存，周销量仍按 ASIN 汇总。

同一快照、同一 ASIN 内先汇总同 SKU 的八项原始库存数量；不同 SKU 的八个数值全部相同只计一次，任何一项不同则相加。比较字段为下列计算中的 `available`、`Reserved FC Processing`、`Reserved Staging`、`inbound-received`、`no-sale-last-6-months`、`iHealth仓库-US 预计库存`、`头程海上在途`、`iHealth Open 订单-工厂在执行订单`，空白按 0；FNSKU、SKU 名称及非库存字段不参与数量比较。不会跨 ASIN 或快照去重，空 SKU 不与其他 SKU 去重。保留被扣除的 SKU、行号和数量，在网页“去重记录”中展示。周销量仍按 ASIN 汇总，不应用库存去重规则。

- 可售库存 = `available`
- 预留库存 = `Reserved FC Processing` + `Reserved Staging`
- FBA 在途 = `inbound-received` + `no-sale-last-6-months`
- FBA 总库存 = 可售 + 预留 + FBA 在途
- 美国本地库存 = FBA 总库存 + iHealth仓库-US 预计库存
- 全链条库存 = 美国本地库存 + 头程海上在途 + iHealth Open 订单-工厂在执行订单
- 可售周数使用的日均销量 = 当前 PM/领星口径的最近四个连续完整实际周销量之和 ÷ 28；近两周销量和日均销量仅供趋势对照
- 五种可售周数 = 对应库存 ÷（日均销量 × 7），美国本地/全链条库存含预计库存和未到货订单，表示库存覆盖能力，不表示立即可售数量
- 试剂盒单独使用安全线：可售库存低于 8 周为红色，8–24 周（含边界）为绿色，超过 24 周为黄色；可售+预留库存 12 周、FBA 总库存 16 周，低于各自安全线为红色，达到为绿色。美国本地与全链条周数仍使用各自库存规则。
- 补货建议仅针对试剂盒。预测下周销量 = 当前最近四周实际销量的周均值；若有完整历史同期四周数据，则按当前 80% + 历史同期 20% 加权。提前一周下单时，建议补货量 = max(0，ceil(预测下周销量 × 13 − 当前可售+预留库存))，目标为补后覆盖未来一周销量及 12 周安全库存；销量不足时不虚构数量。

库存使用最新快照，不随历史年月筛选改变；销量窗口的日期在库存版块中独立标注。每个 ASIN 必须具有最近四周销量记录，缺记录不视为零；不足四周、周次不连续、任一周日期不完整或销量无效时不计算可售周数，也不回退为两周口径；四周总销量为零或负数时显示不可计算。库存数量空白按 0 计，非法数字则阻止发布。可售、可售+预留及 FBA 库存周数 ≤12 绿色、>12–20 黄色、>20–24 橙色、>24 红色。美国本地库存周数 18–20（含边界）绿色、>24 红色、其余有效区间黄色；全链条库存周数 22–24（含边界）绿色、>36 红色、其余有效区间黄色。无可计算结果为灰色；颜色筛选随所选库存状态依据使用对应规则。

首次部署到新电脑时，需要先为专用 Chrome 配置建立可访问飞书表格的会话。浏览器配置目录为 `chrome-profile-cdp2`，该目录包含认证状态并已被 Git 忽略，不能上传到仓库。

手动执行完整刷新：

```powershell
npm run refresh
```

## 定时更新

安装 Windows 计划任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-dashboard-tasks.ps1
```

安装后：

- 每天 12:00 自动抓取并更新
- 每天 18:00 自动抓取并更新
- 用户登录 Windows 后自动启动网页服务
- 电脑休眠或错过计划时间后，会在恢复运行时尽快补跑

计划任务以当前 Windows 用户运行，因此定时更新要求电脑开机且用户已登录。飞书会话失效时，页面会显示错误并保留上一次成功数据。

## 发布文件

- `amazon-dashboard.html`：网页结构和样式
- `dashboard-runtime.js`：筛选、图表、完成度和更新交互
- `amazon-data.js`：当前已发布的数据快照
- `server.mjs`：静态网页与数据更新接口
- `refresh-data.mjs`：完整抓取、校验和原子发布流程
- `extract-one.mjs`：逐表抓取
- `build-data.mjs`：源数据解析与网页数据生成
- `inventory-model.mjs`：库存 SKU/ASIN 对照、库存去重、四周日销和可售周数计算，并保留两周销量对照
- `install-dashboard-tasks.ps1`：定时任务安装

仓库不会保存 GitHub Token、飞书密码、浏览器会话、原始抓取缓存、日志或调试截图。
## 差评申诉周报生产部署（无需本机 Chrome）

生产版可以完全不依赖本机 Chrome 登录：后端通过飞书开放平台 API 获取两份源表，网页按钮调用生产 API 更新，更新后的数据快照保存在 Vercel Blob 中。飞书密码和浏览器会话不会进入 GitHub。

### 首次配置

1. 在飞书开放平台创建企业自建应用，获取 `App ID` 和 `App Secret`。
2. 为应用开通电子表格只读权限，并把应用添加为两份源表的协作者（至少可查看）。Wiki 页面需要使用其实际电子表格 `obj_token`；本项目默认值为 `L58cs18QnhC9ketyJUYcJhQNnZe`，如实际环境不同请改成 Vercel 环境变量。
3. 在 Vercel 配置 `.env.example` 中的环境变量：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REVIEW_OLD_SPREADSHEET_TOKEN`、`FEISHU_REVIEW_NEW_SPREADSHEET_TOKEN`、`BLOB_READ_WRITE_TOKEN`、`CRON_SECRET`。
4. 部署后打开 `/review-appeal.html`。点击“刷新数据”会通过 `/api/review-refresh` 重新抓取两份飞书表，排除“产品-负责人”模板页，按评论链接去重，再写入生产快照。

### 生产地址与定时任务

- 差评周报：`/review-appeal.html`
- 手动更新：`POST /api/review-refresh`
- 更新状态：`GET /api/review-refresh/status`
- 定时更新：Vercel Cron 每天 UTC 14:00，即北京时间每天 22:00

### 安全注意事项

不要把飞书 App Secret、Vercel Blob Token、飞书密码、浏览器 profile 或源表原始缓存提交到 GitHub。前端只调用自己的 API，绝不会拿到飞书 App Secret。生产删除统计仍以源表申诉状态包含“已删除”为准。
