import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFetchHandler, createSkillManager, ROUTE } from './host.js';

export const inject = ['agentPresets', 'connection', 'skills', 'workspaceRegistry'];

export function apply(ctx) {
  const configured = process.env.DSH_HOME;
  const home = configured?.trim() ? resolve(
    configured === '~' ? homedir() : /^~[/\\]/.test(configured) ? join(homedir(), configured.slice(2)) : configured,
  ) : join(homedir(), '.dsh');
  const manager = createSkillManager({
    home, skills: ctx.skills, workspaceRegistry: ctx.workspaceRegistry, agentPresets: ctx.agentPresets,
  });
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: createFetchHandler(manager),
  }), 'skill-manager: connection route');
}
