import { createElement as h } from 'react';
import {
  Button, IconChevronDownOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular, Input, StateDot, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import skillEmblem from '../../icon.svg';
import { createTranslator, DICTS, NS } from './i18n.js';
import { createPage } from './page.js';
import css from './style.css';

export const inject = ['slots', 'locale'];

function SkillEmblem({ size = 16, branded = false } = {}) {
  if (branded) return h('img', { src: skillEmblem, width: size, height: size, alt: '' });
  return h('span', {
    className: 'dshskill_emblem',
    'aria-hidden': true,
    style: { width: size, height: size, maskImage: `url(${JSON.stringify(skillEmblem)})` },
  });
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, DICTS), 'skill-manager: dictionaries');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = '@dawn0608/dsh-skill-manager';
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, 'skill-manager: styles');

  const translate = createTranslator(ctx.locale);
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'skill-manager', order: 5, label: () => translate('title'), locale: NS,
  }, SkillEmblem));
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'skill-manager', locale: NS,
  }, createPage(ctx.locale, {
    BackIcon: IconChevronDownOutlineRegular, Button, Input, SearchIcon: IconSearchOutlineRegular,
    SkillEmblem, StateDot, Switch, Tag, TrashIcon: IconTrashOutlineRegular,
  })));
}
