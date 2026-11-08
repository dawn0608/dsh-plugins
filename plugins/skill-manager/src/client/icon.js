import { createElement as h } from 'react';

const paths = {
  skill: 'm12 3 8.5 4.8v8.4L12 21l-8.5-4.8V7.8L12 3Zm0 6.4v5.2m-2.6-2.6h5.2',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.3-2.2 4.2 4.2',
  plus: 'M12 5v14M5 12h14',
  back: 'M19 12H5m7-7-7 7 7 7',
};

export function SkillIcon({ kind = 'skill', size = 20 } = {}) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, focusable: false,
  }, h('path', {
    d: paths[kind], stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
  }));
}
