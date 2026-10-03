# 腾讯云生产部署清单

## 一、需要提供给 Codex 的非敏感信息

```text
腾讯云 Region，例如 ap-guangzhou：
COS Bucket 名称（含 AppID 后缀）：
SCF 函数名：
SCF CAM 运行角色名：
是否配置自定义 API 网关域名：
```

两份飞书表 token 已写入代码默认值；如果表格 token 发生变化，再提供新的 token。模板页不会读取。

## 二、在本机配置敏感信息（不要贴到聊天）

在仓库根目录复制 `.env.example` 为 `.env.tencent`，填写：

```text
FEISHU_APP_ID=你的飞书企业自建应用 App ID
FEISHU_APP_SECRET=你的飞书 App Secret
CRON_SECRET=随机长字符串
```

如果 SCF 没有绑定 CAM 运行角色，才需要额外填写：

```text
TENCENT_SECRET_ID=腾讯云访问密钥 ID
TENCENT_SECRET_KEY=腾讯云访问密钥 Key
```

`.env.tencent` 已被 `.gitignore` 忽略。推荐在腾讯云侧绑定 CAM 角色，让函数使用临时凭证访问 COS。

## 三、部署前权限

1. 飞书应用已发布，具有读取电子表格/工作表数据的权限，并被两份源表授权查看。
2. COS Bucket 已创建，SCF 运行角色至少拥有目标 Bucket 对应对象的读写权限。
3. 本机已安装 Node.js 20+、npm，以及腾讯云 Serverless CLI。
4. 已完成腾讯云 CLI 登录，或已配置 CLI 所需的部署凭证。

## 四、告诉 Codex 的最终输入

完成以上配置后，在对话中只需发送：

```text
腾讯云部署配置已完成，请执行检查、部署并把生产访问地址发给我。
```

Codex 会依次执行依赖安装、语法检查、Serverless 部署、状态接口检查和网页访问检查，不会读取或回显敏感值。
