import { watchRefresh } from '../../../../src/client/refresh.js';
import { request, SkillError } from './api.js';

export function createCatalog(send = request) {
  const listeners = new Set();
  let snapshot = {
    skills: null, listError: null,
  };
  let reading;
  let stopPolling;
  let trailing = false;
  let stopped = false;
  let hasCompleteCatalog = false;

  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  function cancelRefresh() {
    reading?.abort();
    reading = undefined;
  }

  async function refresh() {
    if (stopped) return;
    if (reading) { trailing = true; return; }
    const pending = new AbortController();
    reading = pending;
    try {
      const result = await send({ action: 'list' },
        AbortSignal.any([pending.signal, AbortSignal.timeout(8000)]));
      if (reading !== pending) return;
      if (!Array.isArray(result?.skills) || typeof result.complete !== 'boolean') {
        throw new SkillError('unavailable');
      }
      if (result.complete) {
        hasCompleteCatalog = true;
        publish({ skills: result.skills, listError: null });
      } else if (!hasCompleteCatalog) {
        publish({ skills: result.skills, listError: 'incomplete' });
      } else {
        publish({ listError: 'incomplete' });
      }
    } catch (error) {
      if (reading === pending) publish({ listError: error.code ?? 'unavailable' });
    } finally {
      if (reading === pending) {
        reading = undefined;
        if (trailing) { trailing = false; void refresh(); }
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    start() {
      if (stopPolling) return;
      stopped = false;
      stopPolling = watchRefresh(() => { void refresh(); }, 15000);
    },
    stop() {
      stopped = true;
      stopPolling?.();
      stopPolling = undefined;
      trailing = false;
      cancelRefresh();
    },
  };
}
