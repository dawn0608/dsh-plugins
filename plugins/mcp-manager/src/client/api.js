/** Browser transport for the authenticated connection channel. */

const CONNECTION_PATH = 'api/mcp-manager';

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function isResult(payload) {
  return Boolean(payload) && typeof payload === 'object' && typeof payload.ok === 'boolean';
}

/**
 * @param {{method?: string, body?: unknown, signal?: AbortSignal, fetchImpl?: typeof fetch}} input
 * @returns {Promise<{status: number, payload: object}>}
 */
export async function request(input) {
  const { method = 'GET', fetchImpl = globalThis.fetch, signal } = input;
  const headers = { accept: 'application/json' };
  let body;
  if (input.body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['x-dsh-mcp-manager'] = '1';
    body = JSON.stringify(input.body);
  }

  let abort;
  try {
    signal?.throwIfAborted();
    const aborted = signal && new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    const response = (async () => {
      const result = await fetchImpl(CONNECTION_PATH, {
        method, headers, body, cache: 'no-store', credentials: 'same-origin', signal,
      });
      const payload = await result.json().catch(() => undefined);
      if (isResult(payload)) return { status: result.status, payload };
      if (result.status === 401 || result.status === 403) throw new ApiError('unauthorized', result.status);
      throw new ApiError('network', result.status);
    })();
    // The host fetch bridge may ignore cancellation while waiting for a reply.
    return await (aborted ? Promise.race([response, aborted]) : response);
  } catch (error) {
    if (signal?.aborted) throw new ApiError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'aborted', 0);
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') throw new ApiError('aborted', 0);
    throw new ApiError('network', 0);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}
