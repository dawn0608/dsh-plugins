/** Reads session costs and account balances from the Host. */

const STATE_PATH = '/plugin/cost-overview/state';
const CHANNEL_URL = 'api/cost-overview/state';

/**
 * Candidate state URLs for this page. The Web carrier answers the plain
 * route directly; the connection channel is the same `api/...` form the RPC
 * transport uses, so a mounted page and a static desktop page both reach it.
 */
export function stateCandidates(sessionId) {
  const query = sessionId === undefined ? '' : `?session=${encodeURIComponent(String(sessionId))}`;
  const urls = [];
  const transport = window.__DSH_TRANSPORT__;
  if (transport && typeof transport.streamBaseUrl === 'string' && transport.streamBaseUrl !== '') {
    try {
      const url = new URL(transport.streamBaseUrl, location.href);
      const scheme = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
      urls.push(`${scheme}//${url.host}${STATE_PATH}${query}`);
    } catch (error) {
      // Fall through to the document origin.
    }
  }
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    urls.push(`${location.origin}${STATE_PATH}${query}`);
  }
  urls.push(`${CHANNEL_URL}${query}`);
  return urls.filter((value, index) => urls.indexOf(value) === index);
}

export function walletTotal(wallet) {
  if (Number.isFinite(wallet.total) && wallet.total > 0) return wallet.total;
  return (Number(wallet.toppedUp) || 0) + (Number(wallet.granted) || 0);
}

/** How often one Session's state may be re-read; the Host adds its own caches. */
export const REFRESH_MIN_MS = 500;

/**
 * Shared state reader. The balance is account-wide, the cost is per Session,
 * so a snapshot is only valid for the Session it was read for: switching
 * Sessions drops the old cost immediately instead of showing another
 * Session's numbers while the new read is in flight.
 */
export function createBalanceStore() {
  let snapshot = {
    sessionId: undefined,
    status: 'idle',
    wallets: [],
    reason: undefined,
    at: 0,
    cost: undefined,
    pricing: undefined,
  };
  const listeners = new Set();
  let pending = null;
  let lastReadAt = 0;

  const publish = next => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  async function read(sessionId, force) {
    const now = Date.now();
    const switched = snapshot.sessionId !== sessionId;
    if (switched) {
      pending = null;
      publish({
        sessionId,
        status: snapshot.wallets.length > 0 ? snapshot.status : 'loading',
        wallets: snapshot.wallets,
        reason: snapshot.reason,
        at: 0,
        cost: undefined,
        pricing: snapshot.pricing,
      });
    }
    if (!force && !switched && now - lastReadAt < REFRESH_MIN_MS) return;
    if (pending !== null) return pending;
    lastReadAt = now;

    const candidates = stateCandidates(sessionId);
    const emit = next => {
      if (snapshot.sessionId !== sessionId) return;
      publish({ ...next, sessionId });
    };

    if (candidates.length === 0) {
      emit({ status: 'unavailable', wallets: [], reason: 'no-endpoint', at: now, cost: undefined, pricing: snapshot.pricing });
      return;
    }
    if (snapshot.status !== 'ready') emit({ ...snapshot, status: 'loading' });

    const request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      try {
        let payload;
        let reason = 'network';
        for (const url of candidates) {
          try {
            const response = await fetch(url, {
              cache: 'no-store',
              headers: { accept: 'application/json' },
              signal: controller.signal,
            });
            if (!response.ok) {
              reason = response.status === 401 ? 'unauthorized' : 'network';
              continue;
            }
            const body = await response.json();
            if (body && typeof body === 'object' && body.balance !== undefined) {
              payload = body;
              break;
            }
            reason = 'failed';
          } catch (error) {
            reason = error && error.name === 'AbortError' ? 'timeout' : 'network';
          }
        }
        if (payload === undefined) {
          emit({ status: 'unavailable', wallets: [], reason, at: Date.now(), cost: undefined, pricing: snapshot.pricing });
          return;
        }
        const value = payload.balance || {};
        const cost = payload.cost;
        const pricing = payload.pricing;
        if (value.ok !== true) {
          emit({
            status: 'unavailable',
            wallets: [],
            reason: typeof value.reason === 'string' ? value.reason : 'failed',
            at: Date.now(),
            cost,
            pricing,
          });
          return;
        }
        const wallets = Array.isArray(value.wallets) ? value.wallets : [];
        if (wallets.length === 0) {
          emit({ status: 'unavailable', wallets: [], reason: 'no-wallet', at: Date.now(), cost, pricing });
          return;
        }
        emit({ status: 'ready', wallets, reason: undefined, at: Date.now(), cost, pricing });
      } catch (error) {
        emit({ status: 'unavailable', wallets: [], reason: 'failed', at: Date.now(), cost: undefined, pricing: snapshot.pricing });
      } finally {
        clearTimeout(timer);
      }
    })();
    pending = request;
    const settle = () => {
      if (pending === request) pending = null;
    };
    request.then(settle, settle);
    return request;
  }

  return {
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: options => read(
      options && options.sessionId !== undefined ? options.sessionId : undefined,
      Boolean(options && options.force),
    ),
  };
}
