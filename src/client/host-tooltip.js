/** Tooltip and viewport fitting adapted from Harness ui-primitives 0.2.2-rc.1
 * (MIT). Only the top, portal action tooltip used by CodeToolbar is retained.
 * See THIRD_PARTY_NOTICES.md.
 */
import { cloneElement, createElement as h, Fragment, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function placeTooltip(anchor, width, height, viewportWidth, viewportHeight) {
  const margin = 12;
  width = Math.min(width, Math.max(0, viewportWidth - margin * 2));
  height = Math.min(height, Math.max(0, viewportHeight - margin * 2));
  const clampX = x => Math.max(margin, Math.min(x, viewportWidth - margin - width));
  const clampY = y => Math.max(margin, Math.min(y, viewportHeight - margin - height));
  const positions = {
    top: { left: clampX((anchor.left + anchor.right - width) / 2), top: anchor.top - 8 - height },
    bottom: { left: clampX((anchor.left + anchor.right - width) / 2), top: anchor.bottom + 8 },
    right: { left: anchor.right + 10, top: clampY((anchor.top + anchor.bottom - height) / 2) },
    left: { left: anchor.left - 10 - width, top: clampY((anchor.top + anchor.bottom - height) / 2) },
  };
  for (const [side, position] of Object.entries(positions)) {
    if (position.left >= margin && position.top >= margin && position.left + width <= viewportWidth - margin && position.top + height <= viewportHeight - margin) return { ...position, side };
  }
  return { left: clampX(positions.top.left), top: clampY(positions.top.top), side: 'top' };
}

export function Tooltip({ label, children }) {
  const id = useId();
  const anchor = useRef(null);
  const bubble = useRef(null);
  const pointerFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const childRef = children.props.ref;
  const ref = useCallback(element => {
    anchor.current = element;
    if (typeof childRef === 'function') return childRef(element);
    if (childRef) childRef.current = element;
  }, [childRef]);
  useLayoutEffect(() => {
    if (!open) return;
    const element = bubble.current;
    const view = element.ownerDocument.defaultView;
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      const position = placeTooltip(anchor.current.getBoundingClientRect(), width, height, view.innerWidth, view.innerHeight);
      element.style.left = `${position.left}px`;
      element.style.top = `${position.top}px`;
      element.dataset.side = position.side;
      element.style.visibility = 'visible';
    };
    fit();
    const observer = view.ResizeObserver ? new view.ResizeObserver(fit) : null;
    observer?.observe(element);
    observer?.observe(anchor.current);
    view.addEventListener('resize', fit);
    view.addEventListener('scroll', fit, true);
    return () => {
      observer?.disconnect();
      view.removeEventListener('resize', fit);
      view.removeEventListener('scroll', fit, true);
    };
  }, [open, label]);
  const hide = () => setOpen(false);
  const chain = (name, handler) => event => { children.props[name]?.(event); handler(event); };
  return h(Fragment, null, cloneElement(children, {
    ref,
    'aria-describedby': [children.props['aria-describedby'], open ? id : null].filter(Boolean).join(' ') || undefined,
    onPointerEnter: chain('onPointerEnter', event => {
      const view = event.currentTarget.ownerDocument.defaultView;
      if (event.pointerType === 'touch' || (view.matchMedia && !view.matchMedia('(any-hover: hover)').matches)) return;
      setOpen(true);
    }),
    onPointerLeave: chain('onPointerLeave', hide),
    onPointerDown: chain('onPointerDown', () => { pointerFocus.current = true; hide(); }),
    onFocus: chain('onFocus', () => { if (!pointerFocus.current) setOpen(true); }),
    onBlur: chain('onBlur', () => { pointerFocus.current = false; hide(); }),
    onKeyDown: chain('onKeyDown', event => { pointerFocus.current = false; if (event.key === 'Escape') hide(); }),
    onClick: chain('onClick', hide),
  }), open && createPortal(h('span', {
    ref: bubble, id, className: 'dshui_tooltip_bubble', role: 'tooltip', 'data-portal': '',
    style: { visibility: 'hidden' },
  }, h('span', { className: 'dshui_tooltip_label' }, label)), anchor.current.ownerDocument.body));
}
