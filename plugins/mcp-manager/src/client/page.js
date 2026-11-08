/** The MCP management page: server list, dedicated editor and delete dialog. */

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
    h('div', { className: 'dshmcp_skeletonRow' },
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '34' }),
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '72' }),
    ),
    h('div', { className: 'dshmcp_skeletonRow' },
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '46' }),
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '64' }),
    ),
  );
}

// The settings shell owns scrolling. Find its scroll container without relying on its private CSS classes.
function scrollContainer(element) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll|overlay)$/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.scrollingElement;
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
 * @param {{translate: (key: string, params?: object) => string, subscribeLocale: (listener: () => void) => () => void, localeVersion: () => number, Switch: React.ComponentType<{checked: boolean, label: string, disabled: boolean, onChange: (checked: boolean) => void}>, createStore?: () => ReturnType<typeof createController>}} options
 */
export function createPage(options) {
  const { translate, subscribeLocale, localeVersion, Switch } = options;
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
    const panelRef = React.useRef(null);
    const listPosition = React.useRef(null);
    const deleteTrigger = React.useRef(null);
    const addButtonRef = React.useRef(null);
    const rowButtonsRef = React.useRef(new Map());

    const servers = snapshot.state && Array.isArray(snapshot.state.servers) ? snapshot.state.servers : [];
    const inEditor = editor !== null;
    const busy = snapshot.busy;
    const loading = snapshot.state === null && snapshot.status !== 'error';
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

    React.useLayoutEffect(() => {
      const position = listPosition.current;
      if (!position) return;
      const { scroller, top, serverId } = position;
      if (inEditor) {
        if (scroller) scroller.scrollTop = 0;
        return;
      }
      listPosition.current = null;
      if (scroller) scroller.scrollTop = top;
      const rowButton = rowButtonsRef.current.get(serverId);
      if (rowButton) rowButton.focus({ preventScroll: true });
      else addButtonRef.current?.focus();
    }, [inEditor]);

    const openEditor = (mode, target = null) => {
      if (busy) return;
      const scroller = scrollContainer(panelRef.current);
      listPosition.current = { scroller, top: scroller?.scrollTop || 0, serverId: target?.id };
      setActionFailure(null);
      setEditor({
        mode,
        target,
        form: target ? serverToForm(target) : blankForm(),
        errors: [],
        failure: null,
      });
    };

    const closeEditor = () => {
      if (!busy) setEditor(null);
    };

    const registerRowButton = (server, element) => {
      const key = server.id || server.name;
      if (!key) return;
      if (element) rowButtonsRef.current.set(key, element);
      else rowButtonsRef.current.delete(key);
    };

    const submit = async () => {
      if (!editor || busy) return;
      const { draft, errors } = validateForm(editor.form, contextFor(servers, editor.target));
      if (errors.length > 0) {
        setEditor(current => (current === null ? null : { ...current, errors, failure: null }));
        return;
      }
      const result = await store.save(draft, { mode: editor.mode, target: editor.target });
      if (result.ok) {
        setEditor(null);
        return;
      }
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        setEditor(current => (current === null ? null : { ...current, errors: result.errors, failure: null }));
        return;
      }
      setEditor(current => (current === null ? null : { ...current, errors: [], failure: failureText(translate, result) }));
    };

    const toggle = async (server, enabled) => {
      if (busy) return;
      setActionFailure(null);
      const result = await store.setEnabled(server, enabled);
      if (!result.ok) setActionFailure({ code: result.code, params: result.params });
    };

    const askDelete = (server, trigger) => {
      if (busy) return;
      deleteTrigger.current = trigger;
      setActionFailure(null);
      setDeleteFailure(null);
      setDeleteTarget(server);
    };

    const cancelDelete = () => {
      if (busy) return;
      setDeleteTarget(null);
      setDeleteFailure(null);
    };

    const confirmDelete = async () => {
      if (!deleteTarget || busy) return;
      setDeleteFailure(null);
      const result = await store.remove(deleteTarget);
      if (result.ok) {
        setDeleteTarget(null);
        if (inEditor) {
          listPosition.current = { ...listPosition.current, top: 0, serverId: undefined };
          setEditor(null);
        }
        setTimeout(() => {
          if (addButtonRef.current) addButtonRef.current.focus();
        }, 0);
        return;
      }
      setDeleteFailure(failureText(translate, result));
    };

    return h('section', {
      ref: panelRef,
      className: 'dshmcp_page',
      'aria-labelledby': 'dshmcp-title',
      'aria-busy': loading ? 'true' : undefined,
    },
      inEditor
        ? h(EditorCard, {
          mode: editor.mode,
          Switch,
          target: editor.target,
          form: editor.form,
          errors: editor.errors,
          failure: editor.failure,
          busy,
          translate,
          onChange: form => setEditor(current => current && { ...current, form, errors: [], failure: null }),
          onSubmit: submit,
          onClose: closeEditor,
          onDelete: event => askDelete(editor.target, event.currentTarget),
        })
        : h(React.Fragment, null,
          h('header', { className: 'dshmcp_headingRow' },
            h('h2', { className: 'dshmcp_title', id: 'dshmcp-title' }, translate('title')),
            h('div', { className: 'dshmcp_toolbar' },
              h('button', {
                type: 'button',
                className: 'dshmcp_iconButton dshmcp_refresh',
                'aria-label': translate('refresh'),
                title: translate('refresh'),
                'aria-busy': refreshing ? 'true' : undefined,
                disabled: refreshing || Boolean(busy),
                onClick: refresh,
              }, h('span', { className: refreshing ? 'dshmcp_spin' : undefined }, h(RefreshIcon, { size: 16 }))),
              h('button', {
                type: 'button',
                ref: addButtonRef,
                className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonPrimary',
                disabled: snapshot.state === null || Boolean(busy),
                onClick: () => openEditor('add'),
              }, h(PlusIcon, { size: 14 }), h('span', null, translate('add'))),
            ),
          ),
          loading ? h(Skeleton) : null,
          loadFailure && snapshot.state === null
            ? h('div', { className: 'dshmcp_group dshmcp_messagePanel', role: 'alert' },
              h('p', { className: 'dshmcp_messageTitle' }, translate('loadFailed')),
              loadFailure === translate('loadFailed') ? null : h('p', { className: 'dshmcp_hint' }, loadFailure),
              h('button', { type: 'button', className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonOutline', onClick: refresh }, translate('retry')),
            )
            : null,
          snapshot.state !== null
            ? h(React.Fragment, null,
              loadFailure ? h(Notice, { tone: 'error', onRetry: refresh, retryLabel: translate('retry') }, loadFailure) : null,
              actionFailureText ? h(Notice, { tone: 'error' }, actionFailureText) : null,
              noticeText ? h(Notice, { tone: noticeTone }, noticeText) : null,
              servers.length > 0
                ? h('ul', { className: 'dshmcp_rows', role: 'list' },
                  servers.map((server, index) => h(ServerRow, {
                    key: server.editable ? `editable:${server.id}` : `readonly:${index}`,
                    server,
                    Switch,
                    translate,
                    busy,
                    onEdit: target => openEditor('edit', target),
                    onDelete: askDelete,
                    onToggle: toggle,
                    onRegisterRow: registerRowButton,
                  })),
                )
                : h('div', { className: 'dshmcp_group dshmcp_messagePanel' },
                  h('p', { className: 'dshmcp_messageTitle' }, translate('emptyTitle')),
                ),
            )
            : null,
        ),
      h(DeleteDialog, {
        open: deleteTarget !== null,
        trigger: deleteTrigger.current,
        name: deleteTarget === null ? '' : serverLabel(deleteTarget, translate),
        busy: Boolean(busy && busy.action === 'delete'),
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
  SafePage.displayName = 'McpManagerPage';

  return SafePage;
}
