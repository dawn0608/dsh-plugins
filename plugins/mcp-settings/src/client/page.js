/** The MCP settings page and its inline editor. */

import * as React from 'react';
import { createController } from './controller.js';
import {
  blankForm,
  blankPair,
  contextFor,
  errorText,
  serverLabel,
  serverToForm,
  validateForm,
} from './model.js';

const h = React.createElement;

const CODE_KEYS = {
  conflict: 'conflict',
  locked: 'locked',
  'profile-unavailable': 'profileUnavailable',
  network: 'network',
  unauthorized: 'unauthorized',
  'read-only': 'readOnly',
  'not-found': 'conflict',
  'parse-failed': 'loadFailed',
  'verify-failed': 'internal',
  'write-failed': 'internal',
  invalid: 'invalid',
  internal: 'internal',
};

const READ_ONLY_KEYS = {
  'not-insert': 'readOnlyNotInsert',
  'block-shape': 'readOnlyBlockShape',
  'row-shape': 'readOnlyRowShape',
  'missing-id': 'readOnlyMissingId',
  'duplicate-id': 'readOnlyDuplicateId',
  'conditional-disabled': 'readOnlyConditional',
  'missing-name': 'readOnlyMissingName',
  'config-invalid': 'readOnlyConfig',
  'config-enabled': 'readOnlyConfigEnabled',
};

function failureText(translate, failure) {
  const key = CODE_KEYS[(failure && failure.code) || 'internal'] || 'internal';
  return translate(key, failure && failure.params ? failure.params : undefined);
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
    if (this.state.failed) return h('p', { className: 'dshmcp_error' }, this.props.fallback);
    return this.props.children;
  }
}

/**
 * @param {{translate: (key: string, params?: object) => string, subscribeLocale: (listener: () => void) => () => void, localeVersion: () => number, createStore?: () => ReturnType<typeof createController>}} options
 */
