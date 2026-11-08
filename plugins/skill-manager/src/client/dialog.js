import { createElement as h, useId, useLayoutEffect, useRef } from 'react';

function Modal({ title, busy, close, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    dialog.querySelector('[data-initial-focus]')?.focus();
    return () => dialog.close();
  }, []);
  return h('dialog', {
    className: 'dshskill_dialog', ref, 'aria-labelledby': titleId,
    onCancel(event) {
      event.preventDefault();
      if (!busy) close();
    },
  }, h('h2', { id: titleId }, title), children);
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
  return h(Modal, { title: t('uninstallTitle'), busy, close },
    h('p', { className: 'dshskill_muted' }, t('uninstallHint', { name: skill.name })),
    h(Feedback, { error, busy, translate: t }),
    h('div', { className: 'dshskill_dialogActions' },
      h('button', {
        type: 'button', className: 'dshskill_control', 'data-initial-focus': '',
        'aria-disabled': busy || undefined, onClick: () => { if (!busy) close(); },
      }, t('cancel')),
      h('button', { type: 'button', className: 'dshskill_control dshskill_danger', 'aria-disabled': busy || undefined, onClick: remove }, t('uninstall'))));
}
