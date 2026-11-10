/** The MCP management page. */

import * as React from 'react';
import { Button } from '../../../../src/client/host-controls.js';
import { Modal } from '../../../../src/client/host-modal.js';
import { createController } from './controller.js';
import { ServerRow } from './row.js';

const h = React.createElement;

const CODE_KEYS = {
  conflict: 'conflict',
  locked: 'locked',
  'profile-unavailable': 'profileUnavailable',
  'shared-unavailable': 'sharedUnavailable',
  'shared-unmanaged': 'sharedUnmanaged',
  'shared-unknown': 'sharedUnknown',
  network: 'network',
  timeout: 'timeout',
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

function Notice({ children }) {
  return h('p', { className: 'dshmcp_notice dshmcp_notice_error', role: 'alert' }, children);
}

function RemoveDialog({ name, translate, busy, failure, close, confirm, fallbackFocus }) {
  return h(Modal, {
    title: translate('removeShared'),
    closeLabel: translate('close'),
    description: translate('removeSharedConfirm', { name }),
    busy, close, fallbackFocus,
    footer: [
      h(Button, {
        key: 'cancel', variant: 'outline', 'data-initial-focus': '', disabled: busy, onClick: close,
      }, translate('cancel')),
      h(Button, {
        key: 'confirm', variant: 'primary', className: 'dshui_modalDangerButton',
        disabled: busy || Boolean(failure), onClick: confirm,
      }, translate('removeShared')),
    ],
  }, (busy || failure) && h('div', { className: 'dshui_modalBody' },
    busy ? h('p', { className: 'dshmcp_notice', role: 'status' }, translate('removingShared')) : null,
    failure ? h(Notice, null, failureText(translate, failure)) : null,
  ));
}

function Skeleton() {
  return h('div', { className: 'dshmcp_rows', 'aria-hidden': true },
    h('div', { className: 'dshmcp_skeletonRow' },
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '34' }),
    ),
    h('div', { className: 'dshmcp_skeletonRow' },
      h('span', { className: 'dshmcp_skeletonLine', 'data-w': '46' }),
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
 * @param {{translate: (key: string, params?: object) => string, subscribeLocale: (listener: () => void) => () => void, localeVersion: () => number, Switch: React.ComponentType<{className?: string, checked: boolean, label: string, disabled: boolean, onChange: (checked: boolean) => void}>, Tag: React.ComponentType<{tone: 'neutral' | 'warning', children: React.ReactNode}>, createStore?: () => ReturnType<typeof createController>}} options
 */
export function createPage(options) {
  const { translate, subscribeLocale, localeVersion, Switch, Tag } = options;
  const createStore = options.createStore || createController;

  function Page() {
    const storeRef = React.useRef(null);
    if (storeRef.current === null) storeRef.current = createStore();
    const store = storeRef.current;
    const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    React.useSyncExternalStore(subscribeLocale, localeVersion, localeVersion);
    const heading = React.useRef(null);
    const [selection, setSelection] = React.useState(null);

    const servers = snapshot.state && Array.isArray(snapshot.state.servers) ? snapshot.state.servers : [];
    const { busy, action } = snapshot;
    const loading = snapshot.state === null && snapshot.status !== 'error';
    const loadFailure = snapshot.error ? failureText(translate, snapshot.error) : null;
    const sharedAction = action?.kind === 'deleteShared';
    const actionServer = action && !sharedAction && servers.find(server => server.id === action.id && server.name === action.name);
    const actionFailureText = action?.error ? failureText(translate, action.error) : null;
    const removalNotice = sharedAction && action.removal
      ? translate(action.removal === 'pending' ? 'sharedPending' : 'sharedRemoved', { name: action.name })
      : null;

    function openRemoval(server) {
      const { id, name, rowHash } = server;
      setSelection({ target: { id, name, rowHash }, revision: snapshot.state.revision });
    }

    async function confirmRemoval() {
      if (busy || selection.failure) return;
      const result = await store.deleteShared(selection.target, selection.revision);
      setSelection(current => current !== selection ? current : result.ok ? null : { ...current, failure: result });
    }

    React.useEffect(() => {
      store.start();
      return () => store.stop();
    }, [store]);

    return h('section', {
      className: 'dshmcp_page',
      'aria-labelledby': 'dshmcp-title',
      'aria-busy': loading ? 'true' : undefined,
    },
      h('h2', { className: 'dshmcp_title', id: 'dshmcp-title', ref: heading, tabIndex: -1 }, translate('title')),
      loading ? h(Skeleton) : null,
      loadFailure && snapshot.state === null
        ? h('div', { className: 'dshmcp_group dshmcp_messagePanel', role: 'alert' },
          h('p', { className: 'dshmcp_messageTitle' }, translate('loadFailed')),
          loadFailure === translate('loadFailed') ? null : h('p', { className: 'dshmcp_hint' }, loadFailure),
        )
        : null,
      snapshot.state !== null
        ? h(React.Fragment, null,
          loadFailure ? h(Notice, null, loadFailure) : null,
          actionFailureText && !actionServer && !selection ? h(Notice, null, action.name, ' — ', actionFailureText) : null,
          removalNotice ? h('p', { className: 'dshmcp_notice', role: 'status' }, removalNotice) : null,
          servers.length > 0
            ? h('ul', {
              className: 'dshmcp_rows', role: 'list',
              'data-shared-removal': servers.some(server => server.sharedRemovable) ? '' : undefined,
            },
              servers.map((server, index) => h(ServerRow, {
                key: server.editable ? `service:${server.id}` : `readonly:${index}`,
                server,
                Switch,
                Tag,
                translate,
                busy,
                saving: busy && server === actionServer,
                failure: server === actionServer ? actionFailureText : null,
                onToggle: store.setEnabled,
                onRemove: openRemoval,
              })),
            )
            : h('div', { className: 'dshmcp_group dshmcp_messagePanel' },
              h('p', { className: 'dshmcp_messageTitle' }, translate('emptyTitle')),
            ),
        )
        : null,
      selection ? h(RemoveDialog, {
        name: selection.target.name, translate, busy, failure: selection.failure,
        close: () => setSelection(null), confirm: confirmRemoval, fallbackFocus: heading,
      }) : null,
    );
  }

  function SafePage() {
    return h(Boundary, { fallback: translate('internal') }, h(Page));
  }
  SafePage.displayName = 'McpManagerPage';

  return SafePage;
}
