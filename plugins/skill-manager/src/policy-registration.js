import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { PROVIDER } from './policy.js';

export function resolveHome(configured, fallback) {
  return configured?.trim() ? resolve(
    configured === '~' ? homedir() : /^~[/\\]/.test(configured) ? join(homedir(), configured.slice(2)) : configured,
  ) : fallback;
}

// Register beside each native filesystem provider. A host-only provider loses
// to preset layers, regardless of its rank. Cordis owns both registration
// lifetimes; disposing this plugin also removes its borrowed registrations.
export function registerLocalPolicy(ctx, policy, { home, agentsHome }) {
  const registrations = new Map();
  const update = fiber => {
    if (fiber.runtime?.name !== 'skill-filesystem') return;
    if (fiber.state !== 2) {
      registrations.get(fiber)?.();
      registrations.delete(fiber);
      return;
    }
    if (registrations.has(fiber) || fiber.config.includeDefaultRoots === false
      || (fiber.config.providerName ?? 'filesystem') !== 'filesystem') return;
    const roots = {
      'user-dsh': join(resolveHome(fiber.config.dshHome, home), 'skills'),
      'user-agents': join(resolveHome(fiber.config.agentsHome, agentsHome), 'skills'),
    };
    const dispose = fiber.ctx.skills.registerProvider(control => policy.provider(control, `${PROVIDER}:${fiber.uid}`, roots));
    registrations.set(fiber, dispose);
  };
  ctx.on('internal/status', update, { global: true });
  ctx.effect(() => () => {
    for (const dispose of registrations.values()) dispose();
    registrations.clear();
  }, 'skill-manager: scoped policies');
  for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) update(fiber);
}
