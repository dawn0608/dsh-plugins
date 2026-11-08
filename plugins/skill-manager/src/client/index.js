import { IconChevronDownOutlineRegular, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { createTranslator, DICTS, NS } from './i18n.js';
import { createPage } from './page.js';
import { SkillIcon } from './icon.js';
import css from './style.css';

export const inject = ['slots', 'locale'];

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
  }, SkillIcon));
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'skill-manager', locale: NS,
  }, createPage(ctx.locale, { BackIcon: IconChevronDownOutlineRegular, StateDot, Switch, Tag })));
}
