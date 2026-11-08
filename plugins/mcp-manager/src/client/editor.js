/** Dedicated add/edit view for one MCP server. */

import * as React from 'react';
import { BackIcon, TrashIcon } from './icons.js';
import { blankPair, errorText, serverLabel } from './model.js';

const h = React.createElement;

function FieldError({ id, text }) {
  if (!text) return null;
  return h('span', { className: 'dshmcp_fieldError', id, role: 'alert' }, text);
}

function PairEditor({ kind, index, pair, errors, translate, register, update, remove }) {
  const base = `${kind}[${index}]`;
  const keyError = errors.find(item => item.field === `${base}.key`);
  const valueError = errors.find(item => item.field === `${base}.value` && item.code !== 'ref-prefix-invalid');
  const prefixError = errors.find(item => item.field === `${base}.value` && item.code === 'ref-prefix-invalid');
  const prefixId = `dshmcp-${kind}-${index}-prefix`;
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
        h('span', { className: 'dshmcp_label' }, translate(reference ? 'refVariable' : 'value')),
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
          id: prefixId,
          ref: register(`${base}.prefix`),
          value: pair.prefix,
          'aria-invalid': prefixError ? 'true' : undefined,
          'aria-describedby': prefixError ? `${prefixId}-error` : undefined,
          autoComplete: 'off',
          spellCheck: false,
          onChange: event => update({ prefix: event.target.value }),
        }),
        h(FieldError, { id: `${prefixId}-error`, text: prefixError ? errorText(translate, prefixError) : null }),
      )
      : null,
    h(FieldError, { id: `${keyId}-error`, text: keyError ? errorText(translate, keyError) : null }),
    h(FieldError, { id: `${valueId}-error`, text: valueError ? errorText(translate, valueError) : null }),
  );
}

/**
 * @param {{mode: 'add'|'edit', target: object|null, form: object, errors: object[], failure: string|null, busy: object|null, translate: Function, Switch: React.ComponentType, onChange: Function, onSubmit: Function, onClose: Function, onDelete: Function}} props
 */
