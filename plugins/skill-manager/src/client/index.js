import { createElement as h } from 'react';
import {
  IconChevronDownOutlineRegular, IconSearchOutlineRegular,
  Input, StateDot, Switch, Tag,
} from '../../../../src/client/host-controls.js';
import { DetailDocument, detailDocumentState, useDetailDocumentLabels } from '../../../../src/client/host-document.js';
import controlsCss from '../../../../src/client/host-controls.css';
import documentCss from '../../../../src/client/host-document.css';
import katexCss from 'katex/dist/katex.min.css';
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

function SkillDocument({ preview, translate: t, onRetry }) {
  const labels = useDetailDocumentLabels({
    title: t('preview'), loading: t('loadingPreview'), retry: t('retry'),
    copy: t('copy'), copied: t('copied'), codeBlock: t('codeBlock'),
    wrap: t('wrap'), unwrap: t('unwrap'), footnotes: t('footnotes'),
  });
  const state = preview === null ? undefined : preview.error
    ? { status: 'error', message: t(preview.error) }
    : { status: 'ready', markdown: preview.body };
  return h(DetailDocument, { state: detailDocumentState(state), labels, onRetry });
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, DICTS), 'skill-manager: dictionaries');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = '@dawn0608/dsh-skill-manager';
    style.textContent = `${controlsCss}\n${documentCss}\n${katexCss}\n${css}`;
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
    BackIcon: IconChevronDownOutlineRegular, Input, SearchIcon: IconSearchOutlineRegular,
    SkillDocument, SkillEmblem, StateDot, Switch, Tag,
  })));
}
