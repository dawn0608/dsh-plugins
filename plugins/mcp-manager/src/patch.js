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
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, LineCounter, isMap, isSeq } from 'yaml';
import { PatchError } from './errors.js';

/** Package name of the MCP client rows this module manages. */
export const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client';

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
    return { start: fallback, end: node.range[2] };
  }
  let end = node.range[2];
  if (end < text.length) {
    const position = parsed.lineCounter.linePos(end);
    if (position.col === 1) end = parsed.starts[position.line - 1];
    else if (text[end] === '\n') end += 1;
  }
  // Skip the newline that terminates the row's last content line.
  if (end > start && text[end - 1] !== '\n' && text[end] === '\n') end += 1;
  return { start, end };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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
  const blocks = [];
  const topIds = new Set();

  doc.contents.items.forEach(blockNode => {
    const value = clean(blockNode.toJSON());
    if (value && typeof value === 'object' && typeof value.id === 'string') topIds.add(value.id);
    blocks.push({
      value,
      insertNode: isMap(blockNode) ? blockNode.get('insert') : undefined,
      keys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [],
    });
  });

  // Cordis IDs share the same namespace even when an insert belongs to another package.
  const idCounts = new Map();
  for (const { value } of blocks) {
    if (!Array.isArray(value?.insert)) continue;
    for (const row of value.insert) {
      if (typeof row?.id === 'string') idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
    }
  }
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
        rowHash: '',
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
      const conditional = rowNode.has('disabled') && typeof row.disabled !== 'boolean';
      const entry = {
        name,
        id,
        transport,
        enabled: conditional ? null : row.disabled !== true,
        editable: true,
        readOnlyCode: null,
        blockIndex,
        rowIndex,
        rowHash: sha256(text.slice(span.start, span.end)),
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
      } else if (topIds.has(id) || idCounts.get(id) > 1) {
        entry.editable = false;
        entry.readOnlyCode = 'duplicate-id';
      } else if (conditional) {
        entry.editable = false;
        entry.readOnlyCode = 'conditional-disabled';
      }
      if (Object.hasOwn(config, 'enabled')) {
        entry.editable = false;
        entry.readOnlyCode = 'config-enabled';
      }
      if (name === undefined) {
        entry.editable = false;
        entry.readOnlyCode = 'missing-name';
      }
      if (entry.editable) {
        try {
          readConfig(config, transport);
        } catch {
          entry.editable = false;
          entry.readOnlyCode = 'config-invalid';
        }
      }
      entries.push(entry);
    });
  });

  const nameCounts = new Map();
  for (const entry of entries) {
    if (entry.name === undefined) continue;
    nameCounts.set(entry.name, (nameCounts.get(entry.name) || 0) + 1);
  }

  return {
    doc,
    blocks,
    entries,
    duplicateNames: new Set([...nameCounts].filter(([, count]) => count > 1).map(([name]) => name)),
  };
}

function withoutDisabled(doc, blockIndex, rowIndex) {
  // Resolve aliases; a reference to the old flag elsewhere must still compare equal.
  const blocks = doc.toJS();
  const block = blocks[blockIndex];
  const insert = block.insert.slice();
  const row = { ...insert[rowIndex] };
  delete row.disabled;
  insert[rowIndex] = row;
  return blocks.with(blockIndex, { ...block, insert });
}

/** Produce the next patch text with one row's `disabled` flag changed. */
export function buildSetEnabled(text, entry, enabled) {
  if (!entry || entry.rowIndex === null) throw new PatchError('not-found');
  if (!entry.editable) throw new PatchError('read-only', { code: entry.readOnlyCode });
  const parsed = readPatch(text);
  const current = parsed.entries.find(item => item.id === entry.id && item.blockIndex === entry.blockIndex
    && item.rowIndex === entry.rowIndex);
  if (!current) throw new PatchError('not-found');
  if (!current.editable) throw new PatchError('read-only', { code: current.readOnlyCode });
  const result = { text, id: current.id, name: current.name, enabled };
  if (current.enabled === enabled) return result;

  const { blockIndex, rowIndex } = current;
  const row = parsed.blocks[blockIndex].insertNode.items[rowIndex];
  const flag = row.get('disabled', true);
  let start;
  let end;
  let replacement;
  if (flag) {
    // The scalar value range excludes the key, tag/anchor and trailing comment.
    [start, end] = flag.range;
    replacement = String(!enabled);
  } else if (row.flow) {
    start = end = row.range[0] + 1;
    replacement = 'disabled: true, ';
  } else {
    start = end = row.range[0];
    const lineStart = lineStartOf(text, start);
    const newline = (text.slice(start).match(/\r?\n/) || text.match(/\r?\n/))?.[0] || '\n';
    replacement = `disabled: true${newline}${' '.repeat(start - lineStart)}`;
  }
  const nextText = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  const after = readPatch(nextText);
  const updated = after.entries.find(item => item.blockIndex === blockIndex && item.rowIndex === rowIndex);
  if (!updated?.editable || updated.id !== current.id || updated.enabled !== enabled) {
    throw new PatchError('verify-failed');
  }

  // Check the entire document, including this row's configuration, with only the flag omitted.
  try {
    if (isDeepStrictEqual(
      withoutDisabled(parsed.doc, blockIndex, rowIndex),
      withoutDisabled(after.doc, blockIndex, rowIndex),
    )) return { ...result, text: nextText };
  } catch {
    // Unresolved aliases cannot be verified.
  }
  throw new PatchError('verify-failed');
}
