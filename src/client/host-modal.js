import { createElement as h, useId, useLayoutEffect, useRef } from 'react';
import { IconCloseOutlineRegular } from './host-controls.js';

// Native Modal chrome (Harness 0.2.2-rc.1, MIT); the existing HTML dialog owns
// focus trapping and Escape. See THIRD_PARTY_NOTICES.md.
export function Modal({ title, closeLabel, description, footer, busy, close, fallbackFocus, children }) {
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
      const focusTarget = previous?.isConnected && !previous.closest('[inert], [hidden]')
        ? previous : fallbackFocus?.current;
      focusTarget?.focus({ preventScroll: true });
    };
  }, [fallbackFocus]);
  return h('dialog', {
    className: 'dshui_modal', ref, 'aria-labelledby': titleId, 'aria-describedby': descriptionId,
    onCancel(event) {
      event.preventDefault();
      if (!busy) close();
    },
  }, h('div', { className: 'dshui_modalContent' },
    h('div', { className: 'dshui_modalHeader' },
      h('h2', { id: titleId }, title),
      h('button', { type: 'button', className: 'dshui_modalClose', 'aria-label': closeLabel, disabled: busy, onClick: () => { if (!busy) close(); } },
        h(IconCloseOutlineRegular, { size: 14 }))),
    h('p', { id: descriptionId, className: 'dshui_modalDescription' }, description),
    children),
  h('div', { className: 'dshui_modalActions' }, footer));
}
