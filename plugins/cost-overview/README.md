# Cost Overview

[简体中文](README.zh.md)

## Features

- Adds a cost and balance pill beside the built-in composer statistics after the current session records tokens.
- Uses the [official DeepSeek price table](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) to calculate session costs. Unknown model IDs keep their own rows, use the Flash rate, and mark the affected amounts as estimates.
- Reads the account balance on the host with your configured DeepSeek API key. The pill opens a breakdown of model requests, web requests, account balance, and any granted balance.

## Installation

Search for `@dawn0608/dsh-cost-overview` on the Desktop Plugins page, or run the following for your profile.

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

### Migrating from Session Cost

Remove `@dawn0608/dsh-session-cost`, install `@dawn0608/dsh-cost-overview`, and restart DSH. You can do this on the Desktop Plugins page or run these commands.

```bash
dsh plugin --profile <profile> remove @dawn0608/dsh-session-cost
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

The plugin can read existing sessions and DeepSeek credentials. If you set `SESSION_COST_API_KEY_ENV` for the old plugin, rename it to `COST_OVERVIEW_API_KEY_ENV`.

## Usage and configuration

Click the pill to open the breakdown. Press Escape, click outside the panel, or click the pill again to close it. Each model gets a separate row when a session uses several models. If a read fails after the session has recorded tokens, the pill remains available with a placeholder and the panel explains the error.

The client reads through the authenticated connection when the session or token counts change, when you open the panel, every five minutes, and when the tab becomes visible. The host caches balance reads for one minute.

Balance settings come from the host's `llm-deepseek` route. The `apiKeyEnv` setting names the key to resolve through the host credential service or launch environment. The `baseURL` setting supplies the endpoint for `GET <baseURL>/user/balance`. The launch-environment fallbacks are `COST_OVERVIEW_API_KEY_ENV` and `DEEPSEEK_BASE_URL`, which default to `DEEPSEEK_API_KEY` and `https://api.deepseek.com`.

### How costs are calculated

DeepSeek provides unit prices and an account balance. The plugin reconstructs the session cost from the host log.

| Input | Source |
| --- | --- |
| Uncached input, cache reads and writes, and output | Provider usage in `assistant/message`, the last usage chunk of a logged `assistant/attempt`, or `compaction/summary` |
| Model and price window | Recorded model route and event timestamp, using Beijing time |
| Search and Fetch | One request per successful, deduplicated `web_search` query and per successful `web_fetch` |

The host reads model prices from the official page. It refreshes a successful table after 24 hours, retains it if a refresh fails, and allows a retry after one minute. If the first load fails, the panel shows the pricing status. If a usable table lacks a Search or Fetch price, the last fallback is ¥5 per 1,000 requests.

## Compatibility and limitations

- DSH `>=0.2.2-rc.1 <0.3.0` and Node.js 24 or later for local development.
- The event timestamp may land in a different price window from the provider's request time. Weekday statutory holidays use the normal weekday rates.
- Title generation, child sessions, and Messages API web search are excluded. The web tool reports one result per call, so a Search call reported as failed contributes zero requests, even if some queries succeeded upstream.
- Session history outside the live host may be unavailable. Balance requires an API key route. A session using DeepSeek account sign-in may show a missing API key.
- Account balance reflects activity across the whole account, including other sessions and processes.

## Development

From the repository root, run `npm test -w @dawn0608/dsh-cost-overview` for the plugin tests and `npm run verify` for the full repository check. The build turns `src/index.js` and `src/client/index.js` into `lib/index.js` and `lib/client.js`. After a local rebuild, reload the host composition and refresh the client. Restart DSH if a previous client generation still occupies the slot.

The host registers `GET /api/cost-overview/state?session=<id>` on the DSH connection. The client uses the relative URL `api/cost-overview/state`. The response contains balance, cost, and pricing status. The panel uses DSH theme tokens and adapts the native statistics panel placement from DSH 0.2.2-rc.1 under the packaged [MIT license](LICENSE).
