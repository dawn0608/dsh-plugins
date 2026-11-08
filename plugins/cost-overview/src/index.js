/**
 * Host half of the cost-overview bundle.
 *
 * Two facts shape this half:
 *
 * 1. DeepSeek publishes prices, not a bill. `GET /user/balance` reports the
 *    account's money, and there is no per-session billing endpoint, so the
 *    Session's cost is reconstructed exactly the way the bill is formed:
 *    `tokens × published unit price`, once per logged model call, at the price
 *    window (peak/off-peak) of that call's own time.
 * 2. The browser cannot read the balance itself: the key lives with the Host.
 *
 * The result is served on two routes with one payload, so the Client can fall
 * back from one to the other:
 *
 * - `/plugin/cost-overview/state` — a plain Web route; and
 * - `/api/cost-overview/state` — an exact Fetch route on the connection's shared
 *   channel, for a shell-owned carrier without a document origin.
 */
import { DOCS_URL, MODEL_LABELS, TOOL_PRICE_FALLBACK, parsePricing, pricingTtl } from './pricing.js';
import { foldCost } from './cost.js';
import { normalizeBase, walletsOf } from './balance.js';

const PLAIN_PATH = '/plugin/cost-overview/state';
const CHANNEL_PATH = '/api/cost-overview/state';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY';
const USER_AGENT = 'dsh-cost-overview/1.0.1';
const REQUEST_TIMEOUT_MS = 8000;
/** Balance is account state, not a live feed: one upstream read per minute at most. */
const SUCCESS_CACHE_MS = 60000;
const FAILURE_CACHE_MS = 60000;
const CONFIG_CACHE_MS = 30000;

export const inject = ['webServer', 'connection'];

