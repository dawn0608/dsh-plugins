import { createElement as h, useId, useLayoutEffect, useRef } from 'react';
import { Button, IconCloseOutlineRegular } from '../../../../src/client/host-controls.js';

// Native Modal chrome (Harness 0.2.2-rc.1, MIT); the existing HTML dialog owns
// focus trapping and Escape. See THIRD_PARTY_NOTICES.md.
function Modal({ title, closeLabel, description, footer, busy, close, children }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const previous = dialog.ownerDocument.activeElement;
    dialog.showModal();
    dialog.querySelector('[data-initial-focus]')?.focus();
    return () => {
      dialog.close();
      if (previous?.isConnected && !previous.closest('[inert], [hidden]')) previous.focus({ preventScroll: true });
    };
  }, []);
  return h('dialog', {
    className: 'dshskill_dialog', ref, 'aria-labelledby': titleId, 'aria-describedby': descriptionId,
    onCancel(event) {
      event.preventDefault();
      if (!busy) close();
    },
  }, h('div', { className: 'dshskill_dialogContent' },
    h('div', { className: 'dshskill_dialogHeader' },
      h('h2', { id: titleId }, title),
      h('button', { type: 'button', className: 'dshskill_dialogClose', 'aria-label': closeLabel, disabled: busy, onClick: () => { if (!busy) close(); } },
        h(IconCloseOutlineRegular, { size: 14 }))),
    h('p', { id: descriptionId, className: 'dshskill_dialogDescription' }, description),
    children),
  h('div', { className: 'dshskill_dialogActions' }, footer));
}

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
      h(Button, { key: 'confirm', variant: 'primary', className: 'dshskill_dangerButton', disabled: busy, onClick: remove }, t('uninstall'))],
  }, (busy || error) && h('div', { className: 'dshskill_dialogBody' }, h(Feedback, { error, busy, translate: t })));
}
