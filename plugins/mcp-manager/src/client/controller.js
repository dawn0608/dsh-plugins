/** Observable page state: configuration and enablement. */

import { ApiError, request } from './api.js';

const POLL_DELAY_MS = 2000;
const READ_TIMEOUT_MS = 8000;

/**
 * @param {{fetchImpl?: typeof fetch}} [options]
 */
export function createController(options = {}) {
  const fetchImpl = options.fetchImpl;
  let snapshot = {
    status: 'idle',
    state: null,
    error: null,
    busy: false,
  };
  const listeners = new Set();
  let generation = 0;
  let pollTimer;
  let polling;
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

  async function load(lifecycleSignal) {
    if (disposed) return;
    const current = ++generation;
    if (snapshot.status === 'idle') publish({ status: 'loading' });
    const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
    const signal = lifecycleSignal ? AbortSignal.any([lifecycleSignal, timeout]) : timeout;
    try {
      const { payload } = await request({ method: 'GET', fetchImpl, signal });
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
    }
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

  async function setEnabled(target, enabled) {
    // A GET that began before this write must not restore the old switch state.
    generation += 1;
    publish({ busy: true });
    try {
      const { payload } = await request({
        method: 'POST',
        fetchImpl,
        body: { action: 'setEnabled', id: target.id, name: target.name, rowHash: target.rowHash, enabled },
      });
      if (payload.ok === true) {
        publish({ busy: false, status: 'ready', state: payload, error: null });
        return { ok: true };
      }
      if (payload.code === 'conflict') await load();
      publish({ busy: false });
      return { ok: false, code: payload.code, params: payload.params };
    } catch (error) {
      publish({ busy: false });
      return { ok: false, code: failure(error).code };
    }
  }

  /** Stop background work without invalidating the controller (React StrictMode remounts). */
  function stop() {
    generation += 1;
    polling?.abort();
    polling = undefined;
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }

  function dispose() {
    disposed = true;
    stop();
    listeners.clear();
  }

  return { subscribe, getSnapshot, load, setEnabled, start, stop, dispose };
}