export function EditorCard(props) {
  const { mode, target, form, errors, failure, busy, translate, Switch, onChange, onSubmit, onClose, onDelete } = props;
  const nameRef = React.useRef(null);
  const advancedRef = React.useRef(null);
  const refs = React.useRef({});
  const submitting = busy && busy.action === 'save';
  const locked = Boolean(busy);
  const pairKind = form.transport === 'stdio' ? 'env' : 'headers';
  const pairs = form[pairKind];
  const hasAdvancedValues = pairs.length > 0 || (pairKind === 'env' && Boolean(form.cwd || form.argsText));
  const [initiallyExpanded] = React.useState(() => hasAdvancedValues
    || errors.some(({ field }) => /^(args|cwd|env|headers)\b/.test(field)));

  const register = field => element => {
    if (element) refs.current[field] = element;
    else delete refs.current[field];
  };

  React.useLayoutEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  React.useLayoutEffect(() => {
    if (errors.length === 0) return;
    if (advancedRef.current && errors.some(({ field }) => /^(args|cwd|env|headers)\b/.test(field))) {
      advancedRef.current.open = true;
    }
    const { field, code } = errors[0];
    const target = code === 'ref-prefix-invalid' ? field.replace(/\.value$/, '.prefix') : field.replace(/^args\[\d+\]$/, 'args');
    const node = refs.current[target] || advancedRef.current?.querySelector('summary');
    node?.focus();
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
    ? translate('editTitle', { name: serverLabel(target || {}, translate) })
    : translate('addTitle');
  const genericPairError = errors.find(item => item.field === pairKind && item.code === 'transport-invalid');
  const summary = failure || (errors.length > 0 ? errorText(translate, errors[0]) : null);

  const basicFields = h('div', { className: 'dshmcp_group dshmcp_basicFields' },
    h('div', { className: 'dshmcp_grid' },
      h('div', { className: 'dshmcp_field' },
        h('label', { className: 'dshmcp_label', htmlFor: 'dshmcp-name' }, translate('name')),
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
      h('div', { className: 'dshmcp_field' },
        h('label', { className: 'dshmcp_label', htmlFor: 'dshmcp-transport' }, translate('transportLabel')),
        h('select', {
          id: 'dshmcp-transport',
          ref: register('transport'),
          className: 'dshmcp_select',
          value: form.transport,
          'aria-invalid': errorFor('transport') ? 'true' : undefined,
          'aria-describedby': errorFor('transport') ? 'dshmcp-transport-error' : undefined,
          onChange: event => set({ transport: event.target.value }),
        },
        h('option', { value: 'stdio' }, translate('transportStdio')),
        h('option', { value: 'streamable-http' }, translate('transportHttp')),
        ),
        fieldError('transport', 'dshmcp-transport-error'),
      ),
    ),
    form.transport === 'stdio'
      ? h('div', { className: 'dshmcp_field' },
   h('label', { className: 'dshmcp_label', htmlFor: 'dshmcp-command' }, translate('command')),
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
      )
      : h('div', { className: 'dshmcp_field' },
   h('label', { className: 'dshmcp_label', htmlFor: 'dshmcp-url' }, translate('url')),
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
    h('div', { className: 'dshmcp_enabledRow' },
      h('span', null, translate('enabledLabel')),
      h(Switch, {
        checked: form.enabled,
        label: translate('enabledLabel'),
        disabled: locked,
        onChange: enabled => set({ enabled }),
      }),
    ),
  );

  // The disclosure stays user-controlled after its initial state; errors can reveal a hidden field.
  const advancedFields = h('details', {
    className: 'dshmcp_group dshmcp_advanced',
    ref: advancedRef,
    open: initiallyExpanded || undefined,
  },
    h('summary', { className: 'dshmcp_advancedSummary' }, translate('advanced')),
    h('div', { className: 'dshmcp_advancedBody' },
      form.transport === 'stdio'
        ? h('div', { className: 'dshmcp_grid dshmcp_gridAdvanced' },
          h('div', { className: 'dshmcp_field' },
            h('label', { className: 'dshmcp_label', htmlFor: 'dshmcp-cwd' }, translate('cwd')),
            h('input', {
              id: 'dshmcp-cwd',
              ref: register('cwd'),
              className: 'dshmcp_input',
              value: form.cwd,
              autoComplete: 'off',
              spellCheck: false,
              'aria-invalid': errorFor('cwd') ? 'true' : undefined,
              'aria-describedby': errorFor('cwd') ? 'dshmcp-cwd-error' : undefined,
              onChange: event => set({ cwd: event.target.value }),
            }),
            fieldError('cwd', 'dshmcp-cwd-error'),
          ),
          h('div', { className: 'dshmcp_field' },
            h('label', { className: 'dshmcp_label', htmlFor: 'dshmcp-args' }, translate('args')),
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
        : null,
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
    ),
  );

  return h('form', {
    className: 'dshmcp_editor',
    onSubmit: event => {
      event.preventDefault();
      onSubmit();
    },
    onKeyDown: event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (!locked) onClose();
    },
  },
  h('header', { className: 'dshmcp_editorHead' },
    h('button', {
      type: 'button',
      className: 'dshmcp_button dshmcp_buttonSm dshmcp_buttonGhost dshmcp_back',
      disabled: locked,
      onClick: onClose,
    }, h(BackIcon), translate('back')),
    h('h2', { id: 'dshmcp-title', className: 'dshmcp_title' }, title),
  ),
  summary ? h('p', { className: 'dshmcp_formError', role: 'alert' }, summary) : null,
  h('fieldset', { className: 'dshmcp_formFields', disabled: locked },
    basicFields,
    advancedFields,
  ),
  h('footer', { className: 'dshmcp_editorFooter' },
    mode === 'edit' && target && target.deletable !== false
      ? h('button', {
        type: 'button',
        className: 'dshmcp_button dshmcp_buttonGhost dshmcp_editorDelete',
        'aria-label': translate('deleteServer', { name: serverLabel(target, translate) }),
        disabled: locked,
        onClick: onDelete,
      }, h(TrashIcon), translate('delete'))
      : null,
    h('div', { className: 'dshmcp_editorActions' },
      h('button', { type: 'button', className: 'dshmcp_button dshmcp_buttonOutline', onClick: onClose, disabled: locked }, translate('cancel')),
      h('button', { type: 'submit', className: 'dshmcp_button dshmcp_buttonPrimary', disabled: locked }, submitting ? translate('saving') : translate('save')),
    ),
  ),
  );
}
