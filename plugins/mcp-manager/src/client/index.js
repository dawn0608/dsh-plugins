/**
 * Client half: the MCP settings section, its navigation icon, and the one slot
 * registration that places it beside the shipped Settings pages.
 */

import * as React from 'react';
import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { createTranslator, registerLocale } from './i18n.js';
import { createPage } from './page.js';
import css from './style.css';

const h = React.createElement;

function McpIcon({ size = 18, active = false } = {}) {
  return h('svg', {
    className: 'dshmcp_navIcon',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
    focusable: false,
    'data-active': active ? 'true' : undefined,
  },
  h('path', {
    d: 'M7.8 9.2 11 15.2M16.2 9.2 13 15.2M9.4 7h5.2',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }),
  h('circle', { cx: 6.4, cy: 6.8, r: 2.2, stroke: 'currentColor', strokeWidth: 1.5 }),
  h('circle', { cx: 17.6, cy: 6.8, r: 2.2, stroke: 'currentColor', strokeWidth: 1.5 }),
  h('circle', { cx: 12, cy: 17.4, r: 2.2, stroke: 'currentColor', strokeWidth: 1.5 }),
  );
}

export const inject = ['slots', 'locale'];

export function apply(ctx) {
  registerLocale(ctx);

  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = '@dawn0608/dsh-mcp-manager';
    tag.textContent = css;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, 'mcp-manager: styles');

  const translate = createTranslator(ctx);
  const subscribeLocale = listener => ctx.locale.subscribe(listener);
  const localeVersion = () => {
    try {
      const snapshot = ctx.locale.getSnapshot();
      return typeof snapshot.revision === 'number' ? snapshot.revision : 0;
    } catch (error) {
      return 0;
    }
  };
  const Page = createPage({ translate, subscribeLocale, localeVersion, Switch, Tag });

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-manager',
    order: 17,
    label: () => translate('title'),
  }, Page));

  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    id: 'mcp-manager',
    order: 17,
  }, McpIcon));
}
