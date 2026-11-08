/**
 * The profile patch editor.
 *
 * The user's `cordis.patch.yml` also holds other plugins' rows, comments and
 * `!!js` expressions. This module therefore never re-serializes the whole
 * document: it parses with `yaml` for structure and ranges, then splices the
 * exact source lines of one MCP row. Every write is re-parsed and compared
 * against the previous document before it is allowed to reach disk.
 */

import { createHash } from 'node:crypto';
import { parseDocument, LineCounter, isMap, isSeq } from 'yaml';
import { isExpression, isSensitiveKey, matchReference, quoteDouble, quoteSingle, referenceExpression, SERVER_NAME } from './shared/references.js';
import { normalizeDraft, validateDraft } from './shared/draft.js';
import { DraftError, PatchError } from './errors.js';

export { DraftError, PatchError };

/** Package name of the MCP client rows this module manages. */
export const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client';
const KNOWN_CONFIG = new Set(['serverName', 'transport', 'command', 'args', 'env', 'cwd', 'url', 'headers']);

const JS_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve(value) {
    return { __jsExpr: String(value) };
  },
};


function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && index + 1 < text.length) starts.push(index + 1);
  }
  return starts;
}

function parse(text) {
  const lineCounter = new LineCounter();
  let doc;
  try {
    doc = parseDocument(text, {
      lineCounter,
      customTags: [JS_TAG],
      uniqueKeys: true,
      logLevel: 'silent',
    });
  } catch (error) {
    throw new PatchError('parse-failed');
  }
  if (doc.errors.length > 0) {
    const position = doc.errors[0].linePos && doc.errors[0].linePos[0];
    throw new PatchError('parse-failed', position ? { line: position.line, column: position.col } : {});
  }
  if (!isSeq(doc.contents)) throw new PatchError('parse-failed');
  return { doc, lineCounter, starts: lineStarts(text) };
}

function clean(value) {
  if (value instanceof Map) {
    const out = {};
    for (const [key, item] of value) out[String(key)] = clean(item);
    return out;
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = clean(item);
    return out;
  }
  return value;
}

