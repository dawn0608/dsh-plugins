/** Small line icons matching the host's 16px icon weight. */

import * as React from 'react';

const h = React.createElement;

function Svg({ children, size = 14 }) {
  return h('svg', {
    className: 'dshmcp_icon',
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true,
    focusable: false,
  }, children);
}

function Path({ d }) {
  return h('path', {
    d,
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  });
}

export function RefreshIcon({ size = 14 }) {
  return h(Svg, { size }, h(Path, { d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.8v3.4H9.6' }));
}
