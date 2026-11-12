/**
 * Remove credential-looking text from a log line.
 * Best effort: this is a last-resort guard, not the primary policy of never
 * passing values to the logger at all.
 */
export function redactForLog(text) {
  return String(text)
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*([^\r\n"']+)/gi, '$1: ***')
    .replace(/\b([A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH)[A-Za-z0-9_]*\s*[:=]\s*)("?)([^"\s,}]+)/gi, '$1***')
    .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 ***')
    .replace(/\b(?:sk-|ghp_|gho_|ghu_|xox[baprs]-|npm_|glpat-)[A-Za-z0-9_-]{8,}/g, '***');
}
