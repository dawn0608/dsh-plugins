import { isAbsolute, join, normalize } from 'node:path';
import { isManagedName, isRecord, isSkillName, ManagerError, MANAGED_ID, validateBundle } from './host-bundle.js';
import { readProvenance } from './host-provenance.js';
import { createSkillStore } from './host-store.js';
import { readSyncState, requestSync, sharedPolicyEnabled } from './shared-sync.js';

export const ROUTE = '/api/skill-manager';
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const ACTION_FIELDS = new Map([
  ['list', []],
  ['detail', ['id']],
  ['inspect', ['files']],
  ['import', ['files', 'expectedName']],
  ['setEnabled', ['id', 'enabled']],
  ['remove', ['id']],
]);
const SOURCES = new Map([
  ['project-dsh', 'workspace'],
  ['project-agents', 'workspace'],
  ['custom', 'local'],
  ['user-dsh', 'local'],
  ['user-agents', 'local'],
  ['bundled', 'builtin'],
  ['runtime', 'local'],
]);

function workspaceOptions(registry, id, signal) {
  if (id === undefined || id === null) return { cwd: undefined, signal };
  if (typeof id !== 'string' || id.length === 0 || id.length > 256 || /[/\\\p{Cc}]/u.test(id)) {
    throw new ManagerError('invalid');
  }
  const workspace = registry.get(id);
  if (!workspace) throw new ManagerError('not-found');
  if (typeof workspace.path !== 'string' || !isAbsolute(workspace.path)) throw new ManagerError('unavailable');
  return { cwd: workspace.path, signal };
}

function parseId(id) {
  if (typeof id !== 'string') throw new ManagerError('invalid');
  const [kind, name, installId, extra] = id.split(':');
  if (kind === 'managed' && extra === undefined && isManagedName(name) &&
      installId !== undefined && MANAGED_ID.test(installId)) return { kind, name, installId };
  if (kind === 'catalog' && installId === undefined && isSkillName(name)) return { kind, name };
  throw new ManagerError('invalid');
}

function skillProvenance(skill, provenance) {
  return skill.source === 'bundled' ? { origin: 'builtin' } : provenance(skill);
}

function catalogRow(skill, provenance, shared) {
  const origin = skillProvenance(skill, provenance)?.origin;
  return {
    id: `catalog:${skill.name}`,
    name: skill.name,
    description: skill.description,
    group: SOURCES.get(skill.source) ?? 'local',
    source: SOURCES.has(skill.source) ? skill.source : 'other',
    enabled: skill.source === 'user-agents' && typeof sharedPolicyEnabled(shared?.[skill.path]) === 'boolean'
      ? sharedPolicyEnabled(shared[skill.path]) : null,
    shadowed: false,
    ...(origin && { origin }),
  };
}

function matchesManaged(skill, managed) {
  if (!skill || skill.source !== 'user-dsh' || typeof skill.path !== 'string') return false;
  if (!managed.enabled && !managed.activeMissing) return false;
  const path = normalize(skill.path);
  return path === managed.resolvedFile || path === join(managed.bundle, 'SKILL.md') ||
    path === join(managed.active, 'SKILL.md');
}

