import { createElement as h } from 'react';
import { Button } from '../../../../src/client/host-controls.js';
import { Modal } from '../../../../src/client/host-modal.js';

function Feedback({ error, busy, translate }) {
  return h('div', { className: 'dshskill_feedback' },
    busy && h('p', { role: 'status' }, translate('saving')),
    error && h('p', { className: 'dshskill_error', role: 'alert' }, translate(error)));
}

export function RemoveDialog({ skill, translate: t, store, busy, error, close, removed }) {
  async function remove() {
    if (busy) return;
    const ok = await store.mutate({ action: 'remove', id: skill.id });
    if (ok) removed();
  }
  return h(Modal, { title: t('uninstallTitle'), closeLabel: t('close'), busy, close,
    description: t('uninstallHint', { name: skill.name }),
    footer: [
      h(Button, {
        key: 'cancel', variant: 'outline', 'data-initial-focus': '',
        disabled: busy, onClick: () => { if (!busy) close(); },
      }, t('cancel')),
      h(Button, { key: 'confirm', variant: 'primary', className: 'dshui_modalDangerButton', disabled: busy, onClick: remove }, t('uninstall'))],
  }, (busy || error) && h('div', { className: 'dshui_modalBody' }, h(Feedback, { error, busy, translate: t })));
}