function lineStartOf(text, offset) {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

function rowSpan(parsed, text, node) {
  const start = lineStartOf(text, node.range[0]);
  const prefix = text.slice(start, node.range[0]);
  if (!/^\s*-\s+$/.test(prefix)) {
    // The key is not on the dash line; fall back to the key's own line.
    const fallback = lineStartOf(text, node.range[0]);
    return { start: fallback, end: node.range[2], dashIndent: -1 };
  }
  const dashIndent = prefix.indexOf('-');
  let end = node.range[2];
  if (end < text.length) {
    const position = parsed.lineCounter.linePos(end);
    if (position.col === 1) end = parsed.starts[position.line - 1];
    else if (text[end] === '\n') end += 1;
  }
  // Skip the newline that terminates the row's last content line.
  if (end > start && text[end - 1] !== '\n' && text[end] === '\n') end += 1;
  return { start, end, dashIndent };
}

function blockStartOf(parsed, text, block) {
  return lineStartOf(text, block.range[0]);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainScalar(value) {
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : quoteDouble(value);
}

function emitValue(value, indent) {
  if (isExpression(value)) return ` !!js ${quoteSingle(value.__jsExpr)}`;
  if (value === null) return ' null';
  if (typeof value === 'string') return ` ${quoteDouble(value)}`;
  if (typeof value === 'number' || typeof value === 'boolean') return ` ${String(value)}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return ' []';
    return `\n${value.map(item => `${' '.repeat(indent)}- ${emitValue(item, indent + 2).trim()}`).join('\n')}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return ' {}';
    return `\n${entries.map(([key, item]) => `${' '.repeat(indent + 2)}${plainScalar(key)}:${emitValue(item, indent + 4)}`).join('\n')}`;
  }
  throw new PatchError('verify-failed');
}

function emitRow({ id, disabled, config, dashIndent }) {
  const pad = ' '.repeat(dashIndent);
  const keys = ' '.repeat(dashIndent + 2);
  const body = ' '.repeat(dashIndent + 4);
  const lines = [
    `${pad}- id: ${plainScalar(id)}`,
    `${keys}name: '${MCP_CLIENT}'`,
  ];
  if (disabled) lines.push(`${keys}disabled: true`);
  lines.push(`${keys}config:`);
  lines.push(`${body}serverName: ${plainScalar(config.serverName)}`);
  lines.push(`${body}transport: ${config.transport}`);
  if (config.transport === 'stdio') {
    lines.push(`${body}command: ${quoteDouble(config.command)}`);
    if (config.args.length > 0) {
      lines.push(`${body}args:`);
      for (const argument of config.args) lines.push(`${body}- ${quoteDouble(argument)}`);
    }
    if (config.env) {
      lines.push(`${body}env:`);
      for (const [key, value] of Object.entries(config.env)) {
        lines.push(`${' '.repeat(dashIndent + 6)}${plainScalar(key)}:${emitValue(value, dashIndent + 8)}`);
      }
    }
    if (config.cwd) lines.push(`${body}cwd: ${quoteDouble(config.cwd)}`);
  } else {
    lines.push(`${body}url: ${quoteDouble(config.url)}`);
    if (config.headers) {
      lines.push(`${body}headers:`);
      for (const [key, value] of Object.entries(config.headers)) {
        lines.push(`${' '.repeat(dashIndent + 6)}${plainScalar(key)}:${emitValue(value, dashIndent + 8)}`);
      }
    }
  }
  for (const [key, value] of Object.entries(config.extra)) {
    lines.push(`${body}${plainScalar(key)}:${emitValue(value, dashIndent + 6)}`);
  }
  return `${lines.join('\n')}\n`;
}

function pairObject(pairs, existing, kind) {
  const out = {};
  for (const pair of pairs) {
    if (pair.mode === 'literal') out[pair.key] = pair.value;
    else if (pair.mode === 'ref') out[pair.key] = { __jsExpr: referenceExpression(pair) };
    else if (pair.mode === 'keep') {
      const current = existing && Object.hasOwn(existing, pair.key) ? existing[pair.key] : undefined;
      if (current === undefined) throw new DraftError([{ field: `${kind}[0].value`, code: 'keep-unavailable' }]);
      out[pair.key] = current;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function composeConfig(existing, draft) {
  const extra = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!KNOWN_CONFIG.has(key)) extra[key] = value;
  }
  const config = {
    serverName: draft.name,
    transport: draft.transport,
    extra,
  };
  if (draft.transport === 'stdio') {
    config.command = draft.command;
    config.args = draft.args;
    config.cwd = draft.cwd;
    config.env = pairObject(draft.env, existing.env, 'env');
  } else {
    config.url = draft.url;
    config.headers = pairObject(draft.headers, existing.headers, 'headers');
  }
  return config;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function emittedConfig(config) {
  const out = { serverName: config.serverName, transport: config.transport };
  if (config.transport === 'stdio') {
    out.command = config.command;
    if (config.args.length > 0) out.args = config.args;
    if (config.env) out.env = config.env;
    if (config.cwd) out.cwd = config.cwd;
  } else {
    out.url = config.url;
    if (config.headers) out.headers = config.headers;
  }
  for (const [key, value] of Object.entries(config.extra)) out[key] = value;
  return out;
}

function configForApi(entry) {
  const config = entry.config;
  if (entry.transport === 'stdio') {
    return {
      command: typeof config.command === 'string' ? config.command : '',
      args: Array.isArray(config.args) ? config.args.filter(value => typeof value === 'string') : [],
      cwd: typeof config.cwd === 'string' ? config.cwd : '',
      env: Object.entries(config.env && typeof config.env === 'object' ? config.env : {}).map(([key, value]) => ({
        key,
        ...describe(value, key),
      })),
    };
  }
  return {
    url: typeof config.url === 'string' ? config.url : '',
    headers: Object.entries(config.headers && typeof config.headers === 'object' ? config.headers : {}).map(([key, value]) => ({
      key,
      ...describe(value, key),
    })),
  };
}

function describe(value, key) {
  if (isExpression(value)) {
    const reference = matchReference(value.__jsExpr);
    if (reference) return { mode: 'ref', variable: reference.variable, prefix: reference.prefix };
    return { mode: 'expr', configured: true, secret: true };
  }
  if (typeof value === 'string') {
    if (isSensitiveKey(key)) return { mode: 'literal', secret: true, configured: true };
    return { mode: 'literal', value, secret: false };
  }
  return { mode: 'literal', secret: false, configured: false };
}

function readConfig(config, transport) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new PatchError('read-only', { code: 'config-invalid' });
  }
  if (transport === 'stdio') {
    if (typeof config.command !== 'string' || config.command === '') throw new PatchError('read-only', { code: 'config-invalid' });
    if (config.args !== undefined && (!Array.isArray(config.args) || !config.args.every(value => typeof value === 'string'))) {
      throw new PatchError('read-only', { code: 'config-invalid' });
    }
    if (config.env !== undefined && (!config.env || typeof config.env !== 'object' || Array.isArray(config.env))) {
      throw new PatchError('read-only', { code: 'config-invalid' });
    }
    if (config.cwd !== undefined && typeof config.cwd !== 'string') throw new PatchError('read-only', { code: 'config-invalid' });
  } else {
    if (typeof config.url !== 'string' || config.url === '') throw new PatchError('read-only', { code: 'config-invalid' });
    if (config.headers !== undefined && (!config.headers || typeof config.headers !== 'object' || Array.isArray(config.headers))) {
      throw new PatchError('read-only', { code: 'config-invalid' });
    }
  }
}

/** Read and index one patch document. Throws `PatchError` on invalid YAML. */
export function readPatch(text) {
  const parsed = parse(text);
  const { doc } = parsed;
  const entries = [];
  const warnings = [];
  const blocks = [];
  const topIds = new Set();
  const topOverrides = new Set();

  doc.contents.items.forEach((blockNode, index) => {
    const value = clean(blockNode.toJSON());
    if (value && typeof value === 'object' && typeof value.id === 'string') topIds.add(value.id);
    if (value && typeof value === 'object' && typeof value.id === 'string' && Object.hasOwn(value, 'name') && value.name === MCP_CLIENT) {
      topOverrides.add(value.id);
    }
    blocks.push({
      index,
      node: blockNode,
      value,
      start: blockStartOf(parsed, text, blockNode),
      insertNode: isMap(blockNode) ? blockNode.get('insert') : undefined,
      keys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [],
    });
  });

  const rowIds = [];
  blocks.forEach((block, blockIndex) => {
    if (block.value && typeof block.value === 'object' && typeof block.value.id === 'string' && block.value.name === MCP_CLIENT) {
      entries.push({
        name: undefined,
        id: block.value.id,
        transport: undefined,
        enabled: true,
        editable: false,
        readOnlyCode: 'not-insert',
        blockIndex,
        rowIndex: null,
        span: { start: block.start, end: block.start, dashIndent: 0 },
        raw: '',
        rowHash: '',
        config: {},
      });
      return;
    }
    if (!block.value || typeof block.value !== 'object' || Array.isArray(block.value)) return;
    if (!Array.isArray(block.value.insert) || !isSeq(block.insertNode)) return;
    const shapeOk = block.keys.length === 1 && block.keys[0] === 'insert';
    block.insertNode.items.forEach((rowNode, rowIndex) => {
      if (!isMap(rowNode)) return;
      const row = clean(rowNode.toJSON());
      if (!row || typeof row !== 'object' || row.name !== MCP_CLIENT) return;
      const id = typeof row.id === 'string' ? row.id : undefined;
      if (id !== undefined) rowIds.push(id);
      const config = row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : {};
      const name = typeof config.serverName === 'string' ? config.serverName : undefined;
      const transport = config.transport === 'stdio' || config.transport === 'streamable-http'
        ? config.transport
        : typeof config.command === 'string'
          ? 'stdio'
          : typeof config.url === 'string'
            ? 'streamable-http'
            : undefined;
      const span = rowSpan(parsed, text, rowNode);
      const entry = {
        name,
        id,
        transport,
        enabled: true,
        editable: true,
        readOnlyCode: null,
        blockIndex,
        rowIndex,
        span,
        raw: text.slice(span.start, span.end),
        rowHash: sha256(text.slice(span.start, span.end)),
        config,
      };
      if (!shapeOk) {
        entry.editable = false;
        entry.readOnlyCode = 'block-shape';
      } else if (Object.keys(row).some(key => !['id', 'name', 'config', 'disabled'].includes(key))) {
        entry.editable = false;
        entry.readOnlyCode = 'row-shape';
      } else if (typeof row.id !== 'string' || row.id === '') {
        entry.editable = false;
        entry.readOnlyCode = 'missing-id';
      } else if (id !== undefined && topIds.has(id)) {
        entry.editable = false;
        entry.readOnlyCode = 'duplicate-id';
      } else if (row.disabled !== undefined && typeof row.disabled !== 'boolean') {
        entry.editable = false;
        entry.readOnlyCode = 'conditional-disabled';
        entry.enabled = null;
      } else {
        entry.enabled = row.disabled !== true;
      }
      if (Object.hasOwn(config, 'enabled')) {
        entry.editable = false;
        entry.readOnlyCode = 'config-enabled';
      }
      if (name === undefined) {
        entry.editable = false;
        entry.readOnlyCode = 'missing-name';
      } else if (!SERVER_NAME.test(name)) {
        warnings.push({ code: 'unsupported-name', name });
      }
      if (entry.editable) {
        try {
          readConfig(config, transport);
        } catch {
          entry.editable = false;
          entry.readOnlyCode = 'config-invalid';
        }
      }
      if (entry.editable) {
        entry.api = configForApi(entry);
      }
      entries.push(entry);
    });
  });

  // A row id is unique across the whole patch, not only inside its own insert list.
  const idCounts = new Map();
  for (const id of rowIds) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  entries.forEach(entry => {
    if (entry.rowIndex === null || !entry.editable) return;
    if (entry.id !== undefined && idCounts.get(entry.id) > 1) {
      entry.editable = false;
      entry.readOnlyCode = 'duplicate-id';
    }
  });

  const nameCounts = new Map();
  for (const entry of entries) {
    if (entry.name === undefined) continue;
    nameCounts.set(entry.name, (nameCounts.get(entry.name) || 0) + 1);
  }

  return {
    doc,
    parsed,
    blocks,
    entries,
    warnings,
    names: [...nameCounts.keys()],
    duplicateNames: new Set([...nameCounts].filter(([, count]) => count > 1).map(([name]) => name)),
    topIds,
  };
}

/** A stable fingerprint of the document outside one row. */
function canonical(doc, omit) {
  const out = [];
  doc.contents.items.forEach((blockNode, blockIndex) => {
    const value = clean(blockNode.toJSON());
    if (value && typeof value === 'object' && Array.isArray(value.insert)) {
      const rows = value.insert.filter((_, rowIndex) => !(omit && omit.blockIndex === blockIndex && omit.rowIndex === rowIndex));
      if (rows.length === 0 && Object.keys(value).length === 1) return;
      out.push({ ...value, insert: rows });
    } else {
      out.push(value);
    }
  });
  return out;
}

function verify(beforeText, afterText, omitBefore, omitAfter, expected) {
  let before;
  let after;
  try {
    before = canonical(parse(beforeText).doc, omitBefore);
    after = canonical(parse(afterText).doc, omitAfter);
  } catch (error) {
    throw error instanceof PatchError ? error : new PatchError('verify-failed');
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new PatchError('verify-failed');
  if (expected) {
    const parsed = readPatch(afterText);
    const row = parsed.entries.find(entry => entry.id === expected.id);
    if (!row) throw new PatchError('verify-failed');
    if (row.name !== expected.name) throw new PatchError('verify-failed');
    if (row.transport !== expected.transport) throw new PatchError('verify-failed');
    if (expected.enabled !== undefined && row.enabled !== expected.enabled) throw new PatchError('verify-failed');
    if (expected.config !== undefined
      && JSON.stringify(stable(row.config)) !== JSON.stringify(stable(expected.config))) {
      throw new PatchError('verify-failed');
    }
  }
}

function nextId(name, used) {
  const base = `mcp-panel-${String(name).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server'}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function usedIds(parsed) {
  const used = new Set();
  parsed.doc.contents.items.forEach(blockNode => {
    const value = clean(blockNode.toJSON());
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') used.add(value.id);
    if (Array.isArray(value.insert)) {
      for (const row of value.insert) {
        if (row && typeof row === 'object' && typeof row.id === 'string') used.add(row.id);
      }
    }
  });
  return used;
}

function insertBlock(text, parsed, rowText) {
  const candidates = parsed.doc.contents.items
    .map((node, index) => ({ node, index, value: clean(node.toJSON()) }))
    .filter(block => block.value && typeof block.value === 'object'
      && Array.isArray(block.value.insert)
      && isSeq(block.node.get('insert'))
      && block.node.get('insert').items.length > 0
      && Object.keys(block.value).length === 1);
  if (candidates.length > 0) {
    const block = candidates[candidates.length - 1];
    const rows = block.node.get('insert').items;
    const last = rows[rows.length - 1];
    const span = rowSpan(parsed.parsed, text, last);
    const separator = text.slice(0, span.end).endsWith('\n') ? '' : '\n';
    return { text: `${text.slice(0, span.end)}${separator}${rowText}${text.slice(span.end)}`, blockIndex: block.index };
  }
  const separator = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { text: `${text}${separator}- insert:\n${rowText}`, blockIndex: -1 };
}

function blockRemovalSpan(parsed, text, blockIndex) {
  const block = parsed.doc.contents.items[blockIndex];
  const start = lineStartOf(text, block.range[0]);
  const next = parsed.doc.contents.items[blockIndex + 1];
  const end = next ? lineStartOf(text, next.range[0]) : text.length;
  return { start, end };
}

/** Validate a draft against the rows of one patch. */
export function checkDraft(parsed, entry, draft) {
  const existing = entry && entry.config ? entry.config : {};
  const existingEnvKeys = existing.env && typeof existing.env === 'object' ? Object.keys(existing.env) : [];
  const existingHeaderKeys = existing.headers && typeof existing.headers === 'object' ? Object.keys(existing.headers) : [];
  const result = validateDraft(draft, {
    names: parsed.names,
    selfName: entry ? entry.name : undefined,
    existingEnvKeys,
    existingHeaderKeys,
  });
  if (entry && parsed.duplicateNames.has(result.draft.name)
    && !result.errors.some(item => item.field === 'name')) {
    result.errors.push({ field: 'name', code: 'duplicate', params: { name: result.draft.name } });
  }
  return result;
}

/**
 * Produce the next patch text for a save.
 * @returns {{text: string, id: string, name: string, enabled: boolean}}
 */
export function buildSave(text, entry, inputDraft) {
  const parsed = readPatch(text);
  const { draft, errors } = checkDraft(parsed, entry, inputDraft);
  if (errors.length > 0) throw new DraftError(errors);
  if (entry && !entry.editable) throw new PatchError('read-only', { code: entry.readOnlyCode });
  const config = composeConfig(entry ? entry.config : {}, draft);
  const enabled = draft.enabled !== false;
  const id = entry ? entry.id : nextId(draft.name, usedIds(parsed));
  if (!entry) {
    const blank = { start: 0, end: 0, dashIndent: 2 };
    const rowText = emitRow({ id, disabled: !enabled, config, dashIndent: blank.dashIndent });
    const inserted = insertBlock(text, parsed, rowText);
    let nextText = inserted.text;
    if (!nextText.endsWith('\n')) nextText += '\n';
    const after = readPatch(nextText);
    const target = after.entries.find(item => item.id === id);
    if (!target) throw new PatchError('verify-failed');
    verify(text, nextText, null, { blockIndex: target.blockIndex, rowIndex: target.rowIndex }, {
      id,
      name: draft.name,
      transport: draft.transport,
      enabled,
      config: emittedConfig(config),
    });
    return { text: nextText, id, name: draft.name, enabled };
  }
  const dashIndent = entry.span.dashIndent >= 0 ? entry.span.dashIndent : 2;
  const rowText = emitRow({ id, disabled: !enabled, config, dashIndent });
  const nextText = `${text.slice(0, entry.span.start)}${rowText}${text.slice(entry.span.end)}`;
  const after = readPatch(nextText);
  const target = after.entries.find(item => item.id === id);
  if (!target) throw new PatchError('verify-failed');
  verify(text, nextText, { blockIndex: entry.blockIndex, rowIndex: entry.rowIndex }, {
    blockIndex: target.blockIndex,
    rowIndex: target.rowIndex,
  }, { id, name: draft.name, transport: draft.transport, enabled, config: emittedConfig(config) });
  return { text: nextText, id, name: draft.name, enabled };
}

/** Produce the next patch text with one row removed. */
export function buildDelete(text, entry) {
  if (!entry || entry.rowIndex === null) throw new PatchError('not-found');
  const parsed = readPatch(text);
  const current = parsed.entries.find(item => item.id === entry.id && item.rowIndex === entry.rowIndex);
  if (!current) throw new PatchError('not-found');
  let nextText = `${text.slice(0, current.span.start)}${text.slice(current.span.end)}`;
  const rowCount = parsed.blocks[current.blockIndex].value.insert.length;
  if (rowCount === 1) {
    const blockSpan = blockRemovalSpan(parsed.parsed, text, current.blockIndex);
    nextText = `${text.slice(0, blockSpan.start)}${text.slice(blockSpan.end)}`;
  }
  if (nextText.trim() === '') nextText = '[]\n';
  if (!nextText.endsWith('\n')) nextText += '\n';
  const after = readPatch(nextText);
  if (after.entries.some(item => item.id === current.id)) throw new PatchError('verify-failed');
  verify(text, nextText, { blockIndex: current.blockIndex, rowIndex: current.rowIndex }, null);
  return { text: nextText, id: current.id, name: current.name };
}

/** Produce the next patch text with one row's `disabled` flag changed. */
export function buildSetEnabled(text, entry, enabled) {
  if (!entry || entry.rowIndex === null) throw new PatchError('not-found');
  if (!entry.editable) throw new PatchError('read-only', { code: entry.readOnlyCode });
  const parsed = readPatch(text);
  const current = parsed.entries.find(item => item.id === entry.id && item.rowIndex === entry.rowIndex);
  if (!current) throw new PatchError('not-found');
  const keepHidden = pair => ({ ...pair, mode: pair.mode === 'expr' || (pair.mode === 'literal' && pair.secret) ? 'keep' : pair.mode });
  const config = composeConfig(current.config, normalizeDraft({
    name: current.name,
    transport: current.transport,
    enabled: current.enabled,
    command: current.api.command ?? '',
    args: current.api.args ?? [],
    cwd: current.api.cwd ?? '',
    env: (current.api.env ?? []).map(keepHidden),
    url: current.api.url ?? '',
    headers: (current.api.headers ?? []).map(keepHidden),
  }));
  const dashIndent = current.span.dashIndent >= 0 ? current.span.dashIndent : 2;
  const rowText = emitRow({ id: current.id, disabled: !enabled, config, dashIndent });
  const nextText = `${text.slice(0, current.span.start)}${rowText}${text.slice(current.span.end)}`;
  const after = readPatch(nextText);
  const target = after.entries.find(item => item.id === current.id);
  if (!target) throw new PatchError('verify-failed');
  verify(text, nextText, { blockIndex: current.blockIndex, rowIndex: current.rowIndex }, {
    blockIndex: target.blockIndex,
    rowIndex: target.rowIndex,
  }, {
    id: current.id,
    name: current.name,
    transport: current.transport,
    enabled,
    config: emittedConfig(config),
  });
  return { text: nextText, id: current.id, name: current.name, enabled };
}

/** The row fingerprint the browser sends back for conflict detection. */
export function rowHashOf(raw) {
  return sha256(raw);
}
