/** Service summaries and the available row actions. */

import * as React from 'react';
import { serverLabel, transportLabel } from './model.js';

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

export function ServerRow({ server, translate, busy, saving, failure, Switch, Tag, onToggle }) {
  const name = serverLabel(server, translate);
  const readOnlyText = server.editable ? null : translate(READ_ONLY_KEYS[server.readOnlyCode] || 'readOnlyConfig');
  const canToggle = server.editable && server.enabled !== null;
  return h('li', { className: 'dshmcp_row' },
    h('span', { className: 'dshmcp_identity' },
      h('span', { className: 'dshmcp_name' }, name),
      server.duplicate ? h('span', { title: translate('duplicateHint') },
        h(Tag, { tone: 'warning' }, translate('duplicate')),
      ) : null,
      readOnlyText ? h(Tag, { tone: 'neutral' }, translate('readOnly')) : null,
    ),
    h('span', { className: 'dshmcp_transport' }, transportLabel(server, translate)),
    canToggle ? h(Switch, {
      className: 'dshmcp_switch',
      checked: server.enabled === true,
      label: translate('switchLabel', { name }),
      disabled: Boolean(busy),
      onChange: enabled => onToggle(server, enabled),
    }) : null,
    saving ? h('p', { className: 'dshmcp_reason', role: 'status' }, translate('saving')) : null,
    failure ? h('p', { className: 'dshmcp_reason dshmcp_notice_error', role: 'alert' }, failure) : null,
    readOnlyText ? h('span', { className: 'dshmcp_reason' }, readOnlyText) : null,
  );
}
