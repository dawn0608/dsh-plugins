/** Observable page state: one read model, one write path per action. */

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
    busy: null,
    notice: null,
    refreshing: false,
  };
  const listeners = new Set();
  let generation = 0;
  let pollTimer;
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
    let attempts = 0;
    const tick = async () => {
      if (disposed) return;
      attempts += 1;
      await load({ silent: true });
      if (disposed) return;
      const servers = snapshot.state && Array.isArray(snapshot.state.servers) ? snapshot.state.servers : [];
      const server = servers.find(item => item.name === name);
      if (server && typeof server.tools === 'number' && server.tools > 0) {
        return;
      }
      if (attempts >= POLL_ATTEMPTS) {
        publish({ notice: { code: 'savedPending' } });
        return;
      }
      pollTimer = setTimeout(tick, POLL_DELAY_MS);
    };
    pollTimer = setTimeout(tick, POLL_DELAY_MS);
  }

  async function save(draft, options_) {
    const target = options_.target;
    const mode = options_.mode;
    stopPolling();
    publish({ busy: { action: 'save', id: target && target.id ? target.id : null }, notice: null });
    try {
      const { payload } = await request({
        method: 'POST',
        fetchImpl,
        body: {
          action: 'save',
          mode,
          id: target && target.id ? target.id : undefined,
          name: target && target.name ? target.name : undefined,
          rowHash: target && target.rowHash ? target.rowHash : undefined,
          draft,
        },
      });
      if (payload.ok === true) {
        publish({ busy: null, status: 'ready', state: payload, error: null, notice: { code: 'saved', params: { name: draft.name } } });
        if (draft.enabled !== false) startPolling(draft.name);
        return { ok: true };
      }
      if (payload.code === 'conflict') await load({ silent: true });
      publish({ busy: null });
      return { ok: false, code: payload.code, params: payload.params, errors: payload.errors };
    } catch (error) {
      publish({ busy: null });
      return { ok: false, code: failure(error).code };
    }
  }

  async function remove(target) {
    stopPolling();
    publish({ busy: { action: 'delete', id: target && target.id ? target.id : null }, notice: null });
    try {
      const { payload } = await request({
        method: 'POST',
        fetchImpl,
        body: { action: 'delete', id: target.id, name: target.name, rowHash: target.rowHash },
      });
      if (payload.ok === true) {
        publish({ busy: null, status: 'ready', state: payload, notice: { code: 'deleted', params: { name: target.name } } });
        return { ok: true };
      }
      if (payload.code === 'conflict') await load({ silent: true });
      publish({ busy: null });
      return { ok: false, code: payload.code, params: payload.params };
    } catch (error) {
      publish({ busy: null });
      return { ok: false, code: failure(error).code };
    }
  }

  async function setEnabled(target, enabled) {
    stopPolling();
    publish({ busy: { action: 'toggle', id: target && target.id ? target.id : null } });
    try {
      const { payload } = await request({
        method: 'POST',
        fetchImpl,
        body: { action: 'setEnabled', id: target.id, name: target.name, rowHash: target.rowHash, enabled },
      });
      if (payload.ok === true) {
        publish({ busy: null, status: 'ready', state: payload, error: null });
        if (enabled) startPolling(target.name);
        return { ok: true };
      }
      if (payload.code === 'conflict') await load({ silent: true });
      publish({ busy: null });
      return { ok: false, code: payload.code, params: payload.params };
    } catch (error) {
      publish({ busy: null });
      return { ok: false, code: failure(error).code };
    }
  }

  function dismissNotice() {
    publish({ notice: null });
  }

  /** Stop background work without invalidating the controller (React StrictMode remounts). */
  function stop() {
    stopPolling();
  }

  function dispose() {
    disposed = true;
    stopPolling();
    listeners.clear();
  }

  return { subscribe, getSnapshot, load, save, remove, setEnabled, dismissNotice, stop, dispose };
}
