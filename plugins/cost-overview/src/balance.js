/**
 * Pure balance helpers for the cost-overview plugin.
 *
 * The account balance route and the config fallback are kept separate from the
 * Cordis service so they can be exercised without a running Host.
 */

/**
 * Accept a configured endpoint that names a protocol sub-path.
 *
 * The DeepSeek API-key route defaults to `https://api.deepseek.com/anthropic`
 * and may be configured with a trailing `/v1`; the account endpoint lives at
 * the origin. Strip every trailing protocol suffix, in any order.
 *
 * @param value - configured base URL.
 * @param fallback - URL to use when the value is empty.
 * @returns the origin-level base URL.
 */
export function normalizeBase(value, fallback) {
  let base = String(value || fallback).trim().replace(/\/+$/, '');
  for (;;) {
    const next = base.replace(/\/(?:anthropic|v1)$/i, '');
    if (next === base) break;
    base = next;
  }
  return base === '' ? fallback : base;
}

/**
 * Normalize the `/user/balance` wallets.
 *
 * @param body - the parsed balance response.
 * @returns one detached wallet per reported currency.
 */
export function walletsOf(body) {
  const infos = body !== null && typeof body === 'object' && Array.isArray(body.balance_infos)
    ? body.balance_infos
    : [];
  return infos.map(info => ({
    currency: info !== null && typeof info === 'object' && typeof info.currency === 'string' ? info.currency : 'CNY',
    total: numeric(info && info.total_balance),
    toppedUp: numeric(info && (info.top_up_balance !== undefined ? info.top_up_balance : info.topped_up_balance)),
    granted: numeric(info && info.granted_balance),
  }));
}

/**
 * Parse one API money field.
 *
 * @param value - a number or decimal string.
 * @returns the finite number, or 0.
 */
export function numeric(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
