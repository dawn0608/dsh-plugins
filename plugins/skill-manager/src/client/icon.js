import { createElement as h } from 'react';

export function SearchIcon() {
  return h('svg', {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, focusable: false,
  }, h('path', {
    d: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.3-2.2 4.2 4.2',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
  }));
}
