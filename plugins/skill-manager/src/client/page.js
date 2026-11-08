import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { request } from './api.js';
import { createCatalog } from './catalog.js';
import { RemoveDialog } from './dialog.js';
import { createTranslator } from './i18n.js';

const GROUPS = ['builtin', 'self', 'third-party'];
const SOURCES = new Set(['project-dsh', 'project-agents', 'custom', 'user-dsh', 'user-agents', 'bundled', 'runtime']);

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
  const { BackIcon, Button, SkillEmblem, TrashIcon } = controls;
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    const pending = new AbortController();
    request({ action: 'detail', workspaceId: null, id: skill.id },
      AbortSignal.any([pending.signal, AbortSignal.timeout(8000)]))
      .then(result => { if (!pending.signal.aborted) setPreview(result); })
      .catch(error => { if (!pending.signal.aborted) setPreview({ error: error.code ?? 'unavailable' }); });
    return () => pending.abort();
  }, [skill.id]);

  const unknownOrigin = preview?.body !== undefined && !preview.origin;
  const repository = preview?.repository;
  const imported = skill.group === 'imported';
  const canToggle = typeof skill.enabled === 'boolean';
  const source = imported || !SOURCES.has(skill.source) ? skill.group : skill.source;
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
      h('h1', { ref: titleRef, tabIndex: -1 }, skill.name),
      h('dl', { className: 'dshskill_metadata dshskill_detailSource' },
        h('dt', null, t('source')), h('dd', null, t(source))),
      skill.description && h('p', { className: 'dshskill_detailDescription' }, skill.description)),
    h('div', { className: 'dshskill_detailSections' },
      (unknownOrigin || repository) && h('dl', { className: 'dshskill_metadata' },
        unknownOrigin && h('dt', null, t('origin')),
        unknownOrigin && h('dd', null, t('unknownOrigin')),
        repository && h('dt', null, t('repository')),
        repository && h('dd', null,
          h('a', { href: repository, target: '_blank', rel: 'noopener noreferrer' }, repository))),
      h('section', { className: 'dshskill_preview' },
        h('h2', null, t('preview')),
        preview === null && h('p', { role: 'status', className: 'dshskill_muted' }, t('loadingPreview')),
        preview?.error && h('p', { role: 'alert', className: 'dshskill_error' }, t(preview.error)),
        preview?.body !== undefined && h('div', { className: 'dshskill_document', tabIndex: 0, 'aria-label': t('preview') },
          h('pre', null, preview.body)))));
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