export function createSkillManager({ home, agentsHome, skills, workspaceRegistry, agentPresets }) {
  const store = createSkillStore(home);

  async function scoped(options, operation) {
    let lease;
    try {
      lease = await agentPresets.acquireScope();
    } catch {
      throw new ManagerError('unavailable');
    }
    try {
      options.signal?.throwIfAborted();
      return await operation({ ...options, scope: lease.key });
    } finally {
      await lease[Symbol.asyncDispose]();
    }
  }

  async function snapshot(options) {
    try {
      return await skills.snapshot(options);
    } catch {
      throw new ManagerError('unavailable');
    }
  }

  async function load(name, options) {
    try {
      return await skills.get(name, options);
    } catch {
      throw new ManagerError('unavailable');
    }
  }

  async function list(options) {
    const workspaces = workspaceRegistry.list().map(({ id, title }) => ({ id, title }));
    const [catalog, provenance, sync] = await Promise.all([
      snapshot(options), readProvenance(agentsHome), readSyncState(home).catch(() => ({ error: 'unavailable' })),
    ]);
    const managed = store.list();
    const byName = new Map(catalog.skills.map(skill => [skill.name, skill]));
    const rows = [];
    for (const skill of managed.skills) {
      const match = byName.get(skill.name);
      const ownWinner = matchesManaged(match, skill);
      if (ownWinner) byName.delete(skill.name);
      rows.push({
        id: `managed:${skill.name}:${skill.id}`,
        name: skill.name,
        description: skill.description,
        group: 'imported',
        source: 'managed',
        enabled: skill.enabled,
        shadowed: skill.enabled && Boolean(match) && !ownWinner,
      });
    }
    rows.push(...[...byName.values()].map(skill => catalogRow(skill, provenance, sync?.entries)));
    rows.sort((left, right) => left.name.localeCompare(right.name) || Number(right.group === 'imported') - Number(left.group === 'imported'));
    const syncError = sync?.error ?? Object.values(sync?.entries ?? {}).find(entry => entry.error)?.error;
    const stopped = sync && !sync.error && (!Number.isFinite(Date.parse(sync.health?.lastAttemptAt)) || Date.now() - Date.parse(sync.health.lastAttemptAt) > 15000);
    const healthError = stopped ? 'sharedStopped' : sync?.health?.status === 'unavailable' ? 'sharedUnavailable' : null;
    return {
      ...(sync?.health && { syncHealth: sync.health }),
      skills: rows, workspaces, complete: catalog.complete && managed.complete,
      ...((healthError || syncError) && { syncError: healthError ?? (syncError === 'conflict' ? 'sharedConflict' : 'sharedUnavailable') }),
    };
  }

  async function detail(id, options) {
    const { kind, name, installId } = parseId(id);
    if (kind === 'managed') {
      const managed = store.read(name, installId);
      if (managed.enabled) {
        const actual = await load(name, options);
        if (matchesManaged(actual, managed)) return { body: actual.content };
      }
      return { body: managed.body };
    }
    const [actual, provenance] = await Promise.all([load(name, options), readProvenance(agentsHome)]);
    if (actual) return { body: actual.content, ...skillProvenance(actual, provenance) };
    throw new ManagerError((await snapshot(options)).complete ? 'not-found' : 'incomplete');
  }

  return async (payload, signal) => {
    if (!isRecord(payload)) throw new ManagerError('invalid');
    const { action, workspaceId } = payload;
    const fields = ACTION_FIELDS.get(action);
    if (!fields || Object.keys(payload).some(key => key !== 'action' && key !== 'workspaceId' && !fields.includes(key))) {
      throw new ManagerError('invalid');
    }
    const options = workspaceOptions(workspaceRegistry, workspaceId, signal);
    switch (action) {
      case 'list': return scoped(options, list);
      case 'detail': return scoped(options, scopedOptions => detail(payload.id, scopedOptions));
      case 'inspect': {
        const { name, description } = validateBundle(payload.files);
        return { name, description };
      }
      case 'import': {
        const skill = validateBundle(payload.files);
        if (skill.name !== payload.expectedName) throw new ManagerError('invalid');
        const catalog = await scoped({ cwd: undefined, signal }, snapshot);
        if (!catalog.complete) throw new ManagerError('incomplete');
        if (catalog.skills.some(entry => entry.name === skill.name)) throw new ManagerError('duplicate');
        signal?.throwIfAborted();
        store.install(skill);
        return null;
      }
      case 'setEnabled':
      case 'remove': {
        const { kind, name, installId } = parseId(payload.id);
        if (kind === 'catalog' && action === 'setEnabled') {
          if (typeof payload.enabled !== 'boolean') throw new ManagerError('invalid');
          return scoped(options, async scopedOptions => {
            const skill = await load(name, scopedOptions);
            const sync = await readSyncState(home);
            if (skill?.source !== 'user-agents' || !sync?.entries[skill.path]) throw new ManagerError('forbidden');
            signal?.throwIfAborted();
            await requestSync(home, { type: 'set', path: skill.path, enabled: payload.enabled });
            return null;
          });
        }
        if (kind !== 'managed') throw new ManagerError('forbidden');
        signal?.throwIfAborted();
        if (action === 'setEnabled') {
          if (typeof payload.enabled !== 'boolean') throw new ManagerError('invalid');
          store.setEnabled(name, installId, payload.enabled);
        } else {
          store.remove(name, installId);
        }
        return null;
      }
    }
  };
}

async function readJson(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_REQUEST_BYTES) throw new ManagerError('too-large');
  if (!request.body) throw new ManagerError('invalid');
  const reader = request.body.getReader();
  let body = Buffer.alloc(0);
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const needed = size + value.byteLength;
      if (needed > MAX_REQUEST_BYTES) throw new ManagerError('too-large');
      if (needed > body.length) {
        const grown = Buffer.allocUnsafe(Math.min(MAX_REQUEST_BYTES, Math.max(4096, body.length * 2, needed)));
        body.copy(grown, 0, 0, size);
        body = grown;
      }
      body.set(value, size);
      size = needed;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, size)));
  } catch (error) {
    if (error instanceof ManagerError) throw error;
    throw new ManagerError('invalid');
  } finally {
    // The Harness carrier closes the connection for an unread streaming body.
    // Cancelling its reader here would destroy the socket before the reply.
    reader.releaseLock();
  }
}

function response(status, envelope) {
  return Response.json(envelope, { status, headers: { 'cache-control': 'no-store' } });
}

const STATUS = new Map([
  ['invalid', 400], ['forbidden', 403], ['not-found', 404], ['conflict', 409], ['duplicate', 409],
  ['too-large', 413], ['unavailable', 503], ['incomplete', 503],
]);

export function createFetchHandler(manager) {
  return async request => {
    if (new URL(request.url).pathname !== ROUTE) return response(404, { ok: false, code: 'not-found' });
    if (request.method !== 'POST') return response(405, { ok: false, code: 'forbidden' });
    if (request.headers.get('x-dsh-skill-manager') !== '1') return response(403, { ok: false, code: 'forbidden' });
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return response(415, { ok: false, code: 'invalid' });
    }
    try {
      const payload = await readJson(request);
      return response(200, { ok: true, value: await manager(payload, request.signal) });
    } catch (error) {
      const code = error instanceof ManagerError ? error.code : 'internal';
      return response(STATUS.get(code) ?? 500, { ok: false, code });
    }
  };
}
