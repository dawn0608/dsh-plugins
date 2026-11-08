import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { request } from './api.js';
import { createCatalog } from './catalog.js';
import { ImportDialog, RemoveDialog } from './dialog.js';
import { SkillIcon } from './icon.js';
import { createTranslator } from './i18n.js';

const GROUPS = ['imported', 'workspace', 'local', 'builtin'];
const SOURCES = new Set(['project-dsh', 'project-agents', 'custom', 'user-dsh', 'user-agents', 'bundled', 'runtime']);

function CatalogRows({ skills, query, translate: t, busy, store, openDetail }) {
  const headingId = useId();
  const term = query.trim().toLocaleLowerCase();
  const visible = skills.filter(skill => !term || [skill.name, skill.description]
    .some(text => text?.toLocaleLowerCase().includes(term)));
  if (!visible.length) return h('p', { className: 'dshskill_muted', role: 'status' }, t(term ? 'noMatch' : 'empty'));

  return h('div', { className: 'dshskill_groups' }, GROUPS.map(group => {
    const entries = visible.filter(skill => skill.group === group);
    if (!entries.length) return null;
    const id = headingId + group;
    return h('section', { key: group, 'aria-labelledby': id },
      h('h2', { id }, t(group)),
      h('ul', { className: 'dshskill_rows' }, entries.map(skill =>
        h('li', { key: skill.id, className: 'dshskill_row' },
          h('button', {
            type: 'button', className: 'dshskill_rowButton', 'data-skill-id': skill.id,
            onClick: () => openDetail(skill),
          },
          h('span', { className: 'dshskill_icon' }, h(SkillIcon, { size: 24 })),
          h('span', { className: 'dshskill_rowText' },
            h('span', { className: 'dshskill_rowName' },
              skill.name, skill.shadowed && h('span', { className: 'dshskill_badge' }, t('shadowed'))),
            skill.description && h('span', { className: 'dshskill_description' }, skill.description))),
          group === 'imported' && typeof skill.enabled === 'boolean' && h('button', {
            type: 'button', className: 'dshskill_switch', role: 'switch', 'aria-checked': skill.enabled,
            'aria-label': t('switchLabel', { name: skill.name }), 'aria-disabled': busy || undefined,
            onClick: () => { void store.mutate({ action: 'setEnabled', id: skill.id, enabled: !skill.enabled }); },
          })))));
  }));
}

function SkillDetail({ skill, workspaceId, titleRef, translate: t, busy, back, openRemove }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    const pending = new AbortController();
    request({ action: 'detail', workspaceId, id: skill.id },
      AbortSignal.any([pending.signal, AbortSignal.timeout(8000)]))
      .then(({ body }) => { if (!pending.signal.aborted) setPreview({ body }); })
      .catch(error => { if (!pending.signal.aborted) setPreview({ error: error.code ?? 'unavailable' }); });
    return () => pending.abort();
  }, [skill.id, workspaceId]);

  return h('div', { className: 'dshskill_detail' },
    h('button', { type: 'button', className: 'dshskill_control dshskill_back', onClick: back },
      h(SkillIcon, { kind: 'back', size: 16 }), t('back')),
    h('header', { className: 'dshskill_header' },
      h('div', null,
        h('h1', { ref: titleRef, tabIndex: -1 }, skill.name),
        skill.description && h('p', { className: 'dshskill_intro' }, skill.description)),
      skill.group === 'imported' && h('button', {
        type: 'button', className: 'dshskill_control dshskill_danger', 'aria-disabled': busy || undefined,
        onClick: () => { if (!busy) openRemove(); },
      }, t('uninstall'))),
    h('dl', { className: 'dshskill_metadata' },
      h('dt', null, t('source')),
      h('dd', null, t(skill.group === 'imported' || !SOURCES.has(skill.source) ? skill.group : skill.source))),
    h('section', { className: 'dshskill_preview' },
      h('h2', null, t('preview')),
      preview === null && h('p', { role: 'status', className: 'dshskill_muted' }, t('loadingPreview')),
      preview?.error && h('p', { role: 'alert', className: 'dshskill_error' }, t(preview.error)),
      preview?.body !== undefined && h('pre', { tabIndex: 0, 'aria-label': t('preview') }, preview.body)));
}

export function createPage(locale, createStore = createCatalog) {
  const t = createTranslator(locale);
  const subscribeLocale = listener => locale.subscribe(listener);
  const localeVersion = () => locale.getSnapshot().revision;

  return function SkillsPage() {
    useSyncExternalStore(subscribeLocale, localeVersion, localeVersion);
    const [store] = useState(createStore);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const [query, setQuery] = useState('');
    const [detail, setDetail] = useState(null);
    const [dialog, setDialog] = useState(null);
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
      setDialog(null);
      store.clearMutationError();
    }

    function removed() {
      closeDialog();
      setDetail(null);
    }

    const { skills, workspaces, workspaceId, busy, listError, mutationError } = state;
    const currentSkill = detail && (skills?.find(skill => skill.id === detail.id) ?? detail);
    return h('div', { className: 'dshskill_page', ref: pageRef },
      h('div', { className: 'dshskill_content' },
        currentSkill
          ? h(SkillDetail, {
              skill: currentSkill, workspaceId, titleRef, translate: t, busy,
              back: () => setDetail(null), openRemove: () => { store.clearMutationError(); setDialog('remove'); },
            })
          : h('div', { className: 'dshskill_catalog' },
            h('header', { className: 'dshskill_header' },
              h('div', null,
                h('h1', { ref: titleRef, tabIndex: -1 }, t('title')),
                h('p', { className: 'dshskill_intro' }, t('intro'))),
              h('div', { className: 'dshskill_toolbar' },
                h('label', { className: 'dshskill_search' },
                  h(SkillIcon, { kind: 'search', size: 16 }),
                  h('input', {
                    type: 'search', 'aria-label': t('search'), placeholder: t('search'), value: query,
                    onChange: event => setQuery(event.currentTarget.value),
                  })),
                h('button', {
                  type: 'button', className: 'dshskill_control dshskill_primary', 'aria-disabled': busy || undefined,
                  onClick: () => { if (!busy) { store.clearMutationError(); setDialog('import'); } },
                }, h(SkillIcon, { kind: 'plus', size: 16 }), t('add')))),
            h('label', { className: 'dshskill_workspace' },
              h('span', null, t('workspaceSelector')),
              h('select', {
                className: 'dshskill_control', 'aria-label': t('workspaceSelector'),
                value: workspaceId ?? '', disabled: busy,
                onChange: event => { void store.setWorkspace(event.currentTarget.value || null); },
              },
              h('option', { value: '' }, t('globalScope')),
              workspaces.map(workspace => h('option', { key: workspace.id, value: workspace.id }, workspace.title)))),
            listError && h('p', { role: 'alert', className: 'dshskill_error' }, t(listError)),
            skills === null
              ? !listError && h('p', { role: 'status', className: 'dshskill_muted' }, t('loading'))
              : h(CatalogRows, { skills, query, translate: t, busy, store, openDetail })),
        !dialog && busy && h('p', { role: 'status', className: 'dshskill_muted' }, t('saving')),
        !dialog && mutationError && h('p', { role: 'alert', className: 'dshskill_error' }, t(mutationError)),
        dialog === 'import' && h(ImportDialog, { translate: t, workspaceId, store, busy, error: mutationError, close: closeDialog }),
        dialog === 'remove' && h(RemoveDialog, { skill: currentSkill, translate: t, store, busy, error: mutationError, close: closeDialog, removed })));
  };
}
