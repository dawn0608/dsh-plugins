/**
 * Official pricing for the cost-overview plugin.
 *
 * The plugin prices Sessions with the table published at `DOCS_URL` and nothing
 * else: no built-in model price copy and no local override, so a figure can only
 * be the official one. The page is re-read at most once a day; when it cannot be
 * read, the last official table (if any) stays in force and the Host state
 * payload reports the failure. Before any successful read there is no price at
 * all, and the panel says so instead of showing a number.
 */

export const DOCS_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';

/** Model ids the price rows are read for, with the labels the panel shows. */
export const MODEL_LABELS = {
  'deepseek-flash': 'DeepSeek-V4.1-Flash',
  'deepseek-v4-pro': 'DeepSeek-V4-Pro',
};

/**
 * Last-resort Search/Fetch unit price, used only when a readable page omits its
 * own Search/Fetch rows. The model prices never fall back like this.
 */
export const TOOL_PRICE_FALLBACK = 5 / 1000;

/** Re-read the official pricing page at most this often after a successful read. */
export const PRICING_TTL_MS = 24 * 60 * 60 * 1000;
/** Retry an unreadable page, or a failed refresh, sooner than a whole day. */
export const PRICING_RETRY_MS = 60 * 1000;

const MODEL_IDS = Object.keys(MODEL_LABELS);
const METRICS = ['hit', 'miss', 'output'];

/**
 * Throttle window for the next pricing read.
 *
 * A missing table means no successful read has happened yet; an error means
 * the latest attempt failed, even when an older table is still in force. Both
 * must retry quickly instead of waiting a whole day.
 *
 * @param at - time of the last successful read, or 0.
 * @param error - the latest failure marker, if any.
 * @returns the retry window in milliseconds.
 */
export function pricingTtl({ at, error }) {
  return at === 0 || error !== undefined ? PRICING_RETRY_MS : PRICING_TTL_MS;
}

/**
 * Parse the official pricing page.
 *
 * The page renders one table whose price rows carry a metric cell
 * (`百万tokens输入（缓存命中）` …) and then one row per window (`空闲时段`,
 * `高峰时段`) with one cell per model. The metric cell is absent from the
 * second window row, so it is carried forward.
 *
 * Model columns are read from the header row rather than assumed to be the
 * first two: the page may reorder them or add another model, and reading a
 * fixed column would silently map another model's price onto Flash or Pro.
 * A window row whose numeric cell count differs from the header's model count
 * is ignored, so a changed layout fails closed instead of mispricing.
 *
 * Rejects the parse unless all six prices exist, are plausible, and every peak
 * value is exactly twice its off-peak counterpart — the page states that rule,
 * so a mismatch means the layout or the scheme changed and the previous table
 * should stay in force.
 *
 * @param html - the page body.
 * @returns the parsed table and Search/Fetch prices, or `undefined` when the
 *   page is not recognizable.
 */
export function parsePricing(html) {
  const rows = [...String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => cellsOf(match[1]));
  if (rows.length === 0) return undefined;

  const header = rows.find(cells => cells.some(cell => /deepseek-flash/i.test(cell))
    && cells.some(cell => /deepseek-v4-pro/i.test(cell)));
  if (header === undefined) return undefined;

  // The first header cell is the row label (`模型`); every following cell is a
  // model column. Map known model ids to their actual column position so a
  // reordered or extended table still yields the right price for each model.
  const modelColumns = header.slice(1);
  if (modelColumns.length < MODEL_IDS.length) return undefined;
  const columnOf = new Map();
  for (const id of MODEL_IDS) {
    const index = modelColumns.findIndex(cell => cell.toLowerCase().includes(id));
    if (index < 0 || [...columnOf.values()].includes(index)) return undefined;
    columnOf.set(id, index);
  }

  const found = {};
  let metric;
  for (const cells of rows) {
    const text = cells.join(' ');
    if (/百万\s*tokens/i.test(text) || /缓存未命中|缓存命中|百万tokens输出|输出/.test(text)) {
      if (/缓存未命中/.test(text)) metric = 'miss';
      else if (/缓存命中/.test(text)) metric = 'hit';
      else if (/输出/.test(text)) metric = 'output';
    }
    if (metric === undefined) continue;
    const window = /空闲/.test(text) ? 0 : /高峰/.test(text) ? 1 : undefined;
    if (window === undefined) continue;
    const numbers = cells.filter(cell => /^\d+(?:\.\d+)?\s*元?$/.test(cell)).map(cell => Number.parseFloat(cell));
    if (numbers.length !== modelColumns.length) continue;
    const slots = found[metric] || (found[metric] = []);
    slots[window] = numbers;
  }

  for (const metricName of METRICS) {
    const pairs = found[metricName];
    if (!Array.isArray(pairs) || pairs[0] === undefined || pairs[1] === undefined) return undefined;
    for (const numbers of pairs) {
      if (numbers.length !== modelColumns.length) return undefined;
      if (numbers.some(value => !Number.isFinite(value) || value <= 0 || value > 10000)) return undefined;
    }
  }
  for (const metricName of METRICS) {
    const offpeak = found[metricName][0];
    const peak = found[metricName][1];
    for (let index = 0; index < modelColumns.length; index += 1) {
      if (Math.abs(peak[index] - offpeak[index] * 2) > Math.max(1e-9, offpeak[index] * 0.01)) return undefined;
    }
  }

  const table = {};
  for (const id of MODEL_IDS) {
    const column = columnOf.get(id);
    table[id] = {
      label: MODEL_LABELS[id],
      hit: [found.hit[0][column], found.hit[1][column]],
      miss: [found.miss[0][column], found.miss[1][column]],
      output: [found.output[0][column], found.output[1][column]],
    };
  }

  return { table, toolPrices: parseToolPrices(rows) };
}

/**
 * Read the Search/Fetch per-request prices when the page states them.
 *
 * Search and Fetch share a row today, but pricing them independently means a
 * future split is honored instead of applying the last number to both.
 *
 * @param rows - the table rows.
 * @returns one unit price per request, or `undefined` when no row is readable.
 */
function parseToolPrices(rows) {
  const found = {};
  for (const cells of rows) {
    const text = cells.join(' ');
    if (!/每\s*1[,\s]?000\s*次成功请求/.test(text)) continue;
    const numbers = cells.filter(cell => /^\d+(?:\.\d+)?\s*元?$/.test(cell)).map(cell => Number.parseFloat(cell));
    if (numbers.length === 0) continue;
    const yuan = numbers[numbers.length - 1];
    if (!Number.isFinite(yuan) || yuan <= 0 || yuan >= 1000) continue;
    const value = yuan / 1000;
    if (/search/i.test(text)) found.search = value;
    else if (/fetch/i.test(text)) found.fetch = value;
    else if (found.search === undefined && found.fetch === undefined) {
      // A combined "Search and Fetch" row states one shared price.
      found.search = value;
      found.fetch = value;
    }
  }
  if (found.search === undefined && found.fetch === undefined) return undefined;
  return {
    search: found.search === undefined ? found.fetch : found.search,
    fetch: found.fetch === undefined ? found.search : found.fetch,
  };
}

/** Split one `<tr>` into decoded, tag-free cell text. */
function cellsOf(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
    .map(match => decodeEntities(match[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim());
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, '&');
}
