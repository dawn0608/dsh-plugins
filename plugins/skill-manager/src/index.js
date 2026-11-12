import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { createFetchHandler, createSkillManager, ROUTE } from './host.js';
import { createLocalPolicy } from './policy.js';

export const inject = ['agentPresets', 'connection', 'skills', 'settings', 'configEditor'];
export const Config = z.object({
  disabledSkills: z.array(z.object({
    source: z.union(['user-dsh', 'user-agents']), path: z.string(), name: z.string(),
  })).default([]).volatile(),
});

function resolveHome(configured, fallback) {
  return configured?.trim() ? resolve(
    configured === '~' ? homedir() : /^~[/\\]/.test(configured) ? join(homedir(), configured.slice(2)) : configured,
  ) : join(homedir(), fallback);
}

export function apply(ctx, config) {
  const home = resolveHome(process.env.DSH_HOME, '.dsh');
  const agentsHome = resolveHome(process.env.DSH_AGENTS_HOME, '.agents');
  const descriptor = () => {
    const entry = ctx.configEditor.entries().find(entry => entry.fiber?.ctx.fiber === ctx.fiber);
    return ctx.settings.describe().find(row => row.ns === entry?.options.id);
  };
  const policy = createLocalPolicy({
    home, agentsHome,
    readRecords: () => config.disabledSkills.get(),
    readSettings: () => {
      const current = descriptor();
      return {
        disabledSkills: config.disabledSkills.get(), revision: current?.revision ?? -1,
        writable: ctx.settings.writable && Boolean(current),
      };
    },
    updateSettings: (disabledSkills, revision) => ctx.settings.update(descriptor()?.ns, { disabledSkills }, revision),
  });
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), 'skill-manager: settings');
  ctx.skills.registerProvider(control => policy.provider(control));
  ctx.on('loader/volatile-update', () => policy.invalidate());
  const manager = createSkillManager({ agentsHome, skills: ctx.skills, agentPresets: ctx.agentPresets, policy });
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE, methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(manager),
  }), 'skill-manager: connection route');
}
