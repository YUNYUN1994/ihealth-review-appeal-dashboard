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

## 数据更新

页面顶部的“立即更新数据”按钮会调用本地服务，依次抓取 7 张飞书表格。全部表格通过名称、列数、记录数和数据截止日期校验后，才会替换网页数据；抓取失败时继续保留上一次成功数据。

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
- `install-dashboard-tasks.ps1`：定时任务安装

仓库不会保存 GitHub Token、飞书密码、浏览器会话、原始抓取缓存、日志或调试截图。
