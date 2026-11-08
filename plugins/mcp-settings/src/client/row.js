/** One MCP settings row with a compact service summary and right-aligned actions. */

import * as React from 'react';
import { serverLabel, serverStatus, transportLabel } from './model.js';

const h = React.createElement;

const READ_ONLY_KEYS = {
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

export function ServerRow({ server, translate, busy, onEdit, onDelete, onToggle, onRegisterEdit }) {
  const name = serverLabel(server, translate);
  const readOnlyText = server.editable ? null : translate(READ_ONLY_KEYS[server.readOnlyCode] || 'readOnlyConfig');
  const status = serverStatus(server, translate);
  const buttonClass = 'dshmcp_button dshmcp_buttonSm dshmcp_buttonOutline';

  return h('li', { className: 'dshmcp_row' },
    h('div', { className: 'dshmcp_rowCopy' },
      h('div', { className: 'dshmcp_identity' },
        h('span', { className: 'dshmcp_name' }, name),
        server.duplicate ? h('span', { className: 'dshmcp_tag', 'data-tone': 'warn', title: translate('duplicateHint') }, translate('duplicate')) : null,
        readOnlyText ? h('span', { className: 'dshmcp_tag' }, translate('readOnly')) : null,
      ),
      h('div', { className: 'dshmcp_rowMeta' },
        h('span', null, transportLabel(server, translate)),
        h('span', { className: 'dshmcp_status', 'data-tone': status.tone },
          status.dot ? h('span', { className: 'dshmcp_dot', 'aria-hidden': true }) : null,
          status.text,
        ),
      ),
      readOnlyText ? h('p', { className: 'dshmcp_reason' }, readOnlyText) : null,
    ),
    server.editable
      ? h('div', { className: 'dshmcp_actions' },
        h('button', {
          type: 'button',
          className: buttonClass,
          ref: element => onRegisterEdit(server, element),
          'aria-label': translate('editTitle', { name }),
          disabled: Boolean(busy),
          onClick: () => onEdit(server),
        }, translate('edit')),
        server.enabled !== null
          ? h('button', {
            type: 'button',
            role: 'switch',
            className: 'dshmcp_switch',
            'aria-checked': server.enabled === true,
            'aria-label': translate('switchLabel', { name }),
            'aria-disabled': busy ? true : undefined,
            onClick: () => onToggle(server),
          }, h('span', { className: 'dshmcp_switchThumb', 'aria-hidden': true }))
          : null,
      )
      : server.deletable !== false
        ? h('button', {
          type: 'button',
          className: buttonClass,
          'aria-label': translate('deleteServer', { name }),
          disabled: Boolean(busy),
          onClick: event => onDelete(server, event.currentTarget),
        }, translate('delete'))
        : null,
  );
}
