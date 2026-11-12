/** Minimal adaptations of DeepSeek Harness ui-primitives 0.2.2-rc.1 (MIT).
 * Native markup, accessibility and tokens are retained; no private loader import.
 * See THIRD_PARTY_NOTICES.md.
 */
import { createElement as h } from 'react';

export function Switch({ checked, onChange, label, disabled = false, title, className }) {
  return h('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
    title, disabled, className: ['dshui_switch_switch', className].filter(Boolean).join(' '),
    onClick: () => { if (!disabled) onChange(!checked); },
  }, h('span', { className: 'dshui_switch_thumb' }));
}
