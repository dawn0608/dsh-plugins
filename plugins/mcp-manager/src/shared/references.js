/**
 * Credential references and redaction, shared by the Host and the browser half.
 *
 * The Harness Loader evaluates `!!js` scalars in a plugin row's `config`, so a
 * secret can stay out of the profile patch: an environment variable reference
 * is stored as `!!js process.env.NAME` (or a template literal for HTTP headers)
 * and evaluated when the MCP client row activates.
 */

/** `serverName` contract of `@deepseek-ai/dsh-mcp-client`. */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
/** POSIX shell identifier: the shape a Harness credential reference and an env name share. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** RFC 7230 token: the only header names MCP transports accept. */
export const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Names the three-end synchronizer reserves for its own local configuration. */
export const RESERVED_NAMES = ['node_repl'];

const SENSITIVE_KEY = /token|key|secret|password|passwd|authorization|auth|credential|cookie/i;

/** Whether a value under this key must stay out of the read API, UI and logs. */
export function isSensitiveKey(key) {
  return typeof key === 'string' && SENSITIVE_KEY.test(key);
}

/** Whether a raw config value is an inert `!!js` marker produced by the patch parser. */
export function isExpression(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.__jsExpr === 'string';
}

/**
 * Recognize the two reference shapes this plugin writes.
 * @returns {{variable: string, prefix: string} | null}
 */
export function matchReference(expression) {
  if (typeof expression !== 'string') return null;
  const source = expression.trim();
  const plain = /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(source);
  if (plain) return { variable: plain[1], prefix: '' };
  const template = /^`([\s\S]*)`$/.exec(source);
  if (!template) return null;
  const inner = template[1];
  const hit = /\$\{process\.env\.([A-Za-z_][A-Za-z0-9_]*)\}/.exec(inner);
  if (!hit) return null;
  const before = inner.slice(0, hit.index);
  const after = inner.slice(hit.index + hit[0].length);
  if (after !== '' || before.includes('${') || before.includes('`')) return null;
  return { variable: hit[1], prefix: before };
}

/** The `!!js` expression written for one reference. */
export function referenceExpression({ variable, prefix }) {
  if (!prefix) return `process.env.${variable}`;
  return `\`${prefix}\${process.env.${variable}}\``;
}

/**
 * Describe a stored config value for the API without ever returning a secret.
 * @returns {{mode: 'literal'|'ref'|'expr', value?: string, variable?: string, prefix?: string, secret?: boolean, configured?: boolean}}
 */
export function describeValue(key, value) {
  if (isExpression(value)) {
    const reference = matchReference(value.__jsExpr);
    if (reference) return { mode: 'ref', variable: reference.variable, prefix: reference.prefix };
    return { mode: 'expr', configured: true, secret: true };
  }
  if (typeof value === 'string') {
    if (isSensitiveKey(key)) return { mode: 'literal', secret: true, configured: true };
    return { mode: 'literal', value, secret: false };
  }
  return { mode: 'literal', configured: false, secret: false };
}

/** Escape one YAML single-quoted scalar. */
export function quoteSingle(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Escape one YAML double-quoted scalar. */
export function quoteDouble(value) {
  return JSON.stringify(String(value));
}

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
