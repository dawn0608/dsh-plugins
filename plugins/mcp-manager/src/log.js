/** Minimal structured logging that never receives user values. */

import { redactForLog } from './shared/references.js';

const SAFE_FIELDS = new Set(['action', 'name', 'id', 'code', 'field', 'transport', 'enabled', 'durationMs', 'count']);

/** Write one line carrying only allowlisted, non-value fields. */
export function logEvent(event, fields = {}) {
  const safe = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELDS.has(key) || value === undefined) continue;
    if (typeof value === 'string') safe[key] = redactForLog(value).slice(0, 120);
    else if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
  }
  try {
    console.info(`[mcp-manager] ${JSON.stringify(safe)}`);
  } catch {
    // Logging must never break a request.
  }
}
