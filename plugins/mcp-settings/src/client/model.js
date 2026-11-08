/** Form shape ↔ API draft, validation context, and localized field errors. */

import { normalizeDraft, validateDraft } from '../shared/draft.js';

export const ERROR_KEYS = {
  required: 'required',
  'name-format': 'nameFormat',
  'name-reserved': 'nameReserved',
  duplicate: 'nameDuplicate',
  'command-invalid': 'commandInvalid',
  'args-invalid': 'argsInvalid',
  'cwd-invalid': 'cwdInvalid',
  'url-invalid': 'urlInvalid',
  'env-name-invalid': 'envNameInvalid',
  'header-name-invalid': 'headerNameInvalid',
  'value-invalid': 'valueInvalid',
  'ref-variable-invalid': 'refVariableInvalid',
  'ref-prefix-invalid': 'refPrefixInvalid',
  'keep-unavailable': 'keepUnavailable',
  'transport-invalid': 'transportInvalid',
};

/** Pairs the API reports as hidden keep their current value instead of a literal. */
export function pairToForm(pair) {
  if (pair.mode === 'ref') {
    return { key: pair.key, mode: 'ref', variable: pair.variable || '', prefix: pair.prefix || '', value: '' };
  }
  if (pair.mode === 'literal' && pair.secret !== true && typeof pair.value === 'string') {
    return { key: pair.key, mode: 'literal', value: pair.value, variable: '', prefix: '' };
  }
  return { key: pair.key, mode: 'keep', value: '', variable: '', prefix: '' };
}

export function blankPair() {
  return { key: '', mode: 'literal', value: '', variable: '', prefix: '' };
}

/** Convert one server from the API state into the editable form. */
export function serverToForm(server) {
  const config = server.config && typeof server.config === 'object' ? server.config : {};
  if (server.transport === 'streamable-http') {
    return {
      name: server.name || '',
      transport: 'streamable-http',
      enabled: server.enabled !== false,
      command: '',
      argsText: '',
      cwd: '',
      url: typeof config.url === 'string' ? config.url : '',
      env: [],
      headers: (Array.isArray(config.headers) ? config.headers : []).map(pairToForm),
    };
  }
  return {
    name: server.name || '',
    transport: 'stdio',
    enabled: server.enabled !== false,
    command: typeof config.command === 'string' ? config.command : '',
    argsText: Array.isArray(config.args) ? config.args.join('\n') : '',
    cwd: typeof config.cwd === 'string' ? config.cwd : '',
    url: '',
    env: (Array.isArray(config.env) ? config.env : []).map(pairToForm),
    headers: [],
  };
}

export function blankForm(transport = 'stdio') {
  return {
    name: '',
    transport,
    enabled: true,
    command: '',
    argsText: '',
    cwd: '',
    url: '',
    env: [],
    headers: [],
  };
}

/** Convert the form into the draft the Host validates and writes. */
export function formToDraft(form) {
  const args = String(form.argsText || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  const stdio = form.transport === 'stdio';
  return normalizeDraft({
    name: form.name,
    transport: form.transport,
    enabled: form.enabled,
    command: stdio ? form.command : '',
    args: stdio ? args : [],
    cwd: stdio ? form.cwd : '',
    env: stdio ? form.env : [],
    url: stdio ? '' : form.url,
    headers: stdio ? [] : form.headers,
  });
}

/** Validation context for one save. */
export function contextFor(servers, target) {
  const names = (Array.isArray(servers) ? servers : [])
    .map(server => server.name)
    .filter(name => typeof name === 'string');
  const config = target && target.config && typeof target.config === 'object' ? target.config : {};
  return {
    names,
    selfName: target && typeof target.name === 'string' ? target.name : undefined,
    existingEnvKeys: (Array.isArray(config.env) ? config.env : []).map(pair => pair.key),
    existingHeaderKeys: (Array.isArray(config.headers) ? config.headers : []).map(pair => pair.key),
  };
}

/** Shared validation, used for immediate feedback before the Host call. */
export function validateForm(form, context) {
  return validateDraft(formToDraft(form), context);
}

/** Localized text for one error code, with its safe params. */
export function errorText(translate, error) {
  const key = ERROR_KEYS[error && error.code] || 'invalid';
  return translate(key, error && error.params ? error.params : undefined);
}

/** Split one field path into its pair index and side, e.g. `env[2].value`. */
export function fieldLocation(field) {
  if (typeof field !== 'string') return undefined;
  const match = /^(env|headers)\[(\d+)\]\.(key|value)$/.exec(field);
  if (!match) return { field };
  return { group: match[1], index: Number(match[2]), side: match[3], field };
}

/** Format servers for a compact summary line. */
export function serverLabel(server, translate) {
  if (server && typeof server.name === 'string' && server.name !== '') return server.name;
  if (server && typeof server.id === 'string' && server.id !== '') return server.id;
  return translate('unknownName');
}

export const ERROR_SUMMARY = 'errorSummary';
