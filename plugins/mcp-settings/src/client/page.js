/** The MCP settings page: header, server rows, inline editor and delete dialog. */

import * as React from 'react';
import { createController } from './controller.js';
import { DeleteDialog } from './dialog.js';
import { EditorCard } from './editor.js';
import { PlusIcon, RefreshIcon } from './icons.js';
import { blankForm, contextFor, serverLabel, serverToForm, validateForm } from './model.js';
import { ServerRow } from './row.js';

const h = React.createElement;

const CODE_KEYS = {
  conflict: 'conflict',
  locked: 'locked',
  'profile-unavailable': 'profileUnavailable',
  network: 'network',
  unauthorized: 'unauthorized',
  'read-only': 'readOnlyFailure',
  'not-found': 'conflict',
  'parse-failed': 'loadFailed',
  'verify-failed': 'internal',
  'write-failed': 'internal',
  invalid: 'invalid',
  internal: 'internal',
};

function failureText(translate, failure) {
  const key = CODE_KEYS[(failure && failure.code) || 'internal'] || 'internal';
  return translate(key, failure && failure.params ? failure.params : undefined);
}

function Notice(props) {
  const { tone, children, onRetry, retryLabel } = props;
  if (!children) return null;
  return h('div', { className: 'dshmcp_noticeRow', role: tone === 'error' ? 'alert' : 'status' },
    h('p', { className: `dshmcp_notice dshmcp_notice_${tone}` }, children),
    onRetry ? h('button', { type: 'button', className: 'dshmcp_retry', onClick: onRetry }, retryLabel) : null,
  );
}

function Skeleton() {
  return h('div', { className: 'dshmcp_rows', 'aria-hidden': true },
    h('div', { className: 'dshmcp_card dshmcp_skeletonCard' },
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '34' }),
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '72' }),
    ),
    h('div', { className: 'dshmcp_card dshmcp_skeletonCard' },
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '46' }),
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '64' }),
    ),
  );
}

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return h('p', { className: 'dshmcp_notice dshmcp_notice_error' }, this.props.fallback);
    return this.props.children;
  }
}

/**
 * @param {{translate: (key: string, params?: object) => string, subscribeLocale: (listener: () => void) => () => void, localeVersion: () => number, createStore?: () => ReturnType<typeof createController>}} options
 */
