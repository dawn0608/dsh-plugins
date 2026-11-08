/** Reads session costs and account balances from the Host connection. */
const STATE_URL = 'api/cost-overview/state';
const REQUEST_TIMEOUT_MS = 9000;
const REFRESH_MIN_MS = 500;

export function walletTotal(wallet) {
  if (Number.isFinite(wallet.total) && wallet.total > 0) return wallet.total;
  return (Number(wallet.toppedUp) || 0) + (Number(wallet.granted) || 0);
}

function unavailable(reason, cost, pricing) {
  return { status: 'unavailable', wallets: [], reason, cost, pricing };
}

async function readState(sessionId, signal) {
  const query = sessionId === undefined ? '' : `?session=${encodeURIComponent(String(sessionId))}`;
  const response = await fetch(STATE_URL + query, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
  if (response.status === 401 || response.status === 403) return unavailable('forbidden');
  if (!response.ok) return unavailable('network');

  const body = await response.json().catch(() => undefined);
  const value = body?.balance;
  if (!value || typeof value !== 'object') return unavailable('failed');

  const { cost, pricing } = body;
  if (value.ok !== true) {
    return unavailable(typeof value.reason === 'string' ? value.reason : 'failed', cost, pricing);
  }
  const wallets = Array.isArray(value.wallets) ? value.wallets : [];
  if (wallets.length === 0) return unavailable('no-wallet', cost, pricing);
  return { status: 'ready', wallets, reason: undefined, cost, pricing };
}

/** A mounted composer's reader. Only the active request generation may publish. */
export function createBalanceStore() {
  let snapshot = { sessionId: undefined, status: 'idle', wallets: [], at: 0 };
  const listeners = new Set();
  let pending;
  let generation = 0;
  let lastReadAt = 0;
  let disposed = false;

  const publish = next => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  function cancel() {
    generation += 1;
    const previous = pending;
    pending = undefined;
    previous?.controller.abort();
  }

  function refresh({ sessionId, force = false } = {}) {
    if (disposed) return;
    const switched = snapshot.sessionId !== sessionId;
    if (switched) cancel();
    if (pending) {
      pending.trailing = true;
      return pending.promise;
    }

    const now = Date.now();
    const loading = switched || snapshot.status === 'idle';
    if (!loading && !force && now - lastReadAt < REFRESH_MIN_MS) return;
    lastReadAt = now;

    const controller = new AbortController();
    const { signal } = controller;
    const request = { generation: ++generation, controller, trailing: false };
    pending = request;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    // A carrier may finish late or ignore AbortSignal. End the read on abort anyway.
    const aborted = new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    const emit = next => {
      if (request.generation === generation) publish({ ...next, sessionId, at: Date.now() });
    };
    request.promise = Promise.race([aborted, readState(sessionId, signal)])
      .then(emit, () => emit(unavailable(signal.aborted ? 'timeout' : 'network')))
      .finally(() => {
        clearTimeout(timer);
        if (request.generation !== generation) return;
        pending = undefined;
        if (request.trailing) refresh({ sessionId, force: true });
      });
    if (loading) publish({ sessionId, status: 'loading', wallets: [], at: 0 });
    return request.promise;
  }

  return {
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    dispose() {
      disposed = true;
      cancel();
      listeners.clear();
    },
  };
}
