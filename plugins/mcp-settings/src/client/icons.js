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

export function PlusIcon({ size = 14 }) {
  return h(Svg, { size }, h(Path, { d: 'M8 3.2v9.6M3.2 8h9.6' }));
}

export function CloseIcon({ size = 14 }) {
  return h(Svg, { size }, h(Path, { d: 'M4 4l8 8M12 4l-8 8' }));
}

export function TrashIcon({ size = 14 }) {
  return h(Svg, { size }, h(Path, { d: 'M3 5h10M6 5V3.2h4V5M4.5 5l.6 8h5.8l.6-8M6.8 7.6v2.8M9.2 7.6v2.8' }));
}

export function BackIcon({ size = 14 }) {
  return h(Svg, { size }, h(Path, { d: 'M12.5 8h-9M7 4.5 3.5 8 7 11.5' }));
}