export function createPage(options) {
  const { translate, subscribeLocale, localeVersion } = options;
  const createStore = options.createStore || createController;

  function Page() {
    const storeRef = React.useRef(null);
    if (storeRef.current === null) storeRef.current = createStore();
    const store = storeRef.current;
    const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    React.useSyncExternalStore(subscribeLocale, localeVersion, localeVersion);

    const [editor, setEditor] = React.useState(null);
    const [deleteTarget, setDeleteTarget] = React.useState(null);
    const [deleteFailure, setDeleteFailure] = React.useState(null);
    const [actionFailure, setActionFailure] = React.useState(null);
    const returnFocusRef = React.useRef(null);
    const addButtonRef = React.useRef(null);
    const editButtonsRef = React.useRef(new Map());

    const servers = snapshot.state && Array.isArray(snapshot.state.servers) ? snapshot.state.servers : [];
    const patchPath = snapshot.state && typeof snapshot.state.patchPath === 'string' ? snapshot.state.patchPath : '';
    const loading = snapshot.status === 'loading' && snapshot.state === null;
    const refreshing = snapshot.refreshing === true || snapshot.status === 'loading';
    const loadFailure = snapshot.error ? failureText(translate, snapshot.error) : null;
    const actionFailureText = actionFailure ? failureText(translate, actionFailure) : null;

    let noticeText = null;
    let noticeTone = 'success';
    if (snapshot.notice) {
      if (snapshot.notice.code === 'saved') noticeText = translate('saved', snapshot.notice.params || {});
      else if (snapshot.notice.code === 'deleted') noticeText = translate('deleted', snapshot.notice.params || {});
      else if (snapshot.notice.code === 'savedPending') {
        noticeText = translate('savedPending');
        noticeTone = 'warn';
      }
    }

    React.useEffect(() => {
      store.load();
      return () => store.stop();
    }, [store]);

    React.useEffect(() => {
      if (!snapshot.notice) return undefined;
      if (snapshot.notice.code !== 'saved' && snapshot.notice.code !== 'deleted') return undefined;
      const timer = setTimeout(() => store.dismissNotice(), 4000);
      return () => clearTimeout(timer);
    }, [snapshot.notice, store]);

    // A conflict reloads the list; point the open editor at the fresh row so a retry uses its new fingerprint.
    React.useEffect(() => {
      setEditor(current => {
        if (!current || current.mode !== 'edit' || !current.target) return current;
        const fresh = servers.find(item => (item.id && current.target.id ? item.id === current.target.id : item.name === current.target.name));
        if (!fresh || fresh.rowHash === current.target.rowHash) return current;
        return { ...current, target: fresh };
      });
    }, [snapshot.state]);

    const refresh = () => {
      store.dismissNotice();
      store.load();
    };

    const openAdd = event => {
      setActionFailure(null);
      returnFocusRef.current = event.currentTarget;
      setEditor({ mode: 'add', target: null, form: blankForm('stdio'), errors: [], failure: null });
    };

    const openEdit = (server, trigger) => {
      setActionFailure(null);
      returnFocusRef.current = trigger;
      setEditor({ mode: 'edit', target: server, form: serverToForm(server), errors: [], failure: null });
    };

    const restoreFocus = serverId => {
      const fallback = returnFocusRef.current;
      setTimeout(() => {
        const registered = serverId === undefined ? undefined : editButtonsRef.current.get(serverId);
        const node = registered && registered.isConnected
          ? registered
          : fallback && fallback.isConnected
            ? fallback
            : addButtonRef.current;
        if (node && typeof node.focus === 'function') node.focus();
      }, 0);
    };

    const closeEditor = () => {
      const serverId = editor && editor.mode === 'edit' && editor.target ? editor.target.id : undefined;
      setEditor(null);
      restoreFocus(serverId);
    };

    const registerEditButton = (server, element) => {
      const key = server.id || server.name;
      if (!key) return;
      if (element) editButtonsRef.current.set(key, element);
      else editButtonsRef.current.delete(key);
    };

    const submit = async () => {
      if (editor === null || (snapshot.busy && snapshot.busy.action === 'save')) return;
      const { draft, errors } = validateForm(editor.form, contextFor(servers, editor.target));
      if (errors.length > 0) {
        setEditor(current => (current === null ? null : { ...current, errors, failure: null }));
        return;
      }
      const serverId = editor.mode === 'edit' && editor.target ? editor.target.id : undefined;
      const result = await store.save(draft, { mode: editor.mode, target: editor.target });
      if (result.ok) {
        setEditor(null);
        restoreFocus(serverId);
        return;
      }
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        setEditor(current => (current === null ? null : { ...current, errors: result.errors, failure: null }));
        return;
      }
      setEditor(current => (current === null ? null : { ...current, errors: [], failure: failureText(translate, result) }));
    };

    const toggle = async server => {
      setActionFailure(null);
      const result = await store.setEnabled(server, server.enabled === false);
      if (!result.ok) setActionFailure({ code: result.code, params: result.params });
    };

    const askDelete = (server, trigger) => {
      setActionFailure(null);
      setDeleteFailure(null);
      returnFocusRef.current = trigger;
      setDeleteTarget(server);
    };

    const cancelDelete = () => {
      if (snapshot.busy && snapshot.busy.action === 'delete') return;
      setDeleteTarget(null);
      setDeleteFailure(null);
    };

    const confirmDelete = async () => {
      if (deleteTarget === null || (snapshot.busy && snapshot.busy.action === 'delete')) return;
      setDeleteFailure(null);
      const result = await store.remove(deleteTarget);
      if (result.ok) {
        setDeleteTarget(null);
        setTimeout(() => {
          if (addButtonRef.current) addButtonRef.current.focus();
        }, 0);
        return;
      }
      setDeleteFailure(failureText(translate, result));
    };

    const editingId = editor && editor.mode === 'edit' && editor.target ? editor.target.id : undefined;
    const addOpen = editor !== null && editor.mode === 'add';
    const showAddButton = !addOpen;

    return h('section', {
      className: 'dshmcp_page',
      'aria-labelledby': 'dshmcp-title',
      'aria-busy': loading ? 'true' : undefined,
    },
      h('div', { className: 'dshmcp_pageHead' },
        h('div', { className: 'dshmcp_pageCopy' },
          h('h2', { className: 'dshmcp_title', id: 'dshmcp-title' }, translate('title')),
          h('p', { className: 'dshmcp_intro' }, translate('intro')),
        ),
        h('button', {
          type: 'button',
          className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonOutline dshmcp_refresh',
          'aria-busy': refreshing ? 'true' : undefined,
          disabled: refreshing,
          onClick: refresh,
        },
        h('span', { className: refreshing ? 'dshmcp_spin' : undefined }, h(RefreshIcon, { size: 14 })),
        h('span', null, translate('refresh')),
        ),
      ),
      loading ? h(Skeleton) : null,
      !loading && snapshot.state === null && loadFailure
        ? h('div', { className: 'dshmcp_errorPanel', role: 'alert' },
          h('p', { className: 'dshmcp_notice dshmcp_notice_error' }, translate('loadFailed')),
          h('p', { className: 'dshmcp_hint' }, loadFailure),
          h('button', { type: 'button', className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonOutline', onClick: refresh }, translate('retry')),
        )
        : null,
      snapshot.state !== null
        ? h(React.Fragment, null,
          loadFailure && snapshot.status !== 'error'
            ? h(Notice, { tone: 'error', onRetry: refresh, retryLabel: translate('retry') }, loadFailure)
            : null,
          actionFailureText ? h(Notice, { tone: 'error' }, actionFailureText) : null,
          noticeText ? h(Notice, { tone: noticeTone }, noticeText) : null,
          h('ul', { className: 'dshmcp_rows' },
            servers.map((server, index) => {
              const key = server.id || `${server.name || 'entry'}-${index}`;
              if (editingId !== undefined && server.id === editingId) {
                return h('li', { key, className: 'dshmcp_card dshmcp_editorCard' }, h(EditorCard, {
                  mode: 'edit',
                  target: editor.target,
                  form: editor.form,
                  errors: editor.errors,
                  failure: editor.failure,
                  busy: snapshot.busy,
                  translate,
                  onChange: form => setEditor(current => (current === null ? null : { ...current, form, failure: null })),
                  onSubmit: submit,
                  onClose: closeEditor,
                }));
              }
              return h(ServerRow, {
                key,
                server,
                translate,
                busy: snapshot.busy,
                onEdit: openEdit,
                onDelete: askDelete,
                onToggle: toggle,
                onRegisterEdit: registerEditButton,
              });
            }),
          ),
          servers.length === 0 && !addOpen
            ? h('div', { className: 'dshmcp_empty' },
              h('p', { className: 'dshmcp_emptyTitle' }, translate('emptyTitle')),
              h('p', { className: 'dshmcp_emptyHint' }, translate('emptyHint')),
            )
            : null,
          addOpen
            ? h('div', { className: 'dshmcp_card dshmcp_editorCard' }, h(EditorCard, {
              mode: 'add',
              target: null,
              form: editor.form,
              errors: editor.errors,
              failure: editor.failure,
              busy: snapshot.busy,
              translate,
              onChange: form => setEditor(current => (current === null ? null : { ...current, form, failure: null })),
              onSubmit: submit,
              onClose: closeEditor,
            }))
            : null,
          showAddButton
            ? h('button', {
              type: 'button',
              ref: addButtonRef,
              className: 'dshmcp_addButton',
              disabled: Boolean(snapshot.busy),
              onClick: openAdd,
            }, h(PlusIcon, { size: 14 }), h('span', null, translate('add')))
            : null,
          patchPath
            ? h('p', { className: 'dshmcp_footnote' },
              h('span', { className: 'dshmcp_footnoteLabel' }, translate('pathLabel')),
              h('code', { className: 'dshmcp_path', title: patchPath }, patchPath),
            )
            : null,
        )
        : null,
      h(DeleteDialog, {
        open: deleteTarget !== null,
        name: deleteTarget === null ? '' : serverLabel(deleteTarget, translate),
        busy: Boolean(snapshot.busy && snapshot.busy.action === 'delete'),
        failure: deleteFailure,
        translate,
        onCancel: cancelDelete,
        onConfirm: confirmDelete,
      }),
    );
  }

  function SafePage() {
    return h(Boundary, { fallback: translate('internal') }, h(Page));
  }
  SafePage.displayName = 'McpSettingsPage';

  return SafePage;
}
