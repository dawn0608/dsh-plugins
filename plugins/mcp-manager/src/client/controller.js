/** Observable page state: configuration and enablement. */

import { ApiError, request } from './api.js';

const POLL_DELAY_MS = 1500;
const POLL_ATTEMPTS = 8;

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
    refreshing: false,
  };
  const listeners = new Set();
  let generation = 0;
  let pollTimer;
  let pollGeneration = 0;
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

  function stopPolling() {
    pollGeneration += 1;
    if (pollTimer !== undefined) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  }

  function failure(error) {
    if (error instanceof ApiError) return { code: error.code };
    return { code: 'network' };
  }

  async function load(configuration = {}) {
    const silent = configuration.silent === true;
    const current = ++generation;
    if (!silent) {
      publish(snapshot.state === null
        ? { status: 'loading', error: null, refreshing: true }
        : { error: null, refreshing: true });
    }
    try {
      const { payload } = await request({ method: 'GET', fetchImpl });
      if (current !== generation || disposed) return;
      if (payload.ok === true) {
        publish({ status: 'ready', state: payload, error: null, refreshing: false });
      } else {
        publish({
          status: snapshot.state === null ? 'error' : 'ready',
          error: { code: payload.code || 'internal', params: payload.params },
          refreshing: false,
        });
      }
    } catch (error) {
      if (current !== generation || disposed) return;
      publish({ status: snapshot.state === null ? 'error' : 'ready', error: failure(error), refreshing: false });
    }
  }

  function startPolling(name) {
    stopPolling();
    const currentPoll = pollGeneration;
    let attempts = 0;
    const tick = async () => {
      if (disposed) return;
      attempts += 1;
      await load({ silent: true });
      if (currentPoll !== pollGeneration || disposed) return;
      const servers = snapshot.state && Array.isArray(snapshot.state.servers) ? snapshot.state.servers : [];
      const server = servers.find(item => item.name === name);
      if (!server || server.enabled === false || server.tools > 0 || attempts >= POLL_ATTEMPTS) return;
      pollTimer = setTimeout(tick, POLL_DELAY_MS);
    };
    pollTimer = setTimeout(tick, POLL_DELAY_MS);
  }

  async function setEnabled(target, enabled) {
    stopPolling();
    const current = ++generation;
    publish({ busy: true, refreshing: false });
    try {
      const { payload } = await request({
        method: 'POST',
        fetchImpl,
        body: { action: 'setEnabled', id: target.id, name: target.name, rowHash: target.rowHash, enabled },
      });
      if (payload.ok === true) {
        publish({ busy: false, status: 'ready', state: payload, error: null });
        if (enabled && current === generation && !disposed) startPolling(target.name);
        return { ok: true };
      }
      if (payload.code === 'conflict') await load({ silent: true });
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
    stopPolling();
  }

  function dispose() {
    disposed = true;
    stop();
    listeners.clear();
  }

  return { subscribe, getSnapshot, load, setEnabled, stop, dispose };
}
