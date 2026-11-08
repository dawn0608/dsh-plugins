/**
 * Pure cost fold for the cost-overview plugin.
 *
 * The host folds the durable Session log one logged model call at a time:
 * provider-reported tokens × the official unit price of that call's model and
 * price window. Keeping the fold free of Cordis state makes it directly
 * testable and keeps the price table owned by `apply()`.
 */

/** Model id whose price row is used when a route cannot be mapped to a known row. */
export const DEFAULT_MODEL = 'deepseek-flash';

/**
 * Resolve a logged model id to its published price row.
 *
 * Only DeepSeek ids enter the known mapping. A foreign or otherwise unknown id
 * keeps its own row and real name, but is priced with the Flash table so the
 * total is never silently dropped; `unknown` lets the payload report it.
 *
 * @param modelId - the model id recorded on the call.
 * @param table - the parsed official price table.
 * @returns the price row and display identity for the call.
 */
export function resolveModel(modelId, table) {
  const raw = String(modelId || '');
  const id = raw.toLowerCase();
  const leaf = id.slice(id.lastIndexOf('/') + 1);
  const deepseekId = leaf === 'deepseek' || leaf.startsWith('deepseek-');
  const known = !deepseekId
    ? undefined
    : leaf.includes('pro')
      ? 'deepseek-v4-pro'
      : (leaf.includes('flash') || leaf.includes('chat') || leaf.includes('reasoner') ? DEFAULT_MODEL : undefined);

  if (known === undefined) {
    const fallback = table[DEFAULT_MODEL];
    return {
      key: raw === '' ? 'unknown' : raw,
      label: raw === '' ? '' : raw,
      hit: fallback.hit,
      miss: fallback.miss,
      output: fallback.output,
      unknown: true,
    };
  }

  const entry = table[known] || table[DEFAULT_MODEL];
  return {
    key: known,
    label: entry.label,
    hit: entry.hit,
    miss: entry.miss,
    output: entry.output,
    unknown: false,
  };
}

/**
 * Peak window: Beijing time, Monday–Friday, 09:00–12:00 and 14:00–18:00.
 * Statutory holidays cannot be detected offline, so their weekday hours are
 * priced at the peak rate — an overestimate against the bill, never an undercount.
 *
 * @param timeMs - the logged event time.
 * @returns whether the call is priced at the peak rate.
 */
export function isPeak(timeMs) {
  const shifted = new Date((Number(timeMs) || 0) + 8 * 60 * 60 * 1000);
  const day = shifted.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080);
}

/**
 * The provider usage reported by a recorded stream, when present.
 *
 * @param stream - the compact recorded attempt stream.
 * @returns the last usage chunk's usage object, or undefined.
 */
export function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record !== null && typeof record === 'object' && record.type === 'chunk'
      && record.chunk !== null && typeof record.chunk === 'object' && record.chunk.type === 'usage') {
      return record.chunk.usage;
    }
  }
  return undefined;
}

/**
 * Billable Search requests of one web tool call.
 *
 * `dsh-tool-web` validates and de-duplicates `queries` before issuing one
 * Search request per unique query, so the unit count must follow that set.
 * One web_fetch is one Fetch request; a malformed argument string still bills
 * one request.
 *
 * @param name - the tool name.
 * @param args - the JSON argument string recorded with the call.
 * @returns the number of billable requests.
 */
export function searchUnits(name, args) {
  if (name !== 'web_search') return 1;
  try {
    const parsed = JSON.parse(args);
    if (parsed && Array.isArray(parsed.queries) && parsed.queries.length > 0) {
      return new Set(parsed.queries).size;
    }
  } catch (error) {
    // A malformed argument string still bills one request.
  }
  return 1;
}

/**
 * Price one Session from its durable log, one logged model call at a time.
 *
 * @param events - the Session's durable events, in order.
 * @param table - the parsed official price table.
 * @param toolPrices - Search and Fetch unit prices in CNY per request.
 * @returns the Session's cost totals and per-model rows.
 */
