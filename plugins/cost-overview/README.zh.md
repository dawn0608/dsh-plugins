# 费用概览

[English](README.md)

## 功能

- 当前会话产生 token 后，在输入框下方的内置统计旁显示费用和余额。
- 按 [DeepSeek 官方价格表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 计算会话费用。未知模型保留自己的 ID 和明细行，按 Flash 价格估算，并在相关金额前标注「估算」。
- 宿主使用已配置的 DeepSeek API Key 读取账户余额。点击统计按钮，可查看模型请求、网页请求、账户余额和赠送余额。

## 安装

在 Desktop「插件」页搜索 `@dawn0608/dsh-cost-overview`，或对目标 profile 执行以下命令。

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

### 从「会话花费」迁移

卸载 `@dawn0608/dsh-session-cost`，安装 `@dawn0608/dsh-cost-overview`，然后重启 DSH。可在 Desktop「插件」页操作，或执行以下命令。

```bash
dsh plugin --profile <profile> remove @dawn0608/dsh-session-cost
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

插件可以继续读取已有会话和 DeepSeek 凭据。如果为旧插件设置了 `SESSION_COST_API_KEY_ENV`，将其改为 `COST_OVERVIEW_API_KEY_ENV`。

## 使用与配置

点击统计按钮打开明细。按 Escape、点击面板外部或再次点击按钮可关闭。一个会话使用多个模型时，每个模型单独显示一行。已有 token 的会话读取失败时，统计按钮仍可点击，金额显示为占位符，面板说明失败原因。

客户端通过认证连接读取状态。切换会话、token 计数变化、打开面板、每五分钟以及标签页重新可见时会刷新。宿主将余额读取结果缓存一分钟。

余额配置来自宿主的 `llm-deepseek` 路由。宿主凭据服务或启动环境按 `apiKeyEnv` 解析 API Key，并按 `baseURL` 请求 `GET <baseURL>/user/balance`。启动环境的回退配置为 `COST_OVERVIEW_API_KEY_ENV` 和 `DEEPSEEK_BASE_URL`，默认分别是 `DEEPSEEK_API_KEY` 和 `https://api.deepseek.com`。

### 计费方式

DeepSeek 提供单价和账户余额。插件根据宿主日志重建当前会话费用。

| 输入 | 来源 |
| --- | --- |
| 未命中输入、缓存读写与输出 | `assistant/message` 的提供方用量、`assistant/attempt` 记录流的最后一个用量块，或 `compaction/summary` 的用量 |
| 模型和价格时段 | 日志中的模型路由与事件时间，按北京时间计算 |
| 搜索与抓取 | 成功的 `web_search` 按去重后的 query 数计算，成功的 `web_fetch` 每次计一笔 |

宿主从官方页面读取模型价格。成功读取后每隔 24 小时刷新，刷新失败时保留上一张表，并允许在一分钟后重试。首次读取失败时，面板会显示价格状态。可用的价格表缺少 Search 或 Fetch 单价时，最终兜底为每 1,000 次 ¥5。

## 兼容与限制

- 适用 DSH `>=0.2.2-rc.1 <0.3.0`。本地开发需要 Node.js 24 或更高版本。
- 事件时间与提供方请求时间可能落在不同价格时段。法定节假日遇工作日时，按平常工作日的时段计费。
- 当前会话费用不含标题生成、子会话和 Messages API 网页搜索。网页工具每次调用只报告一个结果。如果搜索结果标记为失败，即使上游有部分 query 成功，该次调用也计为零笔请求。
- 宿主尚未载入的会话可能无法读取。余额依赖 API Key 路由，使用 DeepSeek 账户登录的会话可能显示未配置 API Key。
- 账户余额反映全账户的活动，包括其他会话和进程。

## 开发

在仓库根目录运行 `npm test -w @dawn0608/dsh-cost-overview` 验证本插件，运行 `npm run verify` 执行全仓检查。构建将 `src/index.js` 与 `src/client/index.js` 打包成 `lib/index.js` 和 `lib/client.js`。本地重新构建后，重新加载宿主组合并刷新客户端。如果旧客户端模块仍占用插槽，重启 DSH。

宿主在 DSH 连接上注册 `GET /api/cost-overview/state?session=<id>`，客户端使用相对地址 `api/cost-overview/state`。响应包含余额、费用和价格状态。弹层使用 DSH 主题变量，定位逻辑按随包 [MIT 许可证](LICENSE) 改编自 DSH 0.2.2-rc.1 原生统计弹层。
