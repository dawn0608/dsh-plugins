# 费用概览

[English](README.md) | 中文

在 DeepSeek Harness 输入框下方查看当前会话的费用估算和 DeepSeek API 账户余额。会话记录 token 用量后会出现费用入口。点击可查看各模型的费用与请求次数、网页搜索和抓取次数，以及账户余额。

## 安装

适用于 DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`。在 Desktop 打开「插件 → 添加插件」，输入 `@dawn0608/dsh-cost-overview`。也可以通过 CLI 安装。

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

余额读取使用 Harness 为 DeepSeek 配置的 API Key 和服务地址，默认密钥环境变量为 `DEEPSEEK_API_KEY`。仅使用账户登录时，余额可能无法读取。Host 请求 `/user/balance` 并缓存结果一分钟，浏览器接收余额或错误状态。

### 从「会话花费」迁移

卸载旧包，安装费用概览，再重启 Harness。已有会话和 DeepSeek 凭据可继续使用。

```bash
dsh plugin --profile <profile> remove @dawn0608/dsh-session-cost
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

如果启动环境设置了 `SESSION_COST_API_KEY_ENV`，将其改为 `COST_OVERVIEW_API_KEY_ENV`。

## 费用估算口径

- 插件按每次模型调用记录的输入、缓存及输出 token 数，结合该模型和时段的官方单价估算费用。已完成消息、调用尝试和上下文压缩中记录的用量都会计入。会话切换模型时，明细按模型分行。
- 专用 Search 和 Fetch API 的成功请求计入总额。同一次搜索中的重复查询只计一次。多查询调用部分成功但整体失败时，日志无法提供逐条结果，因此该调用无法计费。
- 模型单价取自官方价格页，成功读取 24 小时后刷新，失败后一分钟重试。刷新失败时沿用上一张可读价格表，首次成功读取前显示价格状态。若可读价格表缺少 Search 或 Fetch 单价，则使用对应的兜底费率。[DeepSeek 官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
- 未识别的模型保留独立明细，按 `deepseek-flash` 单价估算。价格时段取北京时间的日志事件时间，跨时段调用可能归到不同区间，工作日法定节假日按普通工作日处理。

会话估算不包含标题生成、子会话和 Messages 版网页搜索。账户余额也会随当前会话之外的用量变化。费用估算适用于已记录用量且仍在运行的会话。

## 开发

在仓库根目录运行 `npm run verify`。Host 和 Client 构建产物位于 `lib/`。Host 通过 Web 路由 `/plugin/cost-overview/state` 和连接通道 `/api/cost-overview/state` 提供会话费用和余额。重新构建本地安装的副本后，刷新或重启 Harness。
