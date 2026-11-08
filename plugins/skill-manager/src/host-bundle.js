import { parse } from 'yaml';

export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 256;
const BINARY_SAMPLE_BYTES = 8192;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_PATH = /^(?:con|prn|aux|nul|(?:com|lpt)[1-9¹²³])(?:\.|$)/i;
const INVALID_PATH = /[<>:"\\|?*\p{Cc}\p{Cs}]/u;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
export const MANAGED_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
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

export function isManagedName(value) {
  return isSkillName(value) && value.length <= 250 && !RESERVED_PATH.test(value);
}

export function foldPath(value) {
  return value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
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

export function validateBundle(files) {
  if (!Array.isArray(files) || files.length === 0) throw new ManagerError('invalid');
  if (files.length > MAX_FILES) throw new ManagerError('too-large');

  const paths = new Map();
  const entries = new Map();
  let bytesUsed = 0;

  for (const file of files) {
    if (!isRecord(file) || Object.keys(file).length !== 2 || typeof file.path !== 'string' || typeof file.data !== 'string') {
      throw new ManagerError('invalid');
    }
    const { path, data } = file;
    const parts = path.split('/');
    if (Buffer.byteLength(path) > 1024 || parts.some(part =>
      !part || part === '.' || part === '..' || /[ .]$/.test(part) ||
      Buffer.byteLength(part) > 255 || INVALID_PATH.test(part) || RESERVED_PATH.test(part))) {
      throw new ManagerError('invalid');
    }

    // Store directory spellings as well as file names so different prefixes
    // cannot merge on a case-insensitive or normalization-insensitive volume.
    let prefix = '';
    for (const [index, part] of parts.entries()) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const key = foldPath(prefix);
      const leaf = index === parts.length - 1;
      const existing = paths.get(key);
      if (existing && (existing.path !== prefix || existing.leaf || leaf)) throw new ManagerError('invalid');
      paths.set(key, { path: prefix, leaf });
    }

    if (data.length % 4 !== 0 || !BASE64.test(data)) throw new ManagerError('invalid');
    const padding = data.endsWith('==') ? 2 : Number(data.endsWith('='));
    bytesUsed += data.length / 4 * 3 - padding;
    if (bytesUsed > MAX_BUNDLE_BYTES) throw new ManagerError('too-large');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.toString('base64') !== data) throw new ManagerError('invalid');
    entries.set(path, bytes);
  }

  const skillFile = entries.get('SKILL.md');
  if (!skillFile) throw new ManagerError('invalid');
  const skill = parseSkillFile(skillFile);
  if (!isManagedName(skill.name)) throw new ManagerError('invalid');
  return { ...skill, entries };
}