export function foldCost(events, table, toolPrices) {
  if (table === null || typeof table !== 'object') {
    throw new TypeError('cost-overview: a parsed price table is required');
  }
  const prices = toolPrices === null || typeof toolPrices !== 'object' ? {} : toolPrices;
  const priceOf = name => {
    const value = name === 'web_fetch' ? prices.fetch : prices.search;
    return Number.isFinite(value) ? value : 0;
  };

  const models = new Map();
  const pendingCalls = new Map();
  const unknownModels = new Set();
  let modelCost = 0;
  let toolCost = 0;
  let toolRequests = 0;
  let calls = 0;

  /** Price one provider-reported call and fold it into the Session totals. */
  const bill = (modelId, usage, time) => {
    if (usage === null || typeof usage !== 'object') return;
    const resolved = resolveModel(modelId, table);
    if (resolved.unknown) unknownModels.add(String(modelId || ''));

    const peak = isPeak(time);
    const index = peak ? 1 : 0;
    const uncached = count(usage.inputTokens);
    const cacheRead = count(usage.cacheReadTokens);
    const cacheWrite = count(usage.cacheWriteTokens);
    const output = count(usage.outputTokens);
    const amount = (uncached * resolved.miss[index]
      + cacheRead * resolved.hit[index]
      + cacheWrite * resolved.miss[index]
      + output * resolved.output[index]) / 1e6;

    modelCost += amount;
    calls += 1;
    const entry = models.get(resolved.key) || {
      key: resolved.key,
      label: resolved.label,
      prices: { hit: resolved.hit, miss: resolved.miss, output: resolved.output },
      calls: 0,
      cost: 0,
      peakCost: 0,
      offpeakCost: 0,
      tokens: { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    };
    entry.calls += 1;
    entry.cost += amount;
    if (peak) entry.peakCost += amount;
    else entry.offpeakCost += amount;
    entry.tokens.uncached += uncached;
    entry.tokens.cacheRead += cacheRead;
    entry.tokens.cacheWrite += cacheWrite;
    entry.tokens.output += output;
    models.set(resolved.key, entry);
  };

  // The model a request series runs on: logged headers carry it, and a
  // settled message refreshes it. Retired attempts have no route of their own.
  let route;

  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;

    if (event.type === 'request/header') {
      const config = event.data && event.data.header && event.data.header.config;
      if (config && typeof config.model === 'string' && config.model !== '') {
        route = { provider: String(config.provider || ''), model: config.model };
      }
      continue;
    }

    if (event.type === 'tool/call') {
      const data = event.data || {};
      const name = data.name;
      if (name !== 'web_search' && name !== 'web_fetch') continue;
      pendingCalls.set(data.callId, { name, units: searchUnits(name, data.arguments) });
      continue;
    }

    if (event.type === 'tool/result') {
      const message = (event.data && event.data.message) || {};
      const call = pendingCalls.get(message.toolCallId);
      if (call === undefined) continue;
      pendingCalls.delete(message.toolCallId);
      if (message.isError === true || event.data?.error) continue;
      toolRequests += call.units;
      toolCost += call.units * priceOf(call.name);
      continue;
    }

    // A retired attempt (retry, failure, interruption) is billed too, and its
    // usage lives in the recorded stream rather than in a settled message.
    if (event.type === 'assistant/attempt') {
      const usage = streamUsage(event.data && event.data.stream);
      if (usage !== undefined && route !== undefined) bill(route.model, usage, event.time);
      continue;
    }

    // Compaction is a separate model call; its summary carries its own usage.
    if (event.type === 'compaction/summary') {
      const data = event.data || {};
      if (data.usage !== undefined && typeof data.model === 'string' && data.model !== '') {
        bill(data.model, data.usage, event.time);
      }
      continue;
    }

    if (event.type !== 'assistant/message') continue;

    const data = event.data || {};
    const source = (data.message && data.message.source) || {};
    const sourceModel = typeof source.model === 'string' && source.model !== '' ? source.model : undefined;
    if (sourceModel !== undefined) {
      route = { provider: String(source.provider || ''), model: sourceModel };
    }
    bill(sourceModel !== undefined ? sourceModel : (route === undefined ? undefined : route.model), data.usage, event.time);
  }

  return {
    total: modelCost + toolCost,
    modelCost,
    toolCost,
    toolRequests,
    calls,
    models: [...models.values()],
    unknownModels: [...unknownModels],
  };
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
