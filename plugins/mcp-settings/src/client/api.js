/** Browser transport for the settings API. */

const CONNECTION_PATH = 'api/mcp-settings';
const PLAIN_PATH = '/plugin/mcp-settings';

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function streamOrigin() {
  const transport = globalThis.window && globalThis.window.__DSH_TRANSPORT__;
  if (!transport || typeof transport.streamBaseUrl !== 'string' || transport.streamBaseUrl === '') return undefined;
  try {
    const url = new URL(transport.streamBaseUrl, globalThis.location && globalThis.location.href);
    return `${url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function documentBase() {
  const location = globalThis.location;
  if (!location || (location.protocol !== 'http:' && location.protocol !== 'https:')) return undefined;
  return location.origin;
}

/** Candidate URLs, most specific first. Writes stay on the authenticated channel. */
export function candidatesFor(method) {
  const urls = [];
  if (method !== 'POST') {
    const stream = streamOrigin();
    if (stream) urls.push(`${stream}${PLAIN_PATH}`);
    const document = documentBase();
    if (document) urls.push(`${document}${PLAIN_PATH}`);
  }
  urls.push(CONNECTION_PATH);
  if (method === 'POST') {
    const document = documentBase();
    if (document) urls.push(`${document}${PLAIN_PATH}`);
  }
  return urls.filter((value, index) => urls.indexOf(value) === index);
}

function isResult(payload) {
  return Boolean(payload) && typeof payload === 'object' && typeof payload.ok === 'boolean';
}

/**
 * @param {{method?: string, body?: unknown, signal?: AbortSignal, fetchImpl?: typeof fetch}} request
 * @returns {Promise<{status: number, payload: object}>}
 */
export async function request(input) {
  const method = input.method || 'GET';
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const headers = { accept: 'application/json' };
  let body;
  if (input.body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['x-dsh-mcp-settings'] = '1';
    body = JSON.stringify(input.body);
  }
  let lastCode = 'network';
  for (const url of candidatesFor(method)) {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body,
        cache: 'no-store',
        credentials: 'same-origin',
        signal: input.signal,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new ApiError('aborted', 0);
      lastCode = 'network';
      continue;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (isResult(payload)) return { status: response.status, payload };
    if (response.status === 401 || response.status === 403) {
      lastCode = 'unauthorized';
      continue;
    }
    if (response.status === 404) {
      lastCode = 'network';
      continue;
    }
    lastCode = 'network';
  }
  throw new ApiError(lastCode, 0);
}
