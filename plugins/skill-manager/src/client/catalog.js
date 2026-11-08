import { request, SkillError } from './api.js';

export function createCatalog(send = request) {
  const listeners = new Set();
  let snapshot = {
    skills: null, syncHealth: null, listError: null, mutationError: null, busy: false, savingId: null,
  };
  let reading;
  let writing;
  let timer;
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
    if (snapshot.busy || stopped) return;
    cancelRefresh();
    const pending = new AbortController();
    reading = pending;
    try {
      const result = await send({ action: 'list', workspaceId: null },
        AbortSignal.any([pending.signal, AbortSignal.timeout(8000)]));
      if (reading !== pending) return;
      if (!Array.isArray(result?.skills) || typeof result.complete !== 'boolean') {
        throw new SkillError('unavailable');
      }
      if (result.complete) {
        hasCompleteCatalog = true;
        publish({ skills: result.skills, syncHealth: result.syncHealth ?? null, listError: result.syncError ?? null });
      } else if (!hasCompleteCatalog) {
        publish({ skills: result.skills, listError: 'incomplete' });
      } else {
        publish({ listError: 'incomplete' });
      }
    } catch (error) {
      if (reading === pending) publish({ listError: error.code ?? 'unavailable' });
    } finally {
      if (reading === pending) reading = undefined;
    }
  }

  async function mutate(action) {
    if (snapshot.busy || stopped) return false;
    cancelRefresh();
    const pending = new AbortController();
    writing = pending;
    publish({ busy: true, savingId: action.action === 'setEnabled' ? action.id : null, mutationError: null });
    try {
      await send({ ...action, workspaceId: null }, AbortSignal.any([pending.signal, AbortSignal.timeout(30000)]));
      if (writing !== pending || stopped) return false;
      writing = undefined;
      let { skills } = snapshot;
      if (skills && action.action === 'setEnabled') {
        skills = skills.map(skill => skill.id === action.id ? { ...skill, enabled: action.enabled } : skill);
      } else if (skills && action.action === 'remove') {
        skills = skills.filter(skill => skill.id !== action.id);
      }
      publish({ skills, busy: false, savingId: null });
      void refresh();
      return true;
    } catch (error) {
      if (writing !== pending || stopped) return false;
      writing = undefined;
      publish({ mutationError: error.code ?? 'unavailable', busy: false, savingId: null });
      if (error.code === 'conflict' || error.code === 'not-found') void refresh();
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
      if (timer !== undefined) return;
      stopped = false;
      void refresh();
      timer = setInterval(() => {
        if (!reading) void refresh();
      }, 4000);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
      cancelRefresh();
      writing?.abort();
      writing = undefined;
      snapshot = { ...snapshot, busy: false, savingId: null };
    },
  };
}
