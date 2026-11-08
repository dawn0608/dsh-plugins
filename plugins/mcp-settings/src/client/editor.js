/** Inline add/edit form for one MCP server. */

import * as React from 'react';
import { CloseIcon, TrashIcon } from './icons.js';
import { blankPair, errorText, serverLabel } from './model.js';

const h = React.createElement;

function FieldError({ id, text }) {
  if (!text) return null;
  return h('span', { className: 'dshmcp_fieldError', id, role: 'alert' }, text);
}

function PairEditor({ kind, index, pair, errors, translate, register, update, remove }) {
  const base = `${kind}[${index}]`;
  const keyError = errors.find(item => item.field === `${base}.key`);
  const valueError = errors.find(item => item.field === `${base}.value`);
  const keyId = `dshmcp-${kind}-${index}-key`;
  const valueId = `dshmcp-${kind}-${index}-value`;
  const hidden = pair.mode === 'keep';
  const reference = pair.mode === 'ref';
  const described = valueError ? `${valueId}-error` : undefined;

  const valueControl = hidden
    ? h('span', { className: 'dshmcp_hiddenValue' }, translate('hidden'))
    : reference
      ? h('input', {
        id: valueId,
        ref: register(`${base}.value`),
        className: 'dshmcp_input dshmcp_pairInput',
        value: pair.variable,
        placeholder: translate('refVariable'),
        autoComplete: 'off',
        spellCheck: false,
        'aria-invalid': valueError ? 'true' : undefined,
        'aria-describedby': described,
        onChange: event => update({ variable: event.target.value }),
      })
      : h('input', {
        id: valueId,
        ref: register(`${base}.value`),
        className: 'dshmcp_input dshmcp_pairInput',
        value: pair.value,
        autoComplete: 'off',
        spellCheck: false,
        'aria-invalid': valueError ? 'true' : undefined,
        'aria-describedby': described,
        onChange: event => update({ value: event.target.value }),
      });

  return h('div', { className: 'dshmcp_pair' },
    h('div', { className: 'dshmcp_pairRow' },
      h('label', { className: 'dshmcp_pairField', htmlFor: keyId },
        h('span', { className: 'dshmcp_label' }, translate('key')),
        h('input', {
          id: keyId,
          ref: register(`${base}.key`),
          className: 'dshmcp_input dshmcp_pairInput',
          value: pair.key,
          disabled: hidden,
          autoComplete: 'off',
          spellCheck: false,
          'aria-invalid': keyError ? 'true' : undefined,
          'aria-describedby': keyError ? `${keyId}-error` : undefined,
          onChange: event => update({ key: event.target.value }),
        }),
      ),
      h('label', { className: 'dshmcp_pairField', htmlFor: hidden ? undefined : valueId },
        h('span', { className: 'dshmcp_label' }, translate('value')),
        valueControl,
      ),
      h('label', { className: 'dshmcp_pairField dshmcp_pairSource' },
        h('span', { className: 'dshmcp_label' }, translate('source')),
        h('select', {
          className: 'dshmcp_select dshmcp_pairInput',
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
        className: 'dshmcp_iconButton dshmcp_pairRemove',
        'aria-label': translate('removePair'),
        title: translate('removePair'),
        onClick: remove,
      }, h(TrashIcon, { size: 14 })),
    ),
    reference && kind === 'headers'
      ? h('label', { className: 'dshmcp_pairField dshmcp_pairExtra' },
        h('span', { className: 'dshmcp_label' }, translate('refPrefix')),
        h('input', {
          className: 'dshmcp_input dshmcp_pairInput',
          value: pair.prefix,
          autoComplete: 'off',
          spellCheck: false,
          onChange: event => update({ prefix: event.target.value }),
        }),
      )
      : null,
    h(FieldError, { id: `${keyId}-error`, text: keyError ? errorText(translate, keyError) : null }),
    h(FieldError, { id: `${valueId}-error`, text: valueError ? errorText(translate, valueError) : null }),
  );
}

/**
 * @param {{mode: 'add'|'edit', target: object|null, form: object, errors: object[], failure: string|null, busy: object|null, translate: Function, onChange: Function, onSubmit: Function, onClose: Function}} props
 */
export function EditorCard(props) {
  const { mode, target, form, errors, failure, busy, translate, onChange, onSubmit, onClose } = props;
  const nameRef = React.useRef(null);
  const formRef = React.useRef(null);
  const refs = React.useRef({});
  const submitting = busy && busy.action === 'save';

  const register = field => element => {
    if (element) refs.current[field] = element;
    else delete refs.current[field];
  };

  React.useEffect(() => {
    if (nameRef.current) nameRef.current.focus();
    if (formRef.current && typeof formRef.current.scrollIntoView === 'function') {
      formRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, []);

  React.useEffect(() => {
    if (errors.length === 0) return;
    const first = errors[0].field;
    const node = refs.current[first] || refs.current[String(first).replace(/\..*$/, '')];
    if (node && typeof node.focus === 'function' && !node.disabled) node.focus();
  }, [errors]);

  const set = patch => onChange({ ...form, ...patch });
  const updatePair = (kind, index, patch) => {
    set({ [kind]: form[kind].map((pair, at) => (at === index ? { ...pair, ...patch } : pair)) });
  };
  const removePair = (kind, index) => set({ [kind]: form[kind].filter((_, at) => at !== index) });
  const addPair = kind => set({ [kind]: [...form[kind], blankPair()] });
  const errorFor = field => errors.find(item => item.field === field);
  const fieldError = (field, id) => h(FieldError, { id, text: errorFor(field) ? errorText(translate, errorFor(field)) : null });
  const title = mode === 'edit'
    ? translate('editTitle', { name: form.name.trim() || serverLabel(target || {}, translate) })
    : translate('add');
  const pairKind = form.transport === 'stdio' ? 'env' : 'headers';
  const pairs = form[pairKind];
  const genericPairError = errors.find(item => item.field === pairKind && item.code === 'transport-invalid');
  const summary = failure || (errors.length > 0 ? errorText(translate, errors[0]) : null);

  return h('form', {
    ref: formRef,
    className: 'dshmcp_editor',
    onSubmit: event => {
      event.preventDefault();
      onSubmit();
    },
    onKeyDown: event => {
      if (event.key !== 'Escape' || submitting) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
  },
  h('div', { className: 'dshmcp_editorHead' },
    h('h3', { className: 'dshmcp_editorTitle' }, title),
    h('button', {
      type: 'button',
      className: 'dshmcp_iconButton',
      'aria-label': translate('closeEditor'),
      title: translate('closeEditor'),
      onClick: onClose,
    }, h(CloseIcon, { size: 14 })),
  ),
  summary ? h('p', { className: 'dshmcp_formError', role: 'alert' }, summary) : null,
  h('div', { className: 'dshmcp_grid' },
    h('label', { className: 'dshmcp_field', htmlFor: 'dshmcp-name' },
      h('span', { className: 'dshmcp_label' }, translate('name')),
      h('input', {
        id: 'dshmcp-name',
        ref: element => {
          nameRef.current = element;
          register('name')(element);
        },
        className: 'dshmcp_input',
        value: form.name,
        autoComplete: 'off',
        spellCheck: false,
        'aria-invalid': errorFor('name') ? 'true' : undefined,
        'aria-describedby': errorFor('name') ? 'dshmcp-name-hint dshmcp-name-error' : 'dshmcp-name-hint',
        onChange: event => set({ name: event.target.value }),
      }),
      h('span', { className: 'dshmcp_hint', id: 'dshmcp-name-hint' }, translate('nameHint')),
      fieldError('name', 'dshmcp-name-error'),
    ),
    h('label', { className: 'dshmcp_field', htmlFor: 'dshmcp-transport' },
      h('span', { className: 'dshmcp_label' }, translate('transportLabel')),
      h('select', {
        id: 'dshmcp-transport',
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
    ? h(React.Fragment, null,
      h('div', { className: 'dshmcp_grid dshmcp_gridTwo' },
        h('label', { className: 'dshmcp_field', htmlFor: 'dshmcp-command' },
          h('span', { className: 'dshmcp_label' }, translate('command')),
          h('input', {
            id: 'dshmcp-command',
            ref: register('command'),
            className: 'dshmcp_input',
            value: form.command,
            autoComplete: 'off',
            spellCheck: false,
            'aria-invalid': errorFor('command') ? 'true' : undefined,
            'aria-describedby': errorFor('command') ? 'dshmcp-command-hint dshmcp-command-error' : 'dshmcp-command-hint',
            onChange: event => set({ command: event.target.value }),
          }),
          h('span', { className: 'dshmcp_hint', id: 'dshmcp-command-hint' }, translate('commandHint')),
          fieldError('command', 'dshmcp-command-error'),
        ),
        h('label', { className: 'dshmcp_field', htmlFor: 'dshmcp-cwd' },
          h('span', { className: 'dshmcp_label' }, translate('cwd')),
          h('input', {
            id: 'dshmcp-cwd',
            ref: register('cwd'),
            className: 'dshmcp_input',
            value: form.cwd,
            autoComplete: 'off',
            spellCheck: false,
            'aria-describedby': errorFor('cwd') ? 'dshmcp-cwd-error' : undefined,
            onChange: event => set({ cwd: event.target.value }),
          }),
          fieldError('cwd', 'dshmcp-cwd-error'),
        ),
      ),
      h('label', { className: 'dshmcp_field', htmlFor: 'dshmcp-args' },
        h('span', { className: 'dshmcp_label' }, translate('args')),
        h('textarea', {
          id: 'dshmcp-args',
          ref: register('args'),
          className: 'dshmcp_textarea',
          rows: 4,
          value: form.argsText,
          spellCheck: false,
          'aria-invalid': errors.some(item => /^args\[\d+\]$/.test(item.field)) ? 'true' : undefined,
          'aria-describedby': errors.some(item => /^args\[\d+\]$/.test(item.field))
            ? 'dshmcp-args-hint dshmcp-args-error-0'
            : 'dshmcp-args-hint',
          onChange: event => set({ argsText: event.target.value }),
        }),
        h('span', { className: 'dshmcp_hint', id: 'dshmcp-args-hint' }, translate('argsHint')),
        errors.filter(item => /^args\[\d+\]$/.test(item.field)).map((item, index) => h(FieldError, {
          key: `args-${index}`,
          id: `dshmcp-args-error-${index}`,
          text: errorText(translate, item),
        })),
      ),
    )
    : h('label', { className: 'dshmcp_field', htmlFor: 'dshmcp-url' },
      h('span', { className: 'dshmcp_label' }, translate('url')),
      h('input', {
        id: 'dshmcp-url',
        ref: register('url'),
        className: 'dshmcp_input',
        value: form.url,
        autoComplete: 'off',
        spellCheck: false,
        'aria-invalid': errorFor('url') ? 'true' : undefined,
        'aria-describedby': errorFor('url') ? 'dshmcp-url-hint dshmcp-url-error' : 'dshmcp-url-hint',
        onChange: event => set({ url: event.target.value }),
      }),
      h('span', { className: 'dshmcp_hint', id: 'dshmcp-url-hint' }, translate('urlHint')),
      fieldError('url', 'dshmcp-url-error'),
    ),
  h('div', { className: 'dshmcp_formSection' },
    h('div', { className: 'dshmcp_formSectionHead' },
      h('span', { className: 'dshmcp_label' }, form.transport === 'stdio' ? translate('env') : translate('headers')),
      h('button', {
        type: 'button',
        className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonGhost',
        onClick: () => addPair(pairKind),
      }, form.transport === 'stdio' ? translate('addEnv') : translate('addHeader')),
    ),
    h('p', { className: 'dshmcp_hint' }, form.transport === 'stdio' ? translate('envHint') : translate('headersHint')),
    genericPairError ? h(FieldError, { id: 'dshmcp-pair-error', text: errorText(translate, genericPairError) }) : null,
    pairs.length > 0
      ? h('div', { className: 'dshmcp_pairs' }, pairs.map((pair, index) => h(PairEditor, {
        key: `${pairKind}-${index}`,
        kind: pairKind,
        index,
        pair,
        errors,
        translate,
        register,
        update: patch => updatePair(pairKind, index, patch),
        remove: () => removePair(pairKind, index),
      })))
      : null,
  ),
  h('div', { className: 'dshmcp_editorFooter' },
    h('label', { className: 'dshmcp_checkboxRow' },
      h('input', {
        type: 'checkbox',
        className: 'dshmcp_checkbox',
        checked: form.enabled,
        onChange: event => set({ enabled: event.target.checked }),
      }),
      h('span', null, translate('enabledLabel')),
    ),
    h('div', { className: 'dshmcp_editorActions' },
      h('button', { type: 'button', className: 'dshmcp_button dshmcp_buttonOutline', onClick: onClose, disabled: submitting }, translate('cancel')),
      h('button', { type: 'submit', className: 'dshmcp_button dshmcp_buttonPrimary', disabled: submitting }, submitting ? translate('saving') : translate('save')),
    ),
  ),
  );
}
