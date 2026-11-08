/** Service rows open the editor, with a separate native switch for enablement. */

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

export function ServerRow({ server, translate, busy, Switch, onEdit, onDelete, onToggle, onRegisterRow }) {
  const name = serverLabel(server, translate);
  const status = serverStatus(server, translate);
  const statusId = React.useId();
  const readOnlyText = server.editable ? null : translate(READ_ONLY_KEYS[server.readOnlyCode] || 'readOnlyConfig');
  const summary = h('span', { className: 'dshmcp_rowCopy' },
    h('span', { className: 'dshmcp_identity' },
      h('span', { className: 'dshmcp_name' }, name),
      server.duplicate ? h('span', { className: 'dshmcp_tag', 'data-tone': 'warn', title: translate('duplicateHint') }, translate('duplicate')) : null,
      readOnlyText ? h('span', { className: 'dshmcp_tag' }, translate('readOnly')) : null,
    ),
    h('span', { className: 'dshmcp_rowMeta', id: statusId },
      h('span', null, transportLabel(server, translate)),
      h('span', { className: 'dshmcp_status', 'data-tone': status.tone },
        status.dot ? h('span', { className: 'dshmcp_dot', 'aria-hidden': true }) : null,
        status.text,
      ),
    ),
    readOnlyText ? h('span', { className: 'dshmcp_reason' }, readOnlyText) : null,
  );

  if (!server.editable) {
    return h('li', { className: 'dshmcp_row dshmcp_staticRow' },
      summary,
      server.deletable !== false ? h('button', {
        type: 'button',
        className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonOutline',
        'aria-label': translate('deleteServer', { name }),
        disabled: Boolean(busy),
        onClick: event => onDelete(server, event.currentTarget),
      }, translate('delete')) : null,
    );
  }

  const canToggle = server.enabled !== null;
  return h('li', { className: 'dshmcp_row' },
    h('button', {
      type: 'button',
      className: 'dshmcp_rowButton',
      'data-has-switch': canToggle || undefined,
      ref: element => onRegisterRow(server, element),
      'aria-label': translate('editTitle', { name }),
      'aria-describedby': statusId,
      disabled: Boolean(busy),
      onClick: () => onEdit(server),
    }, summary),
    canToggle ? h(Switch, {
      className: 'dshmcp_rowSwitch',
      checked: server.enabled === true,
      label: translate('switchLabel', { name }),
      disabled: Boolean(busy),
      onChange: enabled => onToggle(server, enabled),
    }) : null,
  );
}
