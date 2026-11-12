import { isRecord, ManagerError, skillId } from './skill.js';
import { readProvenance } from './host-provenance.js';

export const ROUTE = '/api/skill-manager';
const MAX_REQUEST_BYTES = 16 * 1024;
const ACTION_FIELDS = new Map([
  ['list', []], ['detail', ['id']],
]);

function skillProvenance(skill, provenance) {
  return skill.source === 'bundled' ? { origin: 'builtin' } : provenance(skill);
}

export function createSkillManager({ agentsHome, skills, agentPresets }) {
  async function scoped(signal, operation) {
    let lease;
    try { lease = await agentPresets.acquireScope(); }
    catch { throw new ManagerError('unavailable'); }
    try {
      signal?.throwIfAborted();
      return await operation({ signal, scope: lease.key });
    } finally { await lease[Symbol.asyncDispose](); }
  }

  async function snapshot(options) {
    try { return await skills.snapshot(options); }
    catch { throw new ManagerError('unavailable'); }
  }

  return async (payload, signal) => {
    if (!isRecord(payload)) throw new ManagerError('invalid');
    const fields = ACTION_FIELDS.get(payload.action);
    if (!fields || Object.keys(payload).some(key => key !== 'action' && !fields.includes(key))) {
      throw new ManagerError('invalid');
    }
    if (payload.action !== 'list' && (typeof payload.id !== 'string' || !/^[a-f0-9]{64}$/.test(payload.id))) {
      throw new ManagerError('invalid');
    }
    return scoped(signal, async options => {
      const { skills: entries, complete } = await snapshot(options);
      if (payload.action === 'list') {
        const provenance = await readProvenance(agentsHome);
        return {
          skills: entries.map(skill => ({
            id: skillId(skill), name: skill.name, description: skill.description,
            source: skill.source, ...skillProvenance(skill, provenance),
          })),
          complete,
        };
      }
      const entry = entries.find(skill => skillId(skill) === payload.id);
      if (!entry) throw new ManagerError(complete ? 'not-found' : 'incomplete');
      const actual = await skills.get(entry.name, options);
      if (!actual || skillId(actual) !== payload.id) throw new ManagerError('conflict');
      return { body: actual.content, ...skillProvenance(actual, await readProvenance(agentsHome)) };
    });
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
  ['invalid', 400], ['forbidden', 403], ['not-found', 404], ['conflict', 409],
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
