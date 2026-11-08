/** Localized labels and status for the service list. */

/** Format servers for a compact summary line. */
export function serverLabel(server, translate) {
  if (server && typeof server.name === 'string' && server.name !== '') return server.name;
  if (server && typeof server.id === 'string' && server.id !== '') return server.id;
  return translate('unknownName');
}

/** Localized transport name for one server. */
export function transportLabel(server, translate) {
  if (server && server.transport === 'stdio') return translate('transportStdio');
  if (server && server.transport === 'streamable-http') return translate('transportHttp');
  return translate('transportUnknown');
}

/**
 * Visual state for the row's tool status.
 * @returns {{tone: 'success'|'warn'|'muted', text: string, dot: boolean}}
 */
export function serverStatus(server, translate) {
  if (server && server.enabled === false) {
    return { tone: 'muted', text: translate('disabled'), dot: false };
  }
  if (!server || server.tools === null || server.tools === undefined) {
    return { tone: 'muted', text: translate('toolsUnknown'), dot: false };
  }
  if (server.tools > 0) {
    return { tone: 'success', text: translate('tools', { count: server.tools }), dot: true };
  }
  return { tone: 'warn', text: translate('toolsNone'), dot: true };
}
