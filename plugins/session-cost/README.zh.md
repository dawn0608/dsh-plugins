# 会话花费（@dawn0608/dsh-session-cost）

[English](README.md) | 中文

在输入框下方的会话统计旁增加一个统计 pill，显示：

- **当前会话的总花费**，按提供方的计费方式计算：每次已记录的模型调用 × 该调用自身模型与价格时段的官方单价；
- **DeepSeek API 账户的剩余余额**，读取自 `GET https://api.deepseek.com/user/balance`。

## 安装

- 适用 DSH 版本：`>=0.2.2-rc.1 <0.3.0`
- npm 包名：`@dawn0608/dsh-session-cost`
- Desktop 应用请在「插件」页搜索/安装该包名；非 Desktop profile 可以使用：
  ```bash
  dsh plugin --profile <profile> add @dawn0608/dsh-session-cost
  ```
- 余额读取使用当前 DSH 配置的 `DEEPSEEK_API_KEY`，不会使用插件作者或其他人的凭据。
- 本地构建与升级都使用这一个包名；不要同时安装同一插件的第二个别名（例如 `@local/dsh-session-cost`）。DSH 以包名作为客户端模块的身份，两个包名就是两个模块。从别名迁移时，先卸载旧包，再重启应用。
- 安装后，在输入框下方产生 token 后出现统计 pill；点击可查看明细。

