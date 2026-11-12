import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep, win32 } from 'node:path';
import { ManagerError, parseSkillFile } from './skill-file.js';

const RANKS = { 'user-dsh': 399, 'user-agents': 499 };
export const PROVIDER = 'skill-manager-local-policy';

// Windows realpath may expose a junction using a device prefix or different case.
export function normalizeSkillPath(path, platform = process.platform) {
  if (platform === 'win32') return win32.normalize(path.replace(/^\\\\\?\\/, '')).toLowerCase();
  return path;
}

export function skillId(skill) {
  return createHash('sha256').update(JSON.stringify([
    skill.source, normalizeSkillPath(skill.path ?? ''), skill.name,
  ])).digest('hex');
}

export function createLocalPolicy({ home, agentsHome, readSettings, updateSettings, readRecords = () => readSettings().disabledSkills }) {
  const roots = { 'user-dsh': join(home, 'skills'), 'user-agents': join(agentsHome, 'skills') };
  let invalidate = () => {};

  async function identity(skill) {
    if (!Object.hasOwn(RANKS, skill.source) || typeof skill.path !== 'string' || !isAbsolute(skill.path)) return;
    try {
      const [root, path] = await Promise.all([realpath(roots[skill.source]), realpath(skill.path)]);
      const part = relative(root, path);
      if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) return;
      return { source: skill.source, path: normalizeSkillPath(path), name: skill.name };
    } catch { return; }
  }

  async function definition(record, signal) {
    const current = await identity(record);
    if (!current || skillId(current) !== skillId(record)) return;
    try {
      signal?.throwIfAborted();
      await using file = await open(record.path, 'r');
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > 8 * 1024 * 1024) return;
      const parsed = parseSkillFile(await file.readFile({ signal }));
      if (parsed.name !== record.name) return;
      return {
        ...current, description: parsed.description, content: parsed.body,
        provider: PROVIDER, invocation: { modelInvocable: false, userInvocable: false },
        resourceBase: { kind: 'directory', path: dirname(record.path) },
      };
    } catch { return; }
  }

  return {
    state: readSettings,
    async describe(skill, settings = readSettings()) {
      const record = [PROVIDER, 'filesystem'].includes(skill.provider) ? await identity(skill) : undefined;
      return {
        id: skillId(record ?? skill),
        canToggle: Boolean(record && settings.writable),
        enabled: record ? !settings.disabledSkills.some(entry => skillId(entry) === skillId(record)) : null,
      };
    },
    revision: () => readSettings().revision,
    async setEnabled(skill, id, enabled, revision, signal) {
      const record = [PROVIDER, 'filesystem'].includes(skill.provider) ? await identity(skill) : undefined;
      if (!record) throw new ManagerError('forbidden');
      if (skillId(record) !== id) throw new ManagerError('conflict');
      const settings = readSettings();
      if (!settings.writable) throw new ManagerError('forbidden');
      if (settings.revision !== revision) throw new ManagerError('conflict');
      // Recheck the file as well as the registry's cached summary before writing.
      if (!await definition(record, signal)) throw new ManagerError('conflict');
      const next = settings.disabledSkills.filter(entry => skillId(entry) !== id);
      if (!enabled) next.push(record);
      signal?.throwIfAborted();
      try { await updateSettings(next, revision); }
      catch (error) {
        throw new ManagerError(error.code === 'SETTINGS_CONFLICT' ? 'conflict' : 'unavailable');
      } finally { invalidate(); }
    },
    invalidate: () => invalidate(),
    provider(control) {
      invalidate = control.invalidate;
      return {
        name: PROVIDER,
        async list({ signal }) {
          const candidates = [];
          for (const record of readRecords()) {
            const skill = await definition(record, signal);
            if (skill) candidates.push({ ...skill, rank: RANKS[record.source], locator: record });
          }
          return candidates;
        },
        get: (candidate, { signal }) => definition(candidate.locator, signal),
      };
    },
  };
}
