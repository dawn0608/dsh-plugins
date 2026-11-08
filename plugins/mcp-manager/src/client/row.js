/** Static service summaries with a native enablement switch. */

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

export function ServerRow({ server, translate, busy, Switch, onToggle }) {
  const name = serverLabel(server, translate);
  const status = serverStatus(server, translate);
  const readOnlyText = server.editable ? null : translate(READ_ONLY_KEYS[server.readOnlyCode] || 'readOnlyConfig');
  const canToggle = server.editable && server.enabled !== null;
  return h('li', { className: 'dshmcp_row' },
    h('div', { className: 'dshmcp_rowCopy' },
      h('span', { className: 'dshmcp_identity' },
        h('span', { className: 'dshmcp_name' }, name),
        server.duplicate ? h('span', { className: 'dshmcp_tag', 'data-tone': 'warn', title: translate('duplicateHint') }, translate('duplicate')) : null,
        readOnlyText ? h('span', { className: 'dshmcp_tag' }, translate('readOnly')) : null,
      ),
      h('span', { className: 'dshmcp_rowMeta' },
        h('span', null, transportLabel(server, translate)),
        h('span', { className: 'dshmcp_status', 'data-tone': status.tone },
          status.dot ? h('span', { className: 'dshmcp_dot', 'aria-hidden': true }) : null,
          status.text,
        ),
      ),
      readOnlyText ? h('span', { className: 'dshmcp_reason' }, readOnlyText) : null,
    ),
    canToggle ? h(Switch, {
      checked: server.enabled === true,
      label: translate('switchLabel', { name }),
      disabled: Boolean(busy),
      onChange: enabled => onToggle(server, enabled),
    }) : null,
  );
}
