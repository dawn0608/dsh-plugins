import { parse } from 'yaml';

const BINARY_SAMPLE_BYTES = 8192;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOLEAN = /^(?:true|false|yes|no|on|off|0|1)$/i;

export class ManagerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSkillName(value) {
  return typeof value === 'string' && SKILL_NAME.test(value);
}

/** Match the Harness filesystem provider's frontmatter and invocation grammar. */
export function parseSkillFile(bytes) {
  try {
    if (bytes.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) throw new ManagerError('invalid');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const start = /^---\r?\n/.exec(raw);
    if (!start) throw new ManagerError('invalid');
    const rest = raw.slice(start[0].length);
    const end = /(^|\n)---\r?(?=\n|$)/.exec(rest);
    if (!end) throw new ManagerError('invalid');

    const data = parse(rest.slice(0, end.index + end[1].length), { logLevel: 'silent' });
    if (!isRecord(data) || !isSkillName(data.name) || typeof data.description !== 'string' || data.description.length === 0) {
      throw new ManagerError('invalid');
    }
    if (['disableModelInvocation', 'modelInvocable', 'userInvocable'].some(key => Object.hasOwn(data, key))) {
      throw new ManagerError('invalid');
    }
    for (const key of ['disable-model-invocation', 'user-invocable']) {
      if (!Object.hasOwn(data, key)) continue;
      const value = data[key];
      if (typeof value !== 'boolean' && value !== 0 && value !== 1 && !(typeof value === 'string' && BOOLEAN.test(value))) {
        throw new ManagerError('invalid');
      }
    }
    return { name: data.name, description: data.description, body: rest.slice(end.index + end[0].length).trim() };
  } catch {
    throw new ManagerError('invalid');
  }
}
