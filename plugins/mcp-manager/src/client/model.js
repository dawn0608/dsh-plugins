/** Localized labels for the service list. */

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
  return null;
}
