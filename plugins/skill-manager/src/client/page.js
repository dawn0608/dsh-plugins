import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { request } from './api.js';
import { createCatalog } from './catalog.js';
import { RemoveDialog } from './dialog.js';
import { createTranslator } from './i18n.js';

const GROUPS = ['builtin', 'self', 'third-party'];

function SkillToggle({ skill, busy, saving, store, translate: t, controls }) {
  const { StateDot, Switch } = controls;
  return h('span', { className: 'dshskill_toggle' },
    h('span', { className: 'dshskill_toggleProgress', role: 'status' },
      h('span', { className: 'dshskill_progressAnnouncement' }, saving ? t('saving') : ''),
      saving && h(StateDot, { state: 'ongoing' })),
    h(Switch, {
      checked: skill.enabled, label: t('switchLabel', { name: skill.name }), disabled: busy,
      onChange: enabled => { void store.mutate({ action: 'setEnabled', id: skill.id, enabled }); },
    }));
}

function CatalogRows({ skills, query, translate: t, busy, savingId, store, openDetail, controls }) {
  const { SkillEmblem, Tag } = controls;
  const headingId = useId();
  const term = query.trim().toLocaleLowerCase();
  const visible = skills.filter(skill => !term || [skill.name, skill.description]
    .some(text => text?.toLocaleLowerCase().includes(term)));
  if (!visible.length) return h('p', { className: 'dshskill_muted', role: 'status' }, t(term ? 'noMatch' : 'empty'));

  return h('div', { className: 'dshskill_groups' }, GROUPS.map(group => {
    const entries = visible.filter(skill => (skill.origin ?? 'third-party') === group);
    if (!entries.length) return null;
    const id = headingId + group;
    return h('section', { key: group, className: 'dshskill_group', 'aria-labelledby': id },
      h('h2', { id }, t(group)),
      h('ul', { className: 'dshskill_rows' }, entries.map(skill => {
        const descriptionId = skill.description ? headingId + '-' + skill.id : undefined;
        const saving = savingId === skill.id;
        return h('li', { key: skill.id, className: 'dshskill_row' },
          h('span', { className: 'dshskill_icon' }, h(SkillEmblem, { size: 24 })),
          h('div', { className: 'dshskill_rowText' },
            h('div', { className: 'dshskill_titleRow' },
              h('button', {
                type: 'button', className: 'dshskill_rowButton', 'data-skill-id': skill.id,
                'aria-label': t('openDetail', { name: skill.name }), 'aria-describedby': descriptionId,
                onClick: () => openDetail(skill),
              }, skill.name),
              skill.shadowed && h(Tag, { className: 'dshskill_badge' }, t('shadowed'))),
            descriptionId && h('span', { className: 'dshskill_description', id: descriptionId }, skill.description)),
          typeof skill.enabled === 'boolean' && h(SkillToggle, { skill, busy, saving, store, translate: t, controls }));
      })));
  }));
}

function SkillDetail({ skill, titleRef, translate: t, busy, saving, back, openRemove, controls, store }) {
  const { BackIcon, Button, SkillDocument, SkillEmblem, Tag, TrashIcon } = controls;
  const [preview, setPreview] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const pending = new AbortController();
    request({ action: 'detail', workspaceId: null, id: skill.id },
      AbortSignal.any([pending.signal, AbortSignal.timeout(8000)]))
      .then(result => { if (!pending.signal.aborted) setPreview(result); })
      .catch(error => { if (!pending.signal.aborted) setPreview({ error: error.code ?? 'unavailable' }); });
    return () => pending.abort();
  }, [skill.id, attempt]);

  const imported = skill.group === 'imported';
  const canToggle = typeof skill.enabled === 'boolean';
  const origin = preview?.origin ?? skill.origin;
  const repository = origin === 'third-party' ? preview?.repository : undefined;
  const repositoryLabel = repository?.replace(/^https:\/\/(?:github\.com\/)?/, '').replace(/\/$/, '');
  const originLabel = t(origin ? 'origin-' + origin : imported ? 'imported' : 'unknownOrigin');
  return h('div', { className: 'dshskill_detail' },
    h('header', { className: 'dshskill_detailTop' },
      h('button', { type: 'button', className: 'dshskill_back', 'aria-label': t('back'), onClick: back },
        h(BackIcon, { className: 'dshskill_backIcon', 'aria-hidden': true }), h('span', null, t('title'))),
      h('div', { className: 'dshskill_detailHead' },
        h('span', { className: 'dshskill_icon', 'aria-hidden': true }, h(SkillEmblem, { branded: true, size: 36 })),
        (imported || canToggle) && h('div', { className: 'dshskill_detailActions' },
          imported && h(Button, {
            type: 'button', variant: 'outline', size: 'sm', className: 'dshskill_detailUninstall',
            icon: h(TrashIcon, { size: 13 }), disabled: busy,
            'aria-label': t('uninstallLabel', { name: skill.name }), onClick: openRemove,
          }, t('uninstall')),
          canToggle && h(SkillToggle, { skill, busy, saving, store, translate: t, controls })))),
    h('div', { className: 'dshskill_detailMain' },
      h('div', { className: 'dshskill_detailTitleRow' },
        h('h1', { ref: titleRef, tabIndex: -1, title: skill.name }, skill.name),
        repository ? h('a', {
          className: 'dshskill_repository', href: repository, target: '_blank', rel: 'noopener noreferrer',
          title: repositoryLabel, 'aria-label': t('openRepository', { repository: repositoryLabel }),
        }, h('span', { className: 'dshskill_repositoryName' }, repositoryLabel),
        h('span', { 'aria-hidden': true }, '↗')) : h(Tag, { tone: 'neutral' }, originLabel)),
      skill.description && h('p', { className: 'dshskill_detailDescription' }, skill.description)),
    h('div', { className: 'dshskill_detailSections' },
      h(SkillDocument, { preview, translate: t, onRetry: () => { setPreview(null); setAttempt(value => value + 1); } })));
}