export function createPage(options) {
  const { translate, subscribeLocale, localeVersion } = options;
  const createStore = options.createStore || createController;

  function FieldError({ id, text }) {
    if (!text) return null;
    return h('span', { className: 'dshmcp_fieldError', id, role: 'alert' }, text);
  }

  function Notice({ children, tone }) {
    if (!children) return null;
    return h('p', { className: `dshmcp_notice dshmcp_notice_${tone || 'info'}`, role: 'status' }, children);
  }

  function ServerRow(props) {
    const { server, busy, confirm, onEdit, onAskDelete, onCancelDelete, onDelete, onToggle } = props;
    const name = serverLabel(server, translate);
    const readOnlyText = server.editable
      ? null
      : translate(READ_ONLY_KEYS[server.readOnlyCode] || 'readOnlyConfig');
    const tools = server.tools;
    const status = server.enabled === false
      ? translate('disabled')
      : tools === null || tools === undefined
        ? translate('toolsWaiting')
        : tools > 0
          ? translate('tools', { count: tools })
          : translate('toolsNone');
    const transport = server.transport === 'stdio'
      ? translate('transportStdio')
      : server.transport === 'streamable-http'
        ? translate('transportHttp')
        : translate('transportUnknown');
    const deleting = confirm === true;
    const rowBusy = busy && busy.id === server.id ? busy.action : null;
    return h('li', { className: 'dshmcp_row', 'data-disabled': server.enabled === false ? 'true' : undefined },
      h('div', { className: 'dshmcp_rowMain' },
        h('div', { className: 'dshmcp_rowTitle' },
          h('span', { className: 'dshmcp_name' }, name),
          h('span', { className: 'dshmcp_badge' }, transport),
          server.duplicate ? h('span', { className: 'dshmcp_badge dshmcp_badge_warn', title: translate('duplicateHint') }, translate('duplicate')) : null,
          readOnlyText ? h('span', { className: 'dshmcp_badge', title: readOnlyText }, translate('readOnly')) : null,
        ),
        h('div', { className: 'dshmcp_rowMeta' },
          h('span', { className: server.enabled === false ? 'dshmcp_state dshmcp_state_off' : 'dshmcp_state' }, status),
          readOnlyText ? h('span', { className: 'dshmcp_hint' }, readOnlyText) : null,
        ),
      ),
      h('div', { className: 'dshmcp_rowActions' },
        server.editable && server.enabled !== null
          ? h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': server.enabled === false ? 'false' : 'true',
            'aria-label': translate('enabledLabel'),
            className: 'dshmcp_switch',
            'data-on': server.enabled === false ? undefined : 'true',
            disabled: Boolean(rowBusy),
            onClick: () => onToggle(server),
          }, h('span', { className: 'dshmcp_switchThumb' }))
          : null,
        server.editable
          ? h('button', {
            type: 'button',
            className: 'dshmcp_button',
            disabled: Boolean(rowBusy),
            onClick: () => onEdit(server),
          }, translate('edit'))
          : null,
        deleting
          ? h('span', { className: 'dshmcp_confirm' },
            h('span', { className: 'dshmcp_hint' }, translate('confirmDeleteHint')),
            h('button', {
              type: 'button',
              className: 'dshmcp_button dshmcp_button_danger',
              disabled: Boolean(rowBusy),
              onClick: () => onDelete(server),
            }, rowBusy === 'delete' ? translate('saving') : translate('confirmDelete')),
            h('button', { type: 'button', className: 'dshmcp_button', onClick: onCancelDelete }, translate('cancel')),
          )
          : h('button', {
            type: 'button',
            className: 'dshmcp_button dshmcp_button_quiet',
            'aria-label': `${translate('delete')} ${name}`,
            disabled: Boolean(rowBusy) || server.deletable === false,
            onClick: () => onAskDelete(server),
          }, translate('delete')),
      ),
    );
  }

  function PairEditor(props) {
    const { kind, index, pair, errors, focus, update, remove } = props;
    const base = `${kind}[${index}]`;
    const keyError = errors.find(item => item.field === `${base}.key`);
    const valueError = errors.find(item => item.field === `${base}.value`);
    const keyId = `${kind}-${index}-key`;
    const valueId = `${kind}-${index}-value`;
    const hidden = pair.mode === 'keep';
    const reference = pair.mode === 'ref';
    return h('div', { className: 'dshmcp_pair' },
      h('div', { className: 'dshmcp_pairInputs' },
        h('label', { className: 'dshmcp_pairField' },
          h('span', { className: 'dshmcp_label' }, translate('key')),
          h('input', {
            id: keyId,
            ref: focus(`${base}.key`),
            className: 'dshmcp_input dshmcp_keyInput',
            value: pair.key,
            disabled: hidden,
            'aria-invalid': keyError ? 'true' : undefined,
            'aria-describedby': keyError ? `${keyId}-error` : undefined,
            onChange: event => update({ key: event.target.value }),
          }),
        ),
        h('label', { className: 'dshmcp_pairField' },
          h('span', { className: 'dshmcp_label' }, translate('value')),
          hidden
            ? h('span', { className: 'dshmcp_hidden' }, translate('hidden'))
            : reference
              ? h('input', {
                id: valueId,
                ref: focus(`${base}.value`),
                className: 'dshmcp_input',
                value: pair.variable,
                placeholder: translate('refVariable'),
                'aria-invalid': valueError ? 'true' : undefined,
                'aria-describedby': valueError ? `${valueId}-error` : undefined,
                onChange: event => update({ variable: event.target.value }),
              })
              : h('input', {
                id: valueId,
                ref: focus(`${base}.value`),
                className: 'dshmcp_input',
                value: pair.value,
                'aria-invalid': valueError ? 'true' : undefined,
                'aria-describedby': valueError ? `${valueId}-error` : undefined,
                onChange: event => update({ value: event.target.value }),
              }),
        ),
        h('label', { className: 'dshmcp_pairField dshmcp_pairMode' },
          h('span', { className: 'dshmcp_label' }, translate('valueMode')),
          h('select', {
            className: 'dshmcp_select',
            value: pair.mode,
            onChange: event => {
              const mode = event.target.value;
              if (mode === 'ref') update({ mode, value: '', variable: pair.variable || '' });
              else if (mode === 'literal') update({ mode, value: pair.value || '', variable: '' });
              else update({ mode: 'keep' });
            },
          },
          hidden ? h('option', { value: 'keep' }, translate('keep')) : null,
          h('option', { value: 'literal' }, translate('literal')),
          h('option', { value: 'ref' }, translate('reference')),
          ),
        ),
        h('button', {
          type: 'button',
          className: 'dshmcp_button dshmcp_button_quiet dshmcp_remove',
          'aria-label': translate('removePair'),
          onClick: remove,
        }, translate('remove')),
      ),
      reference && kind === 'headers'
        ? h('label', { className: 'dshmcp_pairField dshmcp_pairPrefix' },
          h('span', { className: 'dshmcp_label' }, translate('refPrefix')),
          h('input', {
            className: 'dshmcp_input',
            value: pair.prefix,
            onChange: event => update({ prefix: event.target.value }),
          }),
        )
        : null,
      hidden
        ? h('div', { className: 'dshmcp_pairHint' },
          h('span', { className: 'dshmcp_hint' }, translate('hiddenValueKept')),
          h('button', { type: 'button', className: 'dshmcp_button dshmcp_button_quiet', onClick: () => update({ mode: 'literal', value: '' }) }, translate('replace')),
          h('button', { type: 'button', className: 'dshmcp_button dshmcp_button_quiet', onClick: () => update({ mode: 'ref', variable: '', prefix: '' }) }, translate('reference')),
        )
        : null,
      h(FieldError, { id: `${keyId}-error`, text: keyError ? errorText(translate, keyError) : null }),
      h(FieldError, { id: `${valueId}-error`, text: valueError ? errorText(translate, valueError) : null }),
    );
  }

  function Editor(props) {
    const { mode, target, form, errors, failure, busy, onChange, onSubmit, onClose } = props;
    const refs = React.useRef({});
    const focus = field => element => {
      if (element) refs.current[field] = element;
      else delete refs.current[field];
    };
    const errorFor = field => errors.find(item => item.field === field);
    const fieldError = (field, id) => h(FieldError, { id, text: errorFor(field) ? errorText(translate, errorFor(field)) : null });
    const set = patch => onChange({ ...form, ...patch });
    const updatePair = (kind, index, patch) => {
      const next = form[kind].map((pair, at) => (at === index ? { ...pair, ...patch } : pair));
      set({ [kind]: next });
    };
    const removePair = (kind, index) => set({ [kind]: form[kind].filter((_, at) => at !== index) });
    const addPair = kind => set({ [kind]: [...form[kind], blankPair()] });
    const title = mode === 'edit'
      ? translate('editTitle', { name: serverLabel(target || {}, translate) })
      : translate('addTitle');
    const submitting = busy && busy.action === 'save';
    const pairs = form.transport === 'stdio' ? form.env : form.headers;
    const pairKind = form.transport === 'stdio' ? 'env' : 'headers';
    const genericPairError = errors.find(item => item.field === pairKind && item.code === 'transport-invalid');

    React.useEffect(() => {
      if (errors.length === 0) return;
      const first = errors[0].field;
      const node = refs.current[first] || refs.current[String(first).replace(/\..*$/, '')];
      if (node && typeof node.focus === 'function' && !node.disabled) node.focus();
    }, [errors]);

    return h('form', {
      className: 'dshmcp_editor',
      onSubmit: event => {
        event.preventDefault();
        onSubmit();
      },
    },
    h('div', { className: 'dshmcp_editorHead' },
      h('h3', { className: 'dshmcp_editorTitle' }, title),
      h('button', {
        type: 'button',
        className: 'dshmcp_button dshmcp_button_quiet',
        'aria-label': translate('closeEditor'),
        onClick: onClose,
      }, '×'),
    ),
    failure ? h(Notice, { tone: 'error' }, failureText(translate, failure)) : null,
    errors.length > 0
      ? h('div', { className: 'dshmcp_summary', role: 'alert' },
        h('p', { className: 'dshmcp_summaryTitle' }, translate('errorSummary')),
        h('ul', { className: 'dshmcp_summaryList' }, errors.slice(0, 5).map((item, index) => h('li', { key: `${item.field}-${index}` }, errorText(translate, item)))),
      )
      : null,
    h('div', { className: 'dshmcp_grid' },
      h('label', { className: 'dshmcp_field' },
        h('span', { className: 'dshmcp_label' }, translate('name')),
        h('input', {
          ref: focus('name'),
          className: 'dshmcp_input',
          value: form.name,
          autoComplete: 'off',
          'aria-invalid': errorFor('name') ? 'true' : undefined,
          'aria-describedby': 'dshmcp-name-hint',
          onChange: event => set({ name: event.target.value }),
        }),
        h('span', { className: 'dshmcp_hint', id: 'dshmcp-name-hint' }, translate('nameHint')),
        fieldError('name', 'dshmcp-name-error'),
      ),
      h('label', { className: 'dshmcp_field' },
        h('span', { className: 'dshmcp_label' }, translate('transportLabel')),
        h('select', {
          className: 'dshmcp_select',
          value: form.transport,
          onChange: event => set({ transport: event.target.value }),
        },
        h('option', { value: 'stdio' }, translate('transportStdio')),
        h('option', { value: 'streamable-http' }, translate('transportHttp')),
        ),
      ),
    ),
    form.transport === 'stdio'
      ? h('div', { className: 'dshmcp_grid' },
        h('label', { className: 'dshmcp_field' },
          h('span', { className: 'dshmcp_label' }, translate('command')),
          h('input', {
            ref: focus('command'),
            className: 'dshmcp_input',
            value: form.command,
            spellCheck: false,
            autoComplete: 'off',
            'aria-invalid': errorFor('command') ? 'true' : undefined,
            onChange: event => set({ command: event.target.value }),
          }),
          h('span', { className: 'dshmcp_hint' }, translate('commandHint')),
          fieldError('command', 'dshmcp-command-error'),
        ),
        h('label', { className: 'dshmcp_field' },
          h('span', { className: 'dshmcp_label' }, translate('cwd')),
          h('input', {
            ref: focus('cwd'),
            className: 'dshmcp_input',
            value: form.cwd,
            onChange: event => set({ cwd: event.target.value }),
          }),
          fieldError('cwd', 'dshmcp-cwd-error'),
        ),
      )
      : h('div', { className: 'dshmcp_grid' },
        h('label', { className: 'dshmcp_field dshmcp_fieldWide' },
          h('span', { className: 'dshmcp_label' }, translate('url')),
          h('input', {
            ref: focus('url'),
            className: 'dshmcp_input',
            value: form.url,
            spellCheck: false,
            autoComplete: 'off',
            'aria-invalid': errorFor('url') ? 'true' : undefined,
            onChange: event => set({ url: event.target.value }),
          }),
          h('span', { className: 'dshmcp_hint' }, translate('urlHint')),
          fieldError('url', 'dshmcp-url-error'),
        ),
      ),
    form.transport === 'stdio'
      ? h('label', { className: 'dshmcp_field' },
        h('span', { className: 'dshmcp_label' }, translate('args')),
        h('textarea', {
          ref: focus('args'),
          className: 'dshmcp_textarea',
          rows: 3,
          value: form.argsText,
          spellCheck: false,
          onChange: event => set({ argsText: event.target.value }),
        }),
        h('span', { className: 'dshmcp_hint' }, translate('argsHint')),
        errors.filter(item => /^args\[\d+\]$/.test(item.field)).map((item, index) => h(FieldError, {
          key: `args-${index}`,
          id: `dshmcp-args-error-${index}`,
          text: errorText(translate, item),
        })),
      )
      : null,
    h('div', { className: 'dshmcp_sectionBlock' },
      h('div', { className: 'dshmcp_sectionHead' },
        h('span', { className: 'dshmcp_label' }, form.transport === 'stdio' ? translate('env') : translate('headers')),
        h('button', {
          type: 'button',
          className: 'dshmcp_button dshmcp_button_quiet',
          onClick: () => addPair(pairKind),
        }, form.transport === 'stdio' ? translate('addEnv') : translate('addHeader')),
      ),
      h('p', { className: 'dshmcp_hint' }, form.transport === 'stdio' ? translate('envHint') : translate('headersHint')),
      genericPairError ? h(FieldError, { id: 'dshmcp-pair-error', text: errorText(translate, genericPairError) }) : null,
      pairs.length === 0
        ? h('p', { className: 'dshmcp_emptyPairs' }, '—')
        : pairs.map((pair, index) => h(PairEditor, {
          key: `${pairKind}-${index}`,
          kind: pairKind,
          index,
          pair,
          errors,
          focus,
          update: patch => updatePair(pairKind, index, patch),
          remove: () => removePair(pairKind, index),
        })),
    ),
    h('label', { className: 'dshmcp_toggleRow' },
      h('input', {
        type: 'checkbox',
        className: 'dshmcp_checkbox',
        checked: form.enabled,
        onChange: event => set({ enabled: event.target.checked }),
      }),
      h('span', { className: 'dshmcp_label' }, translate('enabledLabel')),
    ),
    h('div', { className: 'dshmcp_editorActions' },
      h('button', { type: 'button', className: 'dshmcp_button', onClick: onClose, disabled: submitting }, translate('cancel')),
      h('button', { type: 'submit', className: 'dshmcp_button dshmcp_button_primary', disabled: submitting }, submitting ? translate('saving') : translate('save')),
    ),
    );
  }

  function Page() {
    const storeRef = React.useRef(null);
    if (storeRef.current === null) storeRef.current = createStore();
    const store = storeRef.current;
    const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    React.useSyncExternalStore(subscribeLocale, localeVersion, localeVersion);

    const [editor, setEditor] = React.useState(null);
    const [confirmId, setConfirmId] = React.useState(null);
    const [actionError, setActionError] = React.useState(null);
    const serverList = snapshot.state && Array.isArray(snapshot.state.servers) ? snapshot.state.servers : [];

    React.useEffect(() => {
      store.load();
      return () => store.stop();
    }, [store]);

    const openAdd = () => {
      setActionError(null);
      setEditor({ mode: 'add', target: null, form: blankForm('stdio'), errors: [], failure: null });
    };

    const openEdit = server => {
      setActionError(null);
      setEditor({ mode: 'edit', target: server, form: serverToForm(server), errors: [], failure: null });
    };

    const closeEditor = () => setEditor(null);

    const submit = async () => {
      if (editor === null) return;
      const { draft, errors } = validateForm(editor.form, contextFor(serverList, editor.target));
      if (errors.length > 0) {
        setEditor({ ...editor, errors });
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
      setEditor(current => (current === null ? null : { ...current, failure: { code: result.code, params: result.params } }));
    };

    const toggle = async server => {
      setActionError(null);
      const result = await store.setEnabled(server, server.enabled === false);
      if (!result.ok) setActionError({ code: result.code, params: result.params });
    };

    const removeServer = async server => {
      setActionError(null);
      const result = await store.remove(server);
      if (result.ok) setConfirmId(null);
      else setActionError({ code: result.code, params: result.params });
    };

    const notice = snapshot.notice ? translate(snapshot.notice.code === 'deleted' ? 'deleted' : snapshot.notice.code === 'savedPending' ? 'savedPending' : 'saved') : null;
    const loadError = snapshot.error ? failureText(translate, snapshot.error) : null;
    const actionFailure = actionError ? failureText(translate, actionError) : null;
    const patchPath = snapshot.state && typeof snapshot.state.patchPath === 'string' ? snapshot.state.patchPath : '';

    return h('section', { className: 'dshmcp_section', 'aria-label': translate('title') },
      h('h2', { className: 'dshmcp_heading' }, translate('title')),
      h('p', { className: 'dshmcp_intro' }, translate('intro')),
      snapshot.status === 'loading' && snapshot.state === null
        ? h('p', { className: 'dshmcp_loading' }, translate('loading'))
        : null,
      snapshot.status === 'error' && snapshot.state === null
        ? h('div', { className: 'dshmcp_errorPanel', role: 'alert' },
          h('p', { className: 'dshmcp_error' }, `${translate('loadFailed')}：${loadError || ''}`),
          h('button', { type: 'button', className: 'dshmcp_button', onClick: () => store.load() }, translate('retry')),
        )
        : null,
      snapshot.state !== null
        ? h(React.Fragment, null,
          h('div', { className: 'dshmcp_toolbar' },
            h('button', { type: 'button', className: 'dshmcp_button dshmcp_button_primary', onClick: openAdd }, translate('add')),
            h('button', { type: 'button', className: 'dshmcp_button dshmcp_button_quiet', onClick: () => store.load() }, translate('refresh')),
            patchPath
              ? h('span', { className: 'dshmcp_pathWrap' },
                h('span', { className: 'dshmcp_label' }, translate('pathLabel')),
                h('code', { className: 'dshmcp_path', title: patchPath }, patchPath))
              : null,
          ),
          loadError && snapshot.status !== 'error' ? h(Notice, { tone: 'error' }, loadError) : null,
          actionFailure ? h(Notice, { tone: 'error' }, actionFailure) : null,
          notice ? h(Notice, { tone: snapshot.notice.code === 'savedPending' ? 'warn' : 'info' }, notice) : null,
          editor !== null
            ? h(Editor, {
              mode: editor.mode,
              target: editor.target,
              form: editor.form,
              errors: editor.errors,
              failure: editor.failure,
              busy: snapshot.busy,
              onChange: form => setEditor(current => (current === null ? null : { ...current, form })),
              onSubmit: submit,
              onClose: closeEditor,
            })
            : null,
          serverList.length === 0
            ? h('div', { className: 'dshmcp_empty' },
              h('p', { className: 'dshmcp_emptyTitle' }, translate('emptyTitle')),
              h('p', { className: 'dshmcp_hint' }, translate('emptyHint')),
            )
            : h('ul', { className: 'dshmcp_list' }, serverList.map((server, index) => h(ServerRow, {
              key: server.id || `${server.name || 'entry'}-${index}`,
              server,
              busy: snapshot.busy,
              confirm: confirmId === (server.id || server.name),
              onEdit: openEdit,
              onAskDelete: item => setConfirmId(item.id || item.name),
              onCancelDelete: () => setConfirmId(null),
              onDelete: removeServer,
              onToggle: toggle,
            }))),
        )
        : null,
    );
  }

  function SafePage() {
    return h(Boundary, { fallback: translate('internal') }, h(Page));
  }
  SafePage.displayName = 'McpSettingsPage';

  return SafePage;
}
