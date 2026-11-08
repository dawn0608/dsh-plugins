import { createElement as h } from 'react';
import {
  Button, DetailDocument, IconChevronDownOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular,
  Input, StateDot, Switch, Tag, detailDocumentState, useDetailDocumentLabels,
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

// Skill previews receive Markdown only, without an authorized image resolver.
const skillDocumentImages = { resolve: () => undefined };

function SkillDocument({ preview, translate: t, onRetry }) {
  const labels = useDetailDocumentLabels({
    title: t('preview'), loading: t('loadingPreview'), retry: t('retry'),
    copy: t('copy'), copied: t('copied'), codeBlock: t('codeBlock'),
    wrap: t('wrap'), unwrap: t('unwrap'), footnotes: t('footnotes'),
  });
  const state = preview === null ? undefined : preview.error
    ? { status: 'error', message: t(preview.error) }
    : { status: 'ready', markdown: preview.body };
  return h(DetailDocument, { state: detailDocumentState(state), labels, images: skillDocumentImages, onRetry });
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
    SkillDocument, SkillEmblem, StateDot, Switch, Tag, TrashIcon: IconTrashOutlineRegular,
  })));
}
