export class SkillError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const HOST_ERRORS = new Set([
  'invalid', 'duplicate', 'too-large', 'conflict', 'not-found',
  'unavailable', 'forbidden', 'internal', 'incomplete',
]);

export async function request(body, signal, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl('api/skill-manager', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-dsh-skill-manager': '1',
      },
      cache: 'no-store',
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new SkillError('unavailable');
  }
  const result = await response.json().catch(() => null);
  if (result?.ok === false && HOST_ERRORS.has(result.code)) throw new SkillError(result.code);
  if (response.ok && result?.ok === true) return result.value;
  throw new SkillError([401, 403].includes(response.status) ? 'forbidden' : 'unavailable');
}

export async function readSelection(selection, kind) {
  if (!selection.length) throw new SkillError('invalid');
  if (selection.length > 256) throw new SkillError('too-large');
  const files = Array.from(selection);
  if (files.reduce((size, file) => size + file.size, 0) > 8 * 1024 * 1024) {
    throw new SkillError('too-large');
  }

  let source = 'SKILL.md';
  let paths = [source];
  if (kind === 'folder') {
    const relativePaths = files.map(file => file.webkitRelativePath);
    source = relativePaths[0]?.split('/')[0];
    const prefix = source + '/';
    if (!source || !relativePaths.every(path => path?.startsWith(prefix))) throw new SkillError('invalid');
    paths = relativePaths.map(path => path.slice(prefix.length));
    if (!paths.includes('SKILL.md')) throw new SkillError('invalid');
  } else if (files.length !== 1 || files[0].name !== source) {
    throw new SkillError('invalid');
  }

  const encoded = [];
  for (const [index, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    encoded.push({ path: paths[index], data: btoa(binary) });
  }
  return { source, files: encoded };
}
