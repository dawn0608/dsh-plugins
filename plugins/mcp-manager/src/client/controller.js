/** Observable page state for the MCP configuration and its actions. */

import { ApiError, request } from './api.js';

const POLL_DELAY_MS = 2000;
const READ_TIMEOUT_MS = 8000;
const WRITE_TIMEOUT_MS = 8000;
const SHARED_REMOVAL_TIMEOUT_MS = 40_000;

function requestDeadline(ms, lifecycleSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
  return {
    signal: lifecycleSignal ? AbortSignal.any([lifecycleSignal, timeout.signal]) : timeout.signal,
    clear: () => clearTimeout(timer),
  };
}

/**
 * @param {{fetchImpl?: typeof fetch, writeTimeoutMs?: number}} [options]
 */
export function createController(options = {}) {
  const { fetchImpl, writeTimeoutMs = WRITE_TIMEOUT_MS } = options;
  let snapshot = {
    status: 'idle',
    state: null,
    error: null,
    busy: false,
    action: null,
  };
  const listeners = new Set();
  let generation = 0;
  let pollTimer;
  let polling;
  let activeWrite;
  let disposed = false;

  function publish(patch) {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot() {
    return snapshot;
  }

  function failure(error) {
    if (error instanceof ApiError) return { code: error.code };
    return { code: 'network' };
  }

  async function refresh(lifecycleSignal) {
    if (disposed) return;
    const current = ++generation;
    if (snapshot.status === 'idle') publish({ status: 'loading' });
    const deadline = requestDeadline(READ_TIMEOUT_MS, lifecycleSignal);
    try {
      const { payload } = await request({ method: 'GET', fetchImpl, signal: deadline.signal });
      if (current !== generation || disposed) return;
      if (payload.ok === true) {
        publish({ status: 'ready', state: payload, error: null });
      } else {
        publish({
          status: snapshot.state === null ? 'error' : 'ready',
          error: { code: payload.code || 'internal', params: payload.params },
        });
      }
    } catch (error) {
      if (current !== generation || disposed) return;
      publish({ status: snapshot.state === null ? 'error' : 'ready', error: failure(error) });
    } finally {
      deadline.clear();
    }
  }

  async function load(lifecycleSignal) {
    if (!activeWrite) await refresh(lifecycleSignal);
  }

  function start() {
    if (polling || disposed) return;
    const session = new AbortController();
    polling = session;

    async function poll() {
      if (!snapshot.busy) await load(session.signal);
      if (!session.signal.aborted) pollTimer = setTimeout(poll, POLL_DELAY_MS);
    }

    void poll();
  }

  async function mutate(target, body) {
    if (disposed) return { ok: false, code: 'aborted' };
    if (activeWrite) return { ok: false, code: 'locked' };
    const operation = new AbortController();
    activeWrite = operation;
    const shared = body.action === 'deleteShared';
    const action = { id: target.id, name: target.name, ...(shared ? { kind: 'deleteShared' } : {}) };
    // A GET that began before this write must not restore the old state.
    generation += 1;
    publish({ busy: true, action });

    const deadline = requestDeadline(shared ? SHARED_REMOVAL_TIMEOUT_MS : writeTimeoutMs, operation.signal);
    let payload;
    let error;
    try {
      ({ payload } = await request({
        method: 'POST',
        fetchImpl,
        signal: deadline.signal,
        body: { id: target.id, name: target.name, rowHash: target.rowHash, ...body },
      }));
      if (!payload.ok) error = { code: payload.code || 'internal', params: payload.params };
      else if (shared && payload.removal !== 'removed' && payload.removal !== 'pending') error = { code: 'shared-unknown' };
    } catch (cause) {
      error = failure(cause);
      if (shared && (error.code === 'network' || error.code === 'timeout')) error = { code: 'shared-unknown' };
    } finally {
      deadline.clear();
    }

    if (activeWrite !== operation) return { ok: false, code: 'aborted' };
    if (!error) {
      activeWrite = undefined;
      publish({ busy: false, action: shared ? { ...action, removal: payload.removal } : null, status: 'ready', state: payload, error: null });
      return shared ? { ok: true, removal: payload.removal } : { ok: true };
    }

    // A lost response can follow a successful disk write; read the file again.
    await refresh(operation.signal);
    if (activeWrite !== operation) return { ok: false, code: 'aborted' };
    activeWrite = undefined;
    publish({ busy: false, action: { ...action, error } });
    return { ok: false, ...error };
  }

  function setEnabled(target, enabled) {
    return mutate(target, { action: 'setEnabled', enabled });
  }

  function deleteShared(target, revision) {
    return mutate(target, { action: 'deleteShared', revision });
  }

  /** Stop background work without invalidating the controller (React StrictMode remounts). */
  function stop() {
    generation += 1;
    polling?.abort();
    polling = undefined;
    clearTimeout(pollTimer);
    pollTimer = undefined;
    if (activeWrite) {
      const operation = activeWrite;
      activeWrite = undefined;
      operation.abort();
      publish({ busy: false, action: null });
    }
  }

  function dispose() {
    disposed = true;
    stop();
    listeners.clear();
  }

  return { subscribe, getSnapshot, load, setEnabled, deleteShared, start, stop, dispose };
}
