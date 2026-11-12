import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFetchHandler, createSkillManager, ROUTE } from './host.js';

export const inject = ['agentPresets', 'connection', 'skills'];

export function apply(ctx) {
  const configured = process.env.DSH_AGENTS_HOME;
  const agentsHome = configured?.trim() ? resolve(
    configured === '~' ? homedir() : /^~[/\\]/.test(configured) ? join(homedir(), configured.slice(2)) : configured,
  ) : join(homedir(), '.agents');
  const manager = createSkillManager({ agentsHome, skills: ctx.skills, agentPresets: ctx.agentPresets });
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE, methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(manager),
  }), 'skill-manager: connection route');
}