export function apply(ctx) {
  /** The only price table in play: `table` stays undefined until the page parses. */
  let pricing = {
    table: undefined,
    toolPrices: { search: TOOL_PRICE_FALLBACK, fetch: TOOL_PRICE_FALLBACK },
    at: 0,
    error: undefined,
  };
  let pricingAttemptAt = 0;
  let pricingInflight;
  let cachedConfig;
  let cachedBalance;
  let balanceInflight;

  /**
   * Re-read the published table at most once a day; a bad parse keeps the old
   * one. Returns the shared in-flight attempt, or undefined while it is throttled.
   */
  function refreshPricing() {
    if (pricingInflight !== undefined) return pricingInflight;
    const now = Date.now();
    const ttl = pricingTtl(pricing);
    if (now - pricingAttemptAt < ttl) return undefined;
    pricingAttemptAt = now;
    pricingInflight = readPricingPage()
      .then(parsed => {
        if (parsed === undefined) {
          pricing = { ...pricing, error: 'parse' };
          return;
        }
        pricing = {
          table: parsed.table,
          toolPrices: parsed.toolPrices !== undefined
            ? parsed.toolPrices
            : { search: TOOL_PRICE_FALLBACK, fetch: TOOL_PRICE_FALLBACK },
          at: Date.now(),
          error: undefined,
        };
      })
      .catch(error => {
        pricing = { ...pricing, error: error && error.name === 'AbortError' ? 'timeout' : 'network' };
      })
      .finally(() => {
        pricingInflight = undefined;
      });
    return pricingInflight;
  }

  /** Read the DeepSeek route's own `apiKeyEnv` and `baseURL` from live settings. */
  async function resolveConfig() {
    if (cachedConfig !== undefined && Date.now() - cachedConfig.at < CONFIG_CACHE_MS) {
      return cachedConfig.value;
    }
    let apiKeyEnv = process.env.COST_OVERVIEW_API_KEY_ENV || DEFAULT_API_KEY_ENV;
    let baseURL = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
    try {
      const settings = ctx.get('settings');
      const list = settings && typeof settings.describe === 'function'
        ? settings.describe({ redactSecrets: true })
        : [];
      const entries = Array.isArray(list) ? list : [];
      const exact = entries.find(entry => String(entry.ns) === 'llm-deepseek');
      const fallback = entries.find(entry => /^llm-deepseek(?:$|-api-key$)/.test(String(entry.ns)));
      const value = (exact || fallback || {}).value;
      if (value && typeof value.apiKeyEnv === 'string' && value.apiKeyEnv !== '') apiKeyEnv = value.apiKeyEnv;
      if (value && typeof value.baseURL === 'string' && value.baseURL !== '') baseURL = value.baseURL;
    } catch (error) {
      // Settings are optional here: the defaults still resolve an environment key.
    }
    const value = { apiKeyEnv, baseURL: normalizeBase(baseURL, DEFAULT_BASE_URL) };
    cachedConfig = { at: Date.now(), value };
    return value;
  }

  /** Resolve the key where the model route resolves it, then from the launch environment. */
  async function resolveKey(apiKeyEnv) {
    try {
      const credentials = ctx.get('credentials');
      if (credentials && typeof credentials.resolve === 'function') {
        const resolved = await credentials.resolve(apiKeyEnv);
        if (resolved && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value;
      }
    } catch (error) {
      // Fall through to the launch environment.
    }
    const ambient = process.env[apiKeyEnv];
    return typeof ambient === 'string' && ambient !== '' ? ambient : undefined;
  }

  async function readBalance() {
    const config = await resolveConfig();
    const apiKey = await resolveKey(config.apiKeyEnv);
    if (apiKey === undefined) {
      return { ok: false, reason: 'missing-key', apiKeyEnv: config.apiKeyEnv, baseURL: config.baseURL };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${config.baseURL}/user/balance`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return { ok: false, reason: 'unauthorized' };
      if (!response.ok) return { ok: false, reason: `http-${response.status}` };
      const body = await response.json();
      const wallets = walletsOf(body);
      if (wallets.length === 0) return { ok: false, reason: 'no-wallet' };
      return {
        ok: true,
        available: body !== null && typeof body === 'object' && body.is_available === true,
        wallets,
        fetchedAt: Date.now(),
      };
    } catch (error) {
      return { ok: false, reason: error && error.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function balance() {
    const now = Date.now();
    if (cachedBalance !== undefined) {
      const ttl = cachedBalance.value.ok === true ? SUCCESS_CACHE_MS : FAILURE_CACHE_MS;
      if (now - cachedBalance.at < ttl) return cachedBalance.value;
    }
    if (balanceInflight !== undefined) return balanceInflight;
    balanceInflight = readBalance()
      .then(value => {
        cachedBalance = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        balanceInflight = undefined;
      });
    return balanceInflight;
  }

  /** Session folds keyed by the log offset they were computed at. */
  const costCache = new Map();

  /**
   * The Session's current model before its first call: the durable selection
   * projection, then the Host default. `undefined` when neither exists.
   */
  function selectionOf(session) {
    try {
      const projections = ctx.get('sessionProjections');
      if (projections && typeof projections.stateOf === 'function') {
        const state = projections.stateOf(session, 'modelSelection');
        const chosen = state === undefined || state === null ? undefined : (state.pending || state.lastUsed);
        if (chosen && typeof chosen.model === 'string' && chosen.model !== '') {
          return { provider: String(chosen.provider || ''), model: chosen.model };
        }
      }
    } catch (error) {
      // No projection registry: fall through to the Host default.
    }
    try {
      const defaults = ctx.get('agentDefaultModel');
      const value = defaults && typeof defaults.currentSelection === 'function'
        ? defaults.currentSelection()
        : undefined;
      if (value && typeof value.model === 'string' && value.model !== '') {
        return { provider: String(value.provider || ''), model: value.model };
      }
    } catch (error) {
      // This composition has no default selection.
    }
    return undefined;
  }

  /** Price one Session from its durable log, one logged model call at a time. */
  function costOf(sessionId) {
    if (pricing.table === undefined) {
      return { ok: false, reason: pricing.error === undefined ? 'price-pending' : 'price-failed' };
    }
    const sessions = ctx.get('sessions');
    const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined;
    if (session === undefined) return { ok: false, reason: 'not-live' };

    const cached = costCache.get(sessionId);
    if (cached !== undefined && cached.seq === session.seq && cached.pricedAt === pricing.at) return cached.value;

    const folded = foldCost(session.snapshotEvents(), pricing.table, pricing.toolPrices);
    const selection = folded.models.length === 0 ? selectionOf(session) : undefined;
    const value = {
      ok: true,
      currency: 'CNY',
      ...folded,
      selection: selection === undefined ? null : {
        ...selection,
        label: MODEL_LABELS[selection.model] !== undefined ? MODEL_LABELS[selection.model] : selection.model,
      },
      asOf: Date.now(),
    };
    costCache.set(sessionId, { seq: session.seq, pricedAt: pricing.at, value });
    if (costCache.size > 16) {
      const oldest = costCache.keys().next();
      if (oldest.done !== true) costCache.delete(oldest.value);
    }
    return value;
  }

  async function state(sessionId) {
    const balancePromise = balance();
    if (pricing.table === undefined) {
      // The first read must complete before a number can exist, so wait for it.
      await refreshPricing();
    } else {
      refreshPricing();
    }
    const balanceValue = await balancePromise;
    const costValue = sessionId ? costOf(sessionId) : { ok: false, reason: 'no-session' };
    return {
      balance: balanceValue,
      cost: costValue,
      pricing: {
        loaded: pricing.table !== undefined,
        at: pricing.at,
        error: pricing.error,
        url: DOCS_URL,
      },
      fetchedAt: Date.now(),
    };
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PLAIN_PATH,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        respond(response, 405, { ok: false, reason: 'method' }, request.method === 'HEAD');
        return;
      }
      const url = new URL(request.url || PLAIN_PATH, 'http://localhost');
      let value;
      try {
        value = await state(url.searchParams.get('session'));
      } catch (error) {
        value = {
          balance: { ok: false, reason: 'failed' },
          cost: { ok: false, reason: 'failed' },
          error: String((error && error.message) || error),
        };
      }
      respond(response, 200, value, request.method === 'HEAD');
    },
  }), 'cost-overview: state route');

  ctx.effect(() => ctx.connection.fetch.register({
    path: CHANNEL_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async request => {
      const url = new URL(request.url);
      return new Response(request.method === 'HEAD'
        ? null
        : JSON.stringify(await state(url.searchParams.get('session'))), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    },
  }), 'cost-overview: channel state route');
}

/** Fetch and parse the official pricing page; `undefined` when it is unusable. */
async function readPricingPage() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(DOCS_URL, {
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return parsePricing(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

function respond(response, status, body, headOnly) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  response.end(headOnly ? undefined : text);
}

