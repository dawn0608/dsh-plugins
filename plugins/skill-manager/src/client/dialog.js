import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { readSelection, request } from './api.js';

function Modal({ title, busy, close, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    dialog.querySelector('[data-initial-focus]')?.focus();
    return () => dialog.close();
  }, []);
  return h('dialog', {
    className: 'dshskill_dialog', ref, 'aria-labelledby': titleId,
    onCancel(event) {
      event.preventDefault();
      if (!busy) close();
    },
  }, h('h2', { id: titleId }, title), children);
}

function Feedback({ error, busy, translate }) {
  return h('div', { className: 'dshskill_feedback' },
    busy && h('p', { role: 'status' }, translate('saving')),
    error && h('p', { className: 'dshskill_error', role: 'alert' }, translate(error)));
}

export function ImportDialog({ translate: t, workspaceId, store, busy, error, close }) {
  const folderInput = useRef(null);
  const fileInput = useRef(null);
  const inspectRequest = useRef(null);
  const [choice, setChoice] = useState(null);
  const [inspecting, setInspecting] = useState(false);
  const [selectionError, setSelectionError] = useState(null);
  useEffect(() => () => inspectRequest.current?.abort(), []);

  async function inspect(event, kind) {
    const selection = Array.from(event.currentTarget.files);
    event.currentTarget.value = '';
    if (!selection.length) return;
    const pending = new AbortController();
    inspectRequest.current?.abort();
    inspectRequest.current = pending;
    store.clearMutationError();
    setInspecting(true);
    setChoice(null);
    setSelectionError(null);
    try {
      const selected = await readSelection(selection, kind);
      if (pending.signal.aborted) return;
      const result = await request({ action: 'inspect', workspaceId, files: selected.files },
        AbortSignal.any([pending.signal, AbortSignal.timeout(15000)]));
      if (!pending.signal.aborted) setChoice({ ...selected, ...result });
    } catch (error) {
      if (!pending.signal.aborted) setSelectionError(error.code ?? 'unavailable');
    } finally {
      if (!pending.signal.aborted) setInspecting(false);
    }
  }

  async function importSkill() {
    if (busy || inspecting || !choice) return;
    const ok = await store.mutate({ action: 'import', files: choice.files, expectedName: choice.name });
    if (ok) close();
  }

  return h(Modal, { title: t('add'), busy, close },
    h('p', { className: 'dshskill_muted' }, t('chooseHint')),
    h('input', {
      ref: folderInput, type: 'file', webkitdirectory: '', multiple: true, hidden: true,
      onChange: event => { void inspect(event, 'folder'); },
    }),
    h('input', {
      ref: fileInput, type: 'file', accept: '.md', hidden: true,
      onChange: event => { void inspect(event, 'file'); },
    }),
    h('div', { className: 'dshskill_picker' },
      h('button', {
        type: 'button', className: 'dshskill_control', 'aria-disabled': busy || inspecting || undefined, 'data-initial-focus': '',
        onClick: () => { if (!busy && !inspecting) folderInput.current.click(); },
      }, t('chooseFolder')),
      h('button', {
        type: 'button', className: 'dshskill_control', 'aria-disabled': busy || inspecting || undefined,
        onClick: () => { if (!busy && !inspecting) fileInput.current.click(); },
      }, t('chooseFile'))),
    inspecting && h('p', { role: 'status' }, t('inspecting')),
    choice && h('div', { className: 'dshskill_choice' },
      h('dl', { className: 'dshskill_metadata' },
        h('dt', null, t('importName')), h('dd', null, choice.name),
        h('dt', null, t('importSource')), h('dd', null, choice.source)),
      choice.description && h('p', { className: 'dshskill_muted' }, choice.description)),
    h(Feedback, { error: selectionError ?? error, busy, translate: t }),
    h('div', { className: 'dshskill_dialogActions' },
      h('button', { type: 'button', className: 'dshskill_control', 'aria-disabled': busy || undefined, onClick: () => { if (!busy) close(); } }, t('cancel')),
      choice && h('button', { type: 'button', className: 'dshskill_control dshskill_primary', 'aria-disabled': busy || undefined, onClick: importSkill }, t('importConfirm'))));
}

export function RemoveDialog({ skill, translate: t, store, busy, error, close, removed }) {
  async function remove() {
    if (busy) return;
    const ok = await store.mutate({ action: 'remove', id: skill.id });
    if (ok) removed();
  }
  return h(Modal, { title: t('uninstallTitle'), busy, close },
    h('p', { className: 'dshskill_muted' }, t('uninstallHint', { name: skill.name })),
    h(Feedback, { error, busy, translate: t }),
    h('div', { className: 'dshskill_dialogActions' },
      h('button', {
        type: 'button', className: 'dshskill_control', 'data-initial-focus': '',
        'aria-disabled': busy || undefined, onClick: () => { if (!busy) close(); },
      }, t('cancel')),
      h('button', { type: 'button', className: 'dshskill_control dshskill_danger', 'aria-disabled': busy || undefined, onClick: remove }, t('uninstall'))));
}
