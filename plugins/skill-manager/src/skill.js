import { createHash } from 'node:crypto';
import { win32 } from 'node:path';

export class ManagerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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
