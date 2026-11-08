# Session Cost (@dawn0608/dsh-session-cost)

English | [中文](README.zh.md)

Adds a statistics pill next to the composer statistics that shows:

- **The current Session's total cost**, priced the way the provider bills it: every logged model call × the official unit price of that call's own model and price window;
- **The remaining balance of the DeepSeek API account**, read from `GET https://api.deepseek.com/user/balance`.

## Installation

- DSH version: `>=0.2.2-rc.1 <0.3.0`
- npm package: `@dawn0608/dsh-session-cost`
- In the Desktop app, search for and install this package on the Plugins page; non-Desktop profiles can use:
  ```bash
  dsh plugin --profile <profile> add @dawn0608/dsh-session-cost
  ```
- The balance is read with the `DEEPSEEK_API_KEY` configured in the current DSH; it never uses the plugin author's or anyone else's credentials.
- After installation, the statistics pill appears below the composer once the Session has produced tokens; click it to see the breakdown.

Source and issue tracker: [GitHub repository](https://github.com/dawn0608/deepseek-harness-plugins).

Clicking the pill opens the same layout as the built-in statistics dialog — the same 16px padding, 12px/18px type, 8px title rule, and 6px row rhythm — with a title row carrying the total and a flat list of: model, model requests, web search & fetch counts (always shown, including `0`; their charge is folded into the total), and the account balance. A Session that switched models lists one line per model, with that model's own cost and request count. Escape, an outside pointer press, or the button itself closes it. Token counts are deliberately absent: the built-in `usage` pill already shows them.

## What "exact" means here

DeepSeek publishes **prices**, not a bill: there is no per-session usage or billing endpoint, only the account balance. The bill itself is formed as `tokens × unit price` ([pricing page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)), so the plugin reconstructs that formula from the Session log:

| Input | Source |
| --- | --- |
| tokens per call | `assistant/message` events: `usage.inputTokens` (the uncached, cache-miss part), `cacheReadTokens`, `cacheWriteTokens`, `outputTokens` |
| retired attempts | the last `usage` chunk in the recorded stream of `assistant/attempt` events (retries, failures, interruptions) |
| compaction calls | `compaction/summary` events, which carry their own `usage` and route |
| model | the same event's `message.source.model` |
| price window | the same event's `time`, priced in Beijing time |
| Search / Fetch | one billed request per successful, de-duplicated `web_search` query and each `web_fetch`, at ¥5 / 1,000 |

### One price source: the official page

The plugin uses only the table published at [`DOCS_URL`](pricing.js#L12), with no built-in model price copy and no local override, so model prices are always official. Only when a readable page omits its Search/Fetch rows does it use the last-resort Search/Fetch fallback price (¥5 / 1,000). The page is re-read at most once every 24 hours; a failed read (including a failed refresh after a successful load) retries after 1 minute. The parse is accepted only when all six prices exist, are in a plausible range, and every peak price is exactly twice its off-peak price — the page states that rule; a mismatch means the layout or the billing scheme changed.

Consequences of having no model-price fallback:

- Before the first successful read there is **no price**, so the panel shows `Failed to fetch prices` / `Fetching prices` instead of a number (the first request of a run waits for that read, so the number appears as soon as it can);
- When a later refresh fails, the previous official table is retained — still official, just older — and the failure is reported only in the Host `state` payload;
- Neither the price source nor the measurement time is a panel row: with only one source there is nothing to choose, so the panel shows only the numbers.

Session-title generation is not included: the log records its request (`session/title-llm-request`) but not its usage, and each title is worth less than a cent. Messages-based web search is also not included (its request is logged, not its usage); the shipped composition selects the dedicated Search/Fetch API, which is billed per request.

A model id outside the DeepSeek family, or an unknown DeepSeek id, keeps its own row and real id, but is priced at `deepseek-flash` rates so the total is never silently dropped; the payload lists such ids under `unknownModels`.

The account balance is account-wide: title generation, other Sessions, and other processes also spend it, so `Session cost` and the balance drop do not have to match to the cent.

### Known limitations

- Weekday statutory holidays are still billed at peak prices because the holiday calendar is not available offline. This overestimates the bill, never underestimates it.
- The price window uses the event settlement time. A call that crosses a window boundary may be assigned a different window than the provider used; the log has no authoritative request-start time for each attempt.
- Title generation, subagent Sessions, and Messages-based web search are not included in the current Session total.
- The balance is read through the API-key route. A Session signed in with a DeepSeek account may show `Missing API key` instead of an account balance.
- A multi-query `web_search` that partially succeeds cannot be partially billed: the tool reports one failed result, so the plugin does not bill that call.

## Where the numbers come from

The browser never sees the API key. `index.js` (Host half):

1. reads the live `apiKeyEnv` and `baseURL` of the `llm-deepseek` entry from the settings catalog (defaults: `DEEPSEEK_API_KEY` and `https://api.deepseek.com`);
2. resolves that key through `ctx.credentials`, then from the launch environment;
3. calls `GET <baseURL>/user/balance`, cached for **1 minute** (success and failure alike), so it never hits the upstream endpoint more often;
4. folds the current Session's log into an exact cost, reusing the previous fold while the log has not changed (cached by log offset, not by time);
5. returns one payload on two routes:
   - `GET /plugin/session-cost/state?session=<id>` — a plain Web route;
   - `GET /api/session-cost/state?session=<id>` — an exact Fetch route on the connection's shared channel, for a shell carrier without a document origin.

`client.js` (Client half) reads immediately when token totals change — the same event the built-in statistics pill moves on — when the Session changes, on mount, when the panel opens, every five minutes, and when the tab becomes visible. The balance in that payload comes from the Host's 1-minute cache, so this cost refresh never multiplies upstream balance requests. It tries the document origin (or the `__DSH_TRANSPORT__.streamBaseUrl` origin for a static desktop page) first, then the `api/...` channel form.

If the Session is not live, the Host answers `not-live`, and the panel shows that status; no estimate is rendered.

Failures are explicit instead of a permanent spinner: `missing-key`, `unauthorized`, `network`, `timeout`, `no-wallet`, and `not-live` each render their own label in the panel, while the pill stays compact.

## Behaviour

- The pill is a `conversation.composer.dock` entry with id `session-cost` and order `2`, so it follows the built-in `activity` (0) and `usage` (1) pills and precedes the context meter. A new id only adds a control; it does not replace either built-in pill.
- The pill appears together with the built-in statistics: nothing until the Session has produced tokens, and nothing while this Session's own cost is still in flight.
- An exact cost renders as `¥2.30`; when the official price table cannot be read, the pill shows `—` and the panel names the reason.
- The pill never ellipsizes: it keeps its intrinsic width (`flex: none`), so the balance stays fully readable beside the other statistics.
- Interface copy follows the DSH language (zh/en); styling uses only `--dsw-*` theme tokens.
- If another client module already holds the `session-cost` slot id (for example a stale copy left by a package rename), this module skips its own registration and logs a warning instead of failing the page sync; restart the app to clear the stale copy.

## Updating the Client half

`npm run build` bundles `src/index.js` to `lib/index.js` and `src/client/index.js` (with its modules and stylesheet) to `lib/client.js`. The Host half reloads through a profile recomposition (enable/disable the row). The browser keeps the bundle generation it already loaded, so after a rebuild refresh the page; if the old pill survives the refresh, restart the application — a restart republishes every bundle revision.

## File layout

| File | Purpose |
| --- | --- |
| `cordis.patch.yml` | Inserts the bundle row. |
| `src/index.js` | Host half: pricing service wiring, balance request, both routes, Session selection fallback. |
| `src/pricing.js` | Official price-page parser, refresh policy, Search/Fetch prices. |
| `src/cost.js` | Pure cost fold, model resolution, price windows, Web request units. |
| `src/balance.js` | Pure balance parsing and endpoint normalization. |
| `src/client/index.js` | Pill, panel, slot registration. |
| `src/client/i18n.js` | Chinese/English UI dictionaries and the locale-service binding. |
| `src/client/store.js` | Browser state reader for the balance and the Session cost. |
| `src/client/format.js` | Money, count, and currency formatting. |
| `src/client/style.css` | Client styles, imported as text by the build. |
| `locale/{en,zh}.json` | Plugin Manager title and description; the zh detail uses `README.zh.md`, en defaults to `README.md`. |
| `icon.svg` | Plugin row icon. |
| `LICENSE` | MIT License. |
| `lib/` | Build output (`lib/index.js`, `lib/client.js`); created by `npm run build`, not committed. |

## Verification

- `npm run build` bundles both halves; `npm test` rebuilds and covers the parser, refresh policy, cost fold, model resolution, price windows, Web request units, balance helpers, locale dictionary parity, and the client loader contract (`lib/client.js` id, factory, `apply`/`inject`).
- `GET /plugin/session-cost/state?session=<id>` returns `{ balance, cost }`; `cost.total` equals an independent `foldCost` of the same Session log.
- A live fetch of the official price page should yield Flash hit 0.02/0.04, miss 1/2, output 4/8; Pro hit 0.15/0.3, miss 4.5/9, output 13.5/27; Search/Fetch 0.005 per request.
- `cordis_inspect_query` → Client `Slots.listSubTree` with root `conversation.composer.dock` reports the `session-cost` occupant while a Session is open.
- Visual confirmation of the rendered pill needs the connected page; opening the panel should trigger a new state read.
