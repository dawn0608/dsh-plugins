/** One MCP server row: identity, transport, endpoint summary, state and actions. */

import * as React from 'react';
import { serverLabel, serverStatus, serverSummary, transportLabel } from './model.js';

const h = React.createElement;

/** Locale keys for the reasons a row is not editable. */
export const READ_ONLY_KEYS = {
  'not-insert': 'readOnlyNotInsert',
  'block-shape': 'readOnlyBlockShape',
  'row-shape': 'readOnlyRowShape',
  'missing-id': 'readOnlyMissingId',
  'duplicate-id': 'readOnlyDuplicateId',
  'conditional-disabled': 'readOnlyConditional',
  'missing-name': 'readOnlyMissingName',
  'config-invalid': 'readOnlyConfig',
  'config-enabled': 'readOnlyConfigEnabled',
};

function Tag({ children, tone, title }) {
  return h('span', {
    className: 'dshmcp_tag',
    'data-tone': tone,
    title,
  }, children);
}

/**
 * @param {{server: object, translate: Function, busy: object | null, onEdit: Function, onDelete: Function, onToggle: Function}} props
 */
export function ServerRow(props) {
  const { server, translate, busy, onEdit, onDelete, onToggle, onRegisterEdit } = props;
  const name = serverLabel(server, translate);
  const readOnlyText = server.editable
    ? null
    : translate(READ_ONLY_KEYS[server.readOnlyCode] || 'readOnlyConfig');
  const summary = serverSummary(server);
  const status = serverStatus(server, translate);
  const rowBusy = busy && busy.id === server.id ? busy.action : null;
  const metaText = readOnlyText || summary;

  return h('li', { className: 'dshmcp_card dshmcp_row', 'data-disabled': server.enabled === false ? 'true' : undefined },
    h('div', { className: 'dshmcp_rowHead' },
      h('div', { className: 'dshmcp_identity' },
        h('span', { className: 'dshmcp_name', title: name }, name),
        h(Tag, { tone: 'neutral' }, transportLabel(server, translate)),
        server.duplicate
          ? h(Tag, { tone: 'warn', title: translate('duplicateHint') }, translate('duplicate'))
          : null,
        readOnlyText
          ? h(Tag, { tone: 'muted', title: readOnlyText }, translate('readOnly'))
          : null,
      ),
      h('div', { className: 'dshmcp_actions' },
        server.editable && server.enabled !== null
          ? h('button', {
            type: 'button',
            role: 'switch',
            className: 'dshmcp_switch',
            'aria-checked': server.enabled === false ? 'false' : 'true',
            'aria-label': translate(server.enabled === false ? 'enableServer' : 'disableServer', { name }),
            disabled: Boolean(rowBusy),
            onClick: () => onToggle(server),
          }, h('span', { className: 'dshmcp_switchThumb', 'aria-hidden': true }))
          : null,
        server.editable
          ? h('button', {
            type: 'button',
            className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonOutline',
            ref: element => {
              if (typeof onRegisterEdit === 'function') onRegisterEdit(server, element);
            },
            'aria-label': translate('editTitle', { name }),
            disabled: Boolean(rowBusy),
            onClick: event => onEdit(server, event.currentTarget),
          }, translate('edit'))
          : null,
        server.deletable !== false
          ? h('button', {
            type: 'button',
            className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonDanger',
            'aria-label': translate('deleteServer', { name }),
            disabled: Boolean(rowBusy),
            onClick: event => onDelete(server, event.currentTarget),
          }, translate('delete'))
          : null,
      ),
    ),
    metaText || status.text
      ? h('div', { className: 'dshmcp_rowMeta' },
        metaText
          ? h(readOnlyText ? 'span' : 'code', {
            className: readOnlyText ? 'dshmcp_reason' : 'dshmcp_endpoint',
            title: metaText,
          }, metaText)
          : h('span', { className: 'dshmcp_endpoint' }),
        h('span', { className: 'dshmcp_status', 'data-tone': status.tone },
          status.dot ? h('span', { className: 'dshmcp_dot', 'aria-hidden': true }) : null,
          status.text,
        ),
      )
      : null,
  );
}
