/**
 * Draft normalization and validation, shared by the Host and the browser half.
 *
 * The Host is authoritative; the browser runs the same rules for immediate
 * field feedback. Errors carry a field path and a stable code so the browser
 * can localize them and the Host never has to return user values.
 */

import { ENV_NAME, HEADER_NAME, RESERVED_NAMES, SERVER_NAME } from './references.js';

const MAX_ENTRIES = 64;
const MAX_ARGS = 128;
const MAX_VALUE_LENGTH = 8192;

function text(value) {
  return typeof value === 'string' ? value : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function error(field, code, params) {
  return params === undefined ? { field, code } : { field, code, params };
}

/** Trimmed strings only; anything else becomes an empty string. */
function trimmed(value) {
  return text(value).trim();
}

function bounded(value) {
  return text(value).length <= MAX_VALUE_LENGTH;
}

function normalizePair(entry) {
  const item = entry && typeof entry === 'object' ? entry : {};
  return {
    key: trimmed(item.key),
    mode: item.mode === 'ref' ? 'ref' : item.mode === 'keep' ? 'keep' : item.mode === 'expr' ? 'expr' : 'literal',
    value: text(item.value),
    variable: trimmed(item.variable),
    prefix: text(item.prefix),
  };
}

/** Canonical draft shape; leaves every decision to `validateDraft`. */
export function normalizeDraft(input) {
  const draft = input && typeof input === 'object' ? input : {};
  const transport = draft.transport === 'streamable-http'
    ? 'streamable-http'
    : draft.transport === 'stdio' || draft.transport === undefined ? 'stdio' : 'invalid';
  return {
    name: trimmed(draft.name),
    transport,
    enabled: draft.enabled !== false,
    command: trimmed(draft.command),
    args: list(draft.args).map(text),
    cwd: text(draft.cwd),
    env: list(draft.env).slice(0, MAX_ENTRIES).map(normalizePair),
    url: trimmed(draft.url),
    headers: list(draft.headers).slice(0, MAX_ENTRIES).map(normalizePair),
  };
}

/** A blank draft for one transport. */
export function emptyDraft(transport = 'stdio') {
  return normalizeDraft({ transport });
}

function validatePairs(pairs, kind, errors, existingKeys) {
  const label = kind === 'env' ? 'env' : 'headers';
  const nameRule = kind === 'env' ? ENV_NAME : HEADER_NAME;
  const nameCode = kind === 'env' ? 'env-name-invalid' : 'header-name-invalid';
  const seen = new Set();
  pairs.forEach((pair, index) => {
    const at = `${label}[${index}]`;
    if (pair.key === '') {
      errors.push(error(`${at}.key`, 'required'));
    } else if (!nameRule.test(pair.key)) {
      errors.push(error(`${at}.key`, nameCode));
    } else if (seen.has(pair.key)) {
      errors.push(error(`${at}.key`, 'duplicate', { name: pair.key }));
    } else {
      seen.add(pair.key);
    }

    if (pair.mode === 'expr') {
      errors.push(error(`${at}.value`, 'value-invalid'));
      return;
    }
    if (pair.mode === 'keep') {
      if (!existingKeys.has(pair.key)) errors.push(error(`${at}.value`, 'keep-unavailable'));
      return;
    }
    if (pair.mode === 'ref') {
      if (pair.variable === '') {
        errors.push(error(`${at}.value`, 'required'));
      } else if (!ENV_NAME.test(pair.variable)) {
        errors.push(error(`${at}.value`, 'ref-variable-invalid'));
      }
      if (kind === 'env') {
        if (pair.prefix !== '') errors.push(error(`${at}.value`, 'ref-prefix-invalid'));
      } else if (/[\0\r\n`]/.test(pair.prefix) || pair.prefix.includes('${')) {
        errors.push(error(`${at}.value`, 'ref-prefix-invalid'));
      }
      if (!bounded(pair.variable) || !bounded(pair.prefix)) errors.push(error(`${at}.value`, 'value-invalid'));
      return;
    }
    if (/[\0\r\n]/.test(pair.value) || !bounded(pair.value)) {
      errors.push(error(`${at}.value`, 'value-invalid'));
    }
  });
}

function validateUrl(raw, errors) {
  if (raw === '') {
    errors.push(error('url', 'required'));
    return;
  }
  if (/\s/.test(raw)) {
    errors.push(error('url', 'url-invalid'));
    return;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    errors.push(error('url', 'url-invalid'));
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    errors.push(error('url', 'url-invalid'));
    return;
  }
  if (!parsed.hostname) {
    errors.push(error('url', 'url-invalid'));
    return;
  }
  if (parsed.username !== '' || parsed.password !== '') errors.push(error('url', 'url-invalid'));
}

/**
 * @param {unknown} input raw draft
 * @param {{names?: string[], selfName?: string, existingEnvKeys?: string[], existingHeaderKeys?: string[]}} context
 * @returns {{ draft: ReturnType<typeof normalizeDraft>, errors: Array<{field: string, code: string, params?: object}> }}
 */
export function validateDraft(input, context = {}) {
  const draft = normalizeDraft(input);
  const errors = [];
  const names = new Set(list(context.names).filter(value => typeof value === 'string'));
  if (context.selfName) names.delete(context.selfName);

  if (draft.name === '') {
    errors.push(error('name', 'required'));
  } else if (!SERVER_NAME.test(draft.name)) {
    errors.push(error('name', 'name-format'));
  } else if (RESERVED_NAMES.includes(draft.name)) {
    errors.push(error('name', 'name-reserved', { name: draft.name }));
  } else if (names.has(draft.name)) {
    errors.push(error('name', 'duplicate', { name: draft.name }));
  }

  if (draft.transport === 'stdio') {
    if (draft.command === '') {
      errors.push(error('command', 'required'));
    } else if (/[\0\r\n]/.test(draft.command) || !bounded(draft.command)) {
      errors.push(error('command', 'command-invalid'));
    }
    if (draft.args.length > MAX_ARGS) {
      errors.push(error('args', 'args-invalid'));
    } else {
      draft.args.forEach((argument, index) => {
        if (/[\0\r\n]/.test(argument) || !bounded(argument)) {
          errors.push(error(`args[${index}]`, 'args-invalid'));
        }
      });
    }
    if (/[\0\r\n]/.test(draft.cwd) || !bounded(draft.cwd)) errors.push(error('cwd', 'cwd-invalid'));
    validatePairs(draft.env, 'env', errors, new Set(list(context.existingEnvKeys)));
    if (draft.url !== '') errors.push(error('url', 'transport-invalid'));
    if (draft.headers.length > 0) errors.push(error('headers', 'transport-invalid'));
  } else if (draft.transport === 'streamable-http') {
    validateUrl(draft.url, errors);
    validatePairs(draft.headers, 'headers', errors, new Set(list(context.existingHeaderKeys)));
    if (draft.command !== '') errors.push(error('command', 'transport-invalid'));
    if (draft.args.length > 0) errors.push(error('args', 'transport-invalid'));
    if (draft.cwd !== '') errors.push(error('cwd', 'transport-invalid'));
    if (draft.env.length > 0) errors.push(error('env', 'transport-invalid'));
  } else {
    errors.push(error('transport', 'transport-invalid'));
  }

  return { draft, errors };
}

/** Strip a draft down to the fields the patch writer owns. */
export function draftFields(draft, transport) {
  if (transport === 'stdio') {
    return { command: draft.command, args: draft.args, cwd: draft.cwd, env: draft.env };
  }
  return { url: draft.url, headers: draft.headers };
}
