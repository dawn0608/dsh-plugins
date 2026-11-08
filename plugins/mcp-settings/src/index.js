/**
 * Host half of the MCP settings bundle.
 *
 * The page talks to two seats with one API: the authenticated connection
 * channel (`/api/mcp-settings`, which also works through the Electron shell's
 * fetch bridge) and a loopback route on the web server (fallback and the route
 * used by automated verification). Tool counts come from the live tool
 * registry, so the page can report discovery without claiming a connection.
 */

import { createApi, createFetchHandler, createWebHandler } from './routes.js';
import { createStore, resolveProfile } from './store.js';
import { logEvent } from './log.js';

const PLAIN_PATH = '/plugin/mcp-settings';
const CHANNEL_PATH = '/api/mcp-settings';

export const inject = ['webServer', 'connection'];

export function apply(ctx, config) {
  const patchPath = config && typeof config === 'object' && typeof config.patchPath === 'string'
    ? config.patchPath
    : undefined;
  const profile = () => resolveProfile({ patchPath });

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

  const store = createStore({ profile, countTools, log: logEvent });
  const api = createApi({ store, log: logEvent });

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PLAIN_PATH,
    handler: createWebHandler(api),
  }), 'mcp-settings: loopback route');

  ctx.effect(() => ctx.connection.fetch.register({
    path: CHANNEL_PATH,
    methods: ['GET', 'HEAD', 'POST'],
    requestBody: 'buffered',
    fetch: createFetchHandler(api),
  }), 'mcp-settings: connection route');

  logEvent('ready', {});
}
