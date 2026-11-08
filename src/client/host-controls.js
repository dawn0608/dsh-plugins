/** Minimal adaptations of DeepSeek Harness ui-primitives 0.2.2-rc.1 (MIT).
 * Native markup, accessibility and tokens are retained; no private loader import.
 * See THIRD_PARTY_NOTICES.md.
 */
import { createElement as h, forwardRef } from 'react';

const classes = (...values) => values.filter(Boolean).join(' ');
const css = (control, name) => `dshui_${control}_${name}`;

export function Switch({ checked, onChange, label, disabled = false, title, className }) {
  return h('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
    title, disabled, className: classes(css('switch', 'switch'), className),
    onClick: () => { if (!disabled) onChange(!checked); },
  }, h('span', { className: css('switch', 'thumb') }));
}

export function Tag({ tone = 'outline', className, children }) {
  return h('span', { className: classes(css('tag', 'tag'), className), 'data-tone': tone }, children);
}

export const Input = forwardRef(function Input({ icon, className, ...rest }, ref) {
  return h('span', { className: classes(css('input', 'wrap'), className) },
    icon != null ? h('span', { className: css('input', 'icon') }, icon) : null,
    h('input', { ref, className: css('input', 'input'), ...rest }));
});

export const Button = forwardRef(function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }, ref) {
  return h('button', {
    ref, type: 'button', className: classes(css('button', 'button'), css('button', variant), css('button', size), className), ...rest,
  }, icon != null ? h('span', { className: css('button', 'icon') }, icon) : null, children);
});

export function StateDot({ state, size, className }) {
  const edge = size ?? (state === 'ongoing' ? 14 : 10);
  if (state === 'ongoing') return h('svg', {
    ref: element => {
      for (const animation of element?.getAnimations?.({ subtree: true }) ?? []) animation.startTime = 0;
    },
    className: classes(css('state', 'spinner'), className), 'data-state': state,
    width: edge, height: edge, viewBox: '0 0 24 24', 'aria-hidden': true,
  }, h('g', { className: css('state', 'spinnerMotion') },
    h('circle', { className: css('state', 'spinnerTrack'), cx: 12, cy: 12, r: 9.5 }),
    h('circle', { className: css('state', 'spinnerArc'), cx: 12, cy: 12, r: 9.5 })));
  return h('span', { className: classes(css('state', 'dot'), className), 'data-state': state,
    style: { width: edge, height: edge }, 'aria-hidden': true });
}

// The host theme owns these product-icon sprite symbols, as with native controls.
const productIcon = glyph => ({ size = 16, className }) => h('svg', {
  width: size, height: size, className, 'data-icon': `dsw-icon-${glyph}-regular`, 'aria-hidden': true,
}, h('use', { href: `#dsw-icon-${glyph}-regular` }));
export const IconChevronDownOutlineRegular = productIcon('chevron-down-outline');
export const IconSearchOutlineRegular = productIcon('search-outline');
export const IconTrashOutlineRegular = productIcon('trash-outline');
