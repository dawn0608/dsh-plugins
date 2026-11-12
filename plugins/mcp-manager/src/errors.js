/** Stable error shapes shared by the patch editor, the writer and the routes. */

export class PatchError extends Error {
  constructor(code, params) {
    super(code);
    this.name = 'PatchError';
    this.code = code;
    this.params = params;
  }
}
