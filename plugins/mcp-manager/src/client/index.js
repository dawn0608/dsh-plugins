/**
 * Client half: the MCP settings section, its navigation icon, and the one slot
 * registration that places it beside the shipped Settings pages.
 */

import * as React from 'react';
import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import mcpEmblem from '../../icon.svg';
import { createTranslator, registerLocale } from './i18n.js';
import { createPage } from './page.js';
import css from './style.css';

const h = React.createElement;

function McpIcon({ size = 18, active = false } = {}) {
  return h('span', {
    className: 'dshmcp_navIcon',
    'aria-hidden': true,
    'data-active': active ? 'true' : undefined,
    style: { width: size, height: size, maskImage: `url(${JSON.stringify(mcpEmblem)})` },
  });
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
