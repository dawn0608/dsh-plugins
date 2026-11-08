/**
 * HTTP faces of the settings API.
 *
 * The browser reaches two seats with one handler:
 * - `/api/mcp-manager` on the authenticated connection channel (the seat the
 *   panel uses, including the Electron shell's fetch bridge);
 * - `/plugin/mcp-manager` on the loopback web server (fallback and the route
 *   this repository's verification uses).
 */

import { DraftError, PatchError } from './errors.js';

export const MAX_BODY_BYTES = 256 * 1024;

const MESSAGES = {
  'not-found': 'The MCP server no longer exists in the profile patch.',
  conflict: 'The profile patch changed; reload and try again.',
  'read-only': 'This entry is not a plain MCP insert row and cannot be changed here.',
  locked: 'The profile is being written by another operation; try again.',
  'parse-failed': 'The profile patch is not valid YAML.',
  'profile-unavailable': 'The desktop profile patch cannot be read or written.',
  'write-failed': 'The profile patch could not be written.',
  'verify-failed': 'The edited patch did not preserve the other configuration; nothing was written.',
  invalid: 'The request is invalid.',
  forbidden: 'The request is not allowed from this origin.',
  method: 'Method not allowed.',
  'invalid-json': 'The request body is not JSON.',
};

function body(code, extra = {}) {
  return { ok: false, code, message: MESSAGES[code] || 'Request failed.', ...extra };
}

function statusOf(error) {
  if (!(error instanceof PatchError)) return 500;
  switch (error.code) {
    case 'not-found': return 404;
    case 'conflict':
    case 'read-only': return 409;
    case 'locked': return 423;
    case 'parse-failed':
    case 'verify-failed': return 422;
    case 'profile-unavailable': return 503;
    case 'invalid': return 400;
    default: return 500;
  }
}

function mapError(error, log) {
  if (error instanceof DraftError) {
    return { status: 422, body: { ok: false, code: 'invalid', errors: error.errors, message: MESSAGES.invalid } };
  }
  if (error instanceof PatchError) {
    log('failed', { code: error.code, field: error.params && error.params.field });
    return { status: statusOf(error), body: body(error.code, { params: error.params }) };
  }
  log('failed', { code: 'internal' });
  return { status: 500, body: { ok: false, code: 'internal', message: 'Request failed.' } };
}

async function dispatch(payload, store) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PatchError('invalid', { reason: 'body' });
  }
  switch (payload.action) {
    case 'save':
      if (payload.mode !== 'add' && payload.mode !== 'edit') throw new PatchError('invalid', { reason: 'mode' });
      return store.save(payload);
    case 'delete':
      return store.remove(payload);
    case 'setEnabled':
      return store.setEnabled(payload);
    default:
      throw new PatchError('invalid', { reason: 'action' });
  }
}

function loopbackHostname(hostname) {
  const value = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return value === '127.0.0.1' || value === '::1' || value === 'localhost' || /^127\./.test(value);
}

/** Same-origin browser check for the unauthenticated loopback route. */
export function trustedRequest(headers) {
  const host = headers.host;
  if (typeof host !== 'string' || host === '') return false;
  let url;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!loopbackHostname(url.hostname)) return false;
  const origin = headers.origin;
  if (origin !== undefined && origin !== null && origin !== 'null' && origin !== url.origin) return false;
  if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
  return true;
}

/**
 * @param {{store: ReturnType<import('./store.js').createStore>, log: (event: string, fields?: object) => void}} options
 */
export function createApi(options) {
  const { store, log } = options;

  return async function api(request) {
    const method = String(request.method || 'GET').toUpperCase();
    try {
      if (method === 'GET' || method === 'HEAD') {
        return { status: 200, body: await store.readState(), head: method === 'HEAD' };
      }
      if (method !== 'POST') return { status: 405, body: body('method') };
      if (request.checkTrust !== false && !trustedRequest(request.headers || {})) {
        return { status: 403, body: body('forbidden') };
      }
      const headers = request.headers || {};
      if (String(headers['x-dsh-mcp-manager'] || '') !== '1') return { status: 403, body: body('forbidden') };
      if (!/^application\/json\b/i.test(String(headers['content-type'] || ''))) {
        return { status: 415, body: body('invalid') };
      }
      const text = typeof request.body === 'string' ? request.body : '';
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { status: 413, body: body('invalid') };
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return { status: 400, body: body('invalid-json') };
      }
      const state = await dispatch(payload, store);
      return { status: 200, body: state };
    } catch (error) {
      return mapError(error, log);
    }
  };
}

/** `node:http` adapter for the loopback web route. */
export function createWebHandler(api) {
  return async function handler(request, response) {
    let text = '';
    if (request.method === 'POST') {
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            response.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify(body('invalid')));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        }
        text = Buffer.concat(chunks).toString('utf8');
      } catch {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(body('invalid')));
        return;
      }
    }
    const result = await api({
      method: request.method,
      headers: request.headers,
      body: text,
      checkTrust: true,
    });
    const serialized = JSON.stringify(result.body);
    response.writeHead(result.status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(serialized),
    });
    response.end(result.head ? undefined : serialized);
  };
}

/** Exact-route adapter for the authenticated connection channel. */
export function createFetchHandler(api) {
  return async function fetchHandler(request) {
    let text = '';
    if (request.method === 'POST') {
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return Response.json(body('invalid'), { status: 413 });
      }
      try {
        text = await request.text();
      } catch {
        return Response.json(body('invalid'), { status: 400 });
      }
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) return Response.json(body('invalid'), { status: 413 });
    }
    const headers = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const result = await api({ method: request.method, headers, body: text, checkTrust: false });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  };
}
