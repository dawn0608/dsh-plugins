# Cost Overview

English | [中文](README.zh.md)

See the estimated cost of the current DeepSeek Harness session and the DeepSeek API account balance below the composer. The control appears after the session records token usage. Open it for a breakdown by model, model request counts, web search and fetch counts, and the account balance.

## Install

Requires DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`. In Desktop, open **Plugins → Add plugin** and enter `@dawn0608/dsh-cost-overview`. You can also install it with the CLI.

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

The balance uses the API key and base URL configured for DeepSeek in Harness. The default key variable is `DEEPSEEK_API_KEY`. Account sign-in alone may leave the balance unavailable. The host requests `/user/balance` and caches the result for one minute. The browser receives the balance or an error status.

### Migrating from Session Cost

Remove the old package, install Cost Overview, and restart Harness. Existing sessions and DeepSeek credentials are reused.

```bash
dsh plugin --profile <profile> remove @dawn0608/dsh-session-cost
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

If you set `SESSION_COST_API_KEY_ENV` in the launch environment, rename it to `COST_OVERVIEW_API_KEY_ENV`.

## How the estimate works

- The plugin prices each recorded model call using its input, cache, and output token counts and the published unit prices for that model and time window. It includes recorded usage from completed messages, attempts, and compaction. When a session switches models, each model gets its own row.
- Successful requests to the dedicated Search and Fetch APIs contribute to the total. Repeated queries within one search are counted once. A failed multi-query tool call with partial success cannot be priced from its single result.
- The model price table comes from the official pricing page. The plugin refreshes it after 24 hours and retries failures after one minute. It keeps the last readable table after a failed refresh. Before the first successful read, it shows a price status in place of the estimate. Search and Fetch have a fallback rate when a readable table omits those prices. [DeepSeek pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
- Unrecognized model IDs keep their own rows and use the `deepseek-flash` rate. Time windows are based on the logged event time in Beijing time. A call crossing a price boundary may fall in a different window, and weekday public holidays are treated as ordinary weekdays.

The session estimate excludes title generation, subagent sessions, and Messages-based web search. The account balance also reflects activity outside the current session. The estimate is available for live sessions with usage in the log.

## Development

Run `npm run verify` from the repository root. The build emits the host and client bundles in `lib/`. The host serves session cost and balance through `/plugin/cost-overview/state` for Web and `/api/cost-overview/state` for the connection channel. Refresh or restart Harness after rebuilding a locally installed copy.
