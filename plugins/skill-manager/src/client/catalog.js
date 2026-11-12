import { watchRefresh } from '../../../../src/client/refresh.js';
import { request, SkillError } from './api.js';

export function createCatalog(send = request) {
  const listeners = new Set();
  let snapshot = {
    skills: null, listError: null, mutationError: null, busy: false, savingId: null, revision: null,
  };
  let reading;
  let writing;
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
    if (snapshot.busy || reading) { trailing = true; return; }
    cancelRefresh();
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
        publish({ skills: result.skills, revision: result.revision, listError: null });
      } else if (!hasCompleteCatalog) {
        publish({ skills: result.skills, revision: result.revision, listError: 'incomplete' });
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

  async function mutate(action) {
    if (snapshot.busy || stopped) return false;
    cancelRefresh();
    const pending = new AbortController();
    writing = pending;
    publish({ busy: true, savingId: action.action === 'setEnabled' ? action.id : null, mutationError: null });
    try {
      await send({ ...action, revision: snapshot.revision }, AbortSignal.any([pending.signal, AbortSignal.timeout(30000)]));
      if (writing !== pending || stopped) return false;
      writing = undefined;
      let { skills } = snapshot;
      if (skills && action.action === 'setEnabled') {
        skills = skills.map(skill => skill.id === action.id ? { ...skill, enabled: action.enabled } : skill);
      }
      publish({ skills, busy: false, savingId: null });
      trailing = false;
      void refresh();
      return true;
    } catch (error) {
      if (writing !== pending || stopped) return false;
      writing = undefined;
      publish({ mutationError: error.code ?? 'unavailable', busy: false, savingId: null });
      trailing = false;
      void refresh();
      return false;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    mutate,
    clearMutationError() {
      if (snapshot.mutationError) publish({ mutationError: null });
    },
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
      writing?.abort();
      writing = undefined;
      snapshot = { ...snapshot, busy: false, savingId: null };
    },
  };
}
