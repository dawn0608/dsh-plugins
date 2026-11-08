/** Host-style confirmation dialog for deleting one MCP server. */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons.js';

const h = React.createElement;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * @param {{open: boolean, trigger: HTMLElement | null, name: string, busy: boolean, failure: string | null, translate: Function, onCancel: Function, onConfirm: Function}} props
 */
export function DeleteDialog(props) {
  const { open, trigger, name, busy, failure, translate, onCancel, onConfirm } = props;
  const titleId = React.useId();
  const bodyId = React.useId();
  const dialogRef = React.useRef(null);
  const cancelRef = React.useRef(null);
  const cancelHandler = React.useRef(onCancel);
  cancelHandler.current = onCancel;

  React.useEffect(() => {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    const restoreTarget = trigger || document.activeElement;
    const timer = setTimeout(() => {
      if (cancelRef.current) cancelRef.current.focus();
    }, 0);
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelHandler.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [open, trigger]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(h('div', {
    className: 'dshmcp_overlay',
    onMouseDown: event => {
      if (event.target === event.currentTarget) cancelHandler.current();
    },
  },
  h('div', {
    ref: dialogRef,
    className: 'dshmcp_dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'aria-describedby': bodyId,
    onMouseDown: event => event.stopPropagation(),
  },
  h('div', { className: 'dshmcp_dialogHead' },
    h('h2', { className: 'dshmcp_dialogTitle', id: titleId }, translate('deleteTitle', { name })),
    h('button', {
      type: 'button',
      className: 'dshmcp_iconButton',
      'aria-label': translate('close'),
      title: translate('close'),
      disabled: busy,
      onClick: () => cancelHandler.current(),
    }, h(CloseIcon, { size: 14 })),
  ),
  h('p', { className: 'dshmcp_dialogBody', id: bodyId }, translate('deleteDescription', { name })),
  failure ? h('p', { className: 'dshmcp_dialogError', role: 'alert' }, failure) : null,
  h('div', { className: 'dshmcp_dialogFooter' },
    h('button', {
      type: 'button',
      ref: cancelRef,
      className: 'dshmcp_button dshmcp_buttonOutline',
      disabled: busy,
      onClick: () => cancelHandler.current(),
    }, translate('cancel')),
    h('button', {
      type: 'button',
      className: 'dshmcp_button dshmcp_buttonOutline dshmcp_confirmDanger',
      disabled: busy,
      onClick: onConfirm,
    }, busy ? translate('deleting', { name }) : translate('deleteConfirm', { name })),
  ),
  )), document.body);
}
