/** Host endpoint on the authenticated connection channel. */

import { createApi, createFetchHandler } from './routes.js';
import { createStore, resolveProfile } from './store.js';
import { logEvent } from './log.js';
import { createSharedRemoval } from './shared-sync.js';

const CHANNEL_PATH = '/api/mcp-manager';

export const inject = ['connection'];

export function apply(ctx, config) {
  const patchPath = config && typeof config === 'object' && typeof config.patchPath === 'string'
    ? config.patchPath
    : undefined;
  // Older compositions may not provide profileContext.
  const profile = () => resolveProfile({
    patchPath,
    profileContext: patchPath ? undefined : ctx.get('profileContext'),
  });

  const countTools = name => {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.definitions !== 'function') return null;
    try {
      const prefix = `mcp__${name}__`;
      let count = 0;
      for (const definition of tools.definitions()) {
        if (definition && typeof definition.name === 'string' && definition.name.startsWith(prefix)) count += 1;
      }
      return count;
    } catch (error) {
      return null;
    }
  };

  const removeShared = patchPath ? undefined : createSharedRemoval(config?.sharedSync);
  const store = createStore({ profile, countTools, log: logEvent, removeShared });
  const api = createApi({ store, log: logEvent });

  ctx.effect(() => ctx.connection.fetch.register({
    path: CHANNEL_PATH,
    methods: ['GET', 'HEAD', 'POST'],
    requestBody: 'buffered',
    fetch: createFetchHandler(api),
  }), 'mcp-manager: connection route');

  logEvent('ready', {});
}
