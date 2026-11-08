export class SkillError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const HOST_ERRORS = new Set([
  'invalid', 'conflict', 'not-found',
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