export function createPage(locale, controls, createStore = createCatalog) {
  const t = createTranslator(locale);
  const subscribeLocale = listener => locale.subscribe(listener);
  const localeVersion = () => locale.getSnapshot().revision;

  return function SkillsPage() {
    useSyncExternalStore(subscribeLocale, localeVersion, localeVersion);
    const [store] = useState(createStore);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const [query, setQuery] = useState('');
    const [detail, setDetail] = useState(null);
    const [confirmRemoval, setConfirmRemoval] = useState(false);
    const pageRef = useRef(null);
    const titleRef = useRef(null);
    const returnTo = useRef(null);

    useEffect(() => {
      store.start();
      return () => store.stop();
    }, [store]);

    useLayoutEffect(() => {
      if (detail) {
        pageRef.current.scrollTop = 0;
        titleRef.current.focus({ preventScroll: true });
      } else if (returnTo.current !== null) {
        const { id, scrollTop } = returnTo.current;
        const row = Array.from(pageRef.current.querySelectorAll('[data-skill-id]'))
          .find(button => button.dataset.skillId === id);
        if (row) {
          pageRef.current.scrollTop = scrollTop;
          row.focus({ preventScroll: true });
        } else {
          titleRef.current.focus();
        }
        returnTo.current = null;
      }
    }, [detail]);

    function openDetail(skill) {
      returnTo.current = { id: skill.id, scrollTop: pageRef.current.scrollTop };
      setDetail(skill);
      store.clearMutationError();
    }

    function closeDialog() {
      setConfirmRemoval(false);
      store.clearMutationError();
    }

    function removed() {
      closeDialog();
      setDetail(null);
    }

    const { skills, busy, savingId, listError, mutationError } = state;
    const currentSkill = detail && (skills?.find(skill => skill.id === detail.id) ?? detail);
    return h('div', { className: 'dshskill_page', 'data-detail': currentSkill ? '' : undefined, ref: pageRef },
      h('div', { className: 'dshskill_content' },
        currentSkill
          ? h(SkillDetail, {
              skill: currentSkill, titleRef, translate: t, busy, saving: savingId === currentSkill.id, controls, store,
              back: () => setDetail(null), openRemove: () => { store.clearMutationError(); setConfirmRemoval(true); },
            })
          : h('div', { className: 'dshskill_catalog' },
            h('header', { className: 'dshskill_header' },
              h('h1', { ref: titleRef, tabIndex: -1 }, t('title')),
              h(controls.Input, {
                className: 'dshskill_search', type: 'search', icon: h(controls.SearchIcon, { size: 14 }),
                'aria-label': t('search'), placeholder: t('search'), value: query,
                onChange: event => setQuery(event.currentTarget.value),
              })),
            listError && h('p', { role: 'alert', className: 'dshskill_error' }, t(listError)),
            skills === null
              ? !listError && h('p', { role: 'status', className: 'dshskill_muted' }, t('loading'))
              : h(CatalogRows, { skills, query, translate: t, busy, savingId, store, openDetail, controls })),
        !confirmRemoval && busy && !savingId && h('p', { role: 'status', className: 'dshskill_muted' }, t('saving')),
        !confirmRemoval && mutationError && h('p', { role: 'alert', className: 'dshskill_error' }, t(mutationError)),
        confirmRemoval && h(RemoveDialog, { skill: currentSkill, translate: t, store, busy, error: mutationError, close: closeDialog, removed })));
  };
}
