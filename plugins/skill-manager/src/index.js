import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFetchHandler, createSkillManager, ROUTE } from './host.js';

export const inject = ['agentPresets', 'connection', 'skills', 'workspaceRegistry'];

function resolveHome(configured, fallback) {
  return configured?.trim() ? resolve(
    configured === '~' ? homedir() : /^~[/\\]/.test(configured) ? join(homedir(), configured.slice(2)) : configured,
  ) : join(homedir(), fallback);
}

export function apply(ctx) {
  const manager = createSkillManager({
    home: resolveHome(process.env.DSH_HOME, '.dsh'),
    agentsHome: resolveHome(process.env.DSH_AGENTS_HOME, '.agents'),
    skills: ctx.skills, workspaceRegistry: ctx.workspaceRegistry, agentPresets: ctx.agentPresets,
  });
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: createFetchHandler(manager),
  }), 'skill-manager: connection route');
}