源码与问题反馈：[GitHub 仓库](https://github.com/dawn0608/dsh-plugins)。

点击 pill 会打开与内置统计弹窗一致的布局——相同的 16px 内边距、12px/18px 字号、8px 标题分隔线和 6px 行间距——标题行显示总额，下面是一列明细：模型、模型请求次数、网页搜索与抓取次数（始终显示，包括 `0 次`；其费用已折入总额）以及账户余额。会话切换过模型时，每个模型单独一行，分别显示该模型的费用和请求次数。按 Escape、点击面板外部或再次点击按钮都会关闭。这里刻意不显示 token 数：内置的 `usage` pill 已经显示它们。

## 这里的“精确”指什么

DeepSeek 公布的是**价格**，不是账单：没有按会话查询用量或账单的接口，只有账户余额。账单本身由 `tokens × 单价` 构成（[价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)），所以本插件从会话日志重建这个公式：

| 输入 | 来源 |
| --- | --- |
| 每次调用的 token | `assistant/message` 事件的 `usage.inputTokens`（未命中的输入）、`cacheReadTokens`、`cacheWriteTokens`、`outputTokens` |
| 已结束的尝试 | `assistant/attempt` 事件的记录流中最后一个 `usage` chunk（重试、失败、中断） |
| 压缩调用 | `compaction/summary` 事件，本身携带 `usage` 和路由 |
| 模型 | 同一事件的 `message.source.model` |
| 价格时段 | 同一事件的 `time`，按北京时间计算 |
| Search / Fetch | 每个成功且去重后的 `web_search` query、每个 `web_fetch` 各算一次请求，按 ¥5 / 1,000 计 |

### 唯一价格来源：官方页面

插件只使用 [`DOCS_URL`](pricing.js#L12) 公布的价格表，没有内置的模型价格副本，也没有本地覆盖，因此模型价格始终是官方价格。只有可读页面缺少 Search/Fetch 行时，才使用 Search/Fetch 的最后兜底价格（¥5 / 1,000）。页面最多每 24 小时重读一次；读取失败（包括成功加载后的某次刷新失败）会在 1 分钟后重试。只有六个价格都存在、处于合理范围，并且每个高峰价格恰好是空闲价格的 2 倍时才接受解析结果——这是页面声明的规则，不一致说明布局或计费方案已变化。

没有模型价格兜底的后果：

- 首次成功读取之前**没有价格**，面板显示 `价格获取失败` / `价格获取中` 而不是数字（运行后的第一次请求会等待这次读取，因此能显示时会尽快显示）；
- 之后刷新失败时保留上一张官方表——仍然是官方价格，只是较旧——失败只报告在 Host 的 `state` payload 中；
- 价格来源和测量时刻都不是面板行：只有一个来源时没有可选项，因此面板只显示数字。

会话标题生成没有计入：日志记录了它的请求（`session/title-llm-request`），但没有记录用量，而且每个标题只是不到一分钱的量级。Messages 版网页搜索同样没有计入（只记录了请求，没有记录用量）；当前组合选择的是专用 Search/Fetch API，按请求计费。

不在 DeepSeek 家族中的模型 id，或未知的 DeepSeek id，会保留自己的行和真实 id，但按 `deepseek-flash` 价格计费，确保总额不会被静默丢弃；payload 会在 `unknownModels` 中列出这些 id。

账户余额是账户级的：标题生成、其他会话和其他进程也会消耗余额，所以 `会话花费` 和余额下降不要求精确到分一致。

### 已知限制

- 工作日遇到法定节假日时仍按高峰价格计算，因为无法离线取得节假日日历。这会高估账单，不会低估。
- 价格时段使用事件结算时间。跨越时段边界的调用可能被归到与提供方不同的时段；日志没有每次尝试的权威请求开始时间。
- 标题生成、子会话和 Messages 版网页搜索没有计入当前会话总额。
- 余额通过 API Key 路由读取。使用 DeepSeek 账户登录的会话可能显示 `未配置 API Key`，而不是账户余额。
- 多 query 的 `web_search` 如果部分 query 成功、部分失败，无法部分计费：工具只报告一个失败结果，因此插件不会为该次调用计费。

## 数字从哪里来

浏览器永远看不到 API Key。`index.js`（Host 半侧）：

1. 从设置目录读取 `llm-deepseek` 条目的实时 `apiKeyEnv` 和 `baseURL`（默认值：`DEEPSEEK_API_KEY` 和 `https://api.deepseek.com`）；
2. 通过 `ctx.credentials` 解析该 key，再从启动环境解析；
3. 调用 `GET <baseURL>/user/balance`，缓存 **1 分钟**（成功和失败都缓存），因此不会比这更频繁地访问上游；
4. 把当前 Session 的日志折叠成精确成本，日志没有变化时复用上一次折叠结果（按日志偏移缓存，而不是按时间）；
5. 通过两条路由返回同一份 payload：
   - `GET /plugin/session-cost/state?session=<id>` —— 普通 Web 路由；
   - `GET /api/session-cost/state?session=<id>` —— 连接共享通道上的精确 Fetch 路由，用于没有文档 origin 的 shell carrier。

`client.js`（Client 半侧）会在 token 总量变化时立即读取——与内置统计 pill 移动的是同一个事件——在 Session 变化时、挂载时、打开面板时、每五分钟以及标签页重新可见时读取。payload 中的余额来自 Host 的 1 分钟缓存，因此这种成本刷新不会放大上游余额请求。它会先尝试文档 origin（静态桌面页面则用 `__DSH_TRANSPORT__.streamBaseUrl` 的 origin），再尝试 `api/...` 通道形式。

如果 Session 不在运行，Host 返回 `not-live`，面板显示该状态；不会渲染估算值。

失败会明确显示，而不是永久转圈：`missing-key`、`unauthorized`、`network`、`timeout`、`no-wallet`、`not-live` 各自在面板中显示对应文案，pill 保持紧凑。

## 行为

- pill 是 `conversation.composer.dock` 的条目，id 为 `session-cost`，order 为 `2`，因此排在内置 `activity`（0）和 `usage`（1）之后，位于上下文 meter 之前。新 id 只增加一个控件，不会替换任何一个内置 pill。
- pill 与内置统计同时出现：Session 产生 token 之前不显示，本 Session 自己的成本仍在读取时也不显示。
- 精确成本显示为 `¥2.30`；官方价格表无法读取时 pill 显示 `—`，面板说明原因。
- pill 不会省略：它保持固有宽度（`flex: none`），因此余额在其它统计旁仍完整可读。
- 界面文案随 DSH 语言切换（zh/en）；样式只使用 `--dsw-*` 主题 token。
- 如果另一个客户端模块已经占用了 `session-cost` 这个 slot id（例如换包名后残留的旧副本），本模块会跳过自己的注册并输出警告，而不是让页面同步失败；重启应用即可清掉旧副本。

## 更新 Client 半侧

`npm run build` 会把 `src/index.js` 打包为 `lib/index.js`，把 `src/client/index.js`（连同其模块与样式）打包为 `lib/client.js`。Host 半侧通过 profile 重新组合（启用/禁用该行）重载。浏览器会保留已经加载的 bundle generation，因此重新构建后需要刷新页面；如果刷新后旧的 pill 仍然存在，重启应用——重启会重新发布所有 bundle revision。

## 文件布局

| 文件 | 作用 |
| --- | --- |
| `cordis.patch.yml` | 插入组合包行。 |
| `src/index.js` | Host 半侧：价格服务接线、余额请求、两条路由、Session 选择回退。 |
| `src/pricing.js` | 官方价格页解析、刷新策略、Search/Fetch 价格。 |
| `src/cost.js` | 纯成本折叠、模型解析、价格时段、Web 请求计数。 |
| `src/balance.js` | 纯余额解析与端点归一化。 |
| `src/client/index.js` | pill、面板、slot 注册。 |
| `src/client/i18n.js` | 中英文字典与 locale 服务绑定。 |
| `src/client/store.js` | 浏览器侧余额与 Session 花费状态读取。 |
| `src/client/format.js` | 金额、数量与货币符号格式化。 |
| `src/client/style.css` | 客户端样式，构建期作为文本内联。 |
| `locale/{en,zh}.json` | 插件管理器标题和描述；`zh` 详情使用 `README.zh.md`，`en` 默认使用 `README.md`。 |
| `icon.svg` | 插件行图标。 |
| `LICENSE` | MIT 许可证。 |
| `lib/` | 构建产物（`lib/index.js`、`lib/client.js`），由 `npm run build` 生成，不入库。 |

## 验证

- `npm run build` 构建 Host 与 Client 两半；`npm test` 会先重建，再覆盖解析器、刷新策略、成本折叠、模型解析、价格时段、Web 请求计数、余额辅助函数、locale 字典对齐与 client loader 契约（`lib/client.js` 的 id、factory、`apply`/`inject`）。
- `GET /plugin/session-cost/state?session=<id>` 返回 `{ balance, cost }`；`cost.total` 等于对同一 Session 日志独立执行 `foldCost` 的结果。
- 实时抓取官方价格页应得到 Flash 命中 0.02/0.04、未命中 1/2、输出 4/8；Pro 命中 0.15/0.3、未命中 4.5/9、输出 13.5/27；Search/Fetch 每次请求 0.005。
- `cordis_inspect_query` → Client `Slots.listSubTree`，根为 `conversation.composer.dock`，在有 Session 打开时会报告 `session-cost` 占用者。
- 渲染后的 pill 需要连接页面做视觉确认；打开面板应触发一次新的 state 读取。
