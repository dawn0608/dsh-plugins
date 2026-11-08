/** Client half: the composer pill, its panel, and the slot registration. */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { countText, currencySymbol, money } from './format.js';
import { createTranslator, registerLocale } from './i18n.js';
import { createBalanceStore, walletTotal } from './store.js';
import css from './style.css';

const h = React.createElement;

function createEntry(store, translate) {
  function reasonLabel(reason) {
    switch (reason) {
      case 'missing-key': return translate('reasonMissingKey');
      case 'unauthorized': return translate('reasonUnauthorized');
      case 'network': return translate('reasonNetwork');
      case 'timeout': return translate('reasonTimeout');
      case 'no-endpoint': return translate('reasonNoEndpoint');
      case 'no-wallet': return translate('reasonNoWallet');
      case 'not-live': return translate('reasonNotLive');
      case 'no-session': return translate('reasonNotLive');
      case 'price-pending': return translate('reasonPricePending');
      case 'price-failed': return translate('reasonPriceFailed');
      default: return translate('reasonFailed');
    }
  }

  function balanceLabel(snapshot) {
    if (snapshot.status === 'ready') {
      const wallet = snapshot.wallets[0];
      return translate('pillBalance', { amount: money(walletTotal(wallet), currencySymbol(wallet.currency)) });
    }
    if (snapshot.status === 'loading' || snapshot.status === 'idle') {
      return translate('pillBalanceLoading');
    }
    return translate('pillBalanceUnknown');
  }

  function costView(snapshot, sessionId) {
    const value = snapshot.sessionId === sessionId ? snapshot.cost : undefined;
    if (value && value.ok === true) {
      return { exact: true, amount: Number(value.total) || 0, data: value, pending: false };
    }
    const pending = value === undefined
      && (snapshot.status === 'idle' || snapshot.status === 'loading');
    return { exact: false, amount: undefined, data: value, pending };
  }

  function Panel({ view, snapshot, position, panelRef }) {
    const ready = snapshot.status === 'ready';
    const wallet = ready ? snapshot.wallets[0] : undefined;
    const cells = [];
    const push = (key, label, value) => {
      cells.push(h('dt', { key: `${key}-l` }, label));
      cells.push(h('dd', { key: `${key}-v` }, value));
    };
    const modelLabel = label => (typeof label === 'string' && label !== '' ? label : translate('unknownModel'));

    if (view.exact) {
      const data = view.data;
      const models = Array.isArray(data.models) ? data.models : [];
      if (models.length > 1) {
        // One line per model, carrying both its cost and its request count.
        models.forEach((model, index) => {
          push(`model-${index}`, index === 0 ? translate('modelLabel') : '', `${modelLabel(model.label)} ${money(model.cost, '¥')}`
            + ` · ${translate('callsValue', { count: countText(model.calls) })}`);
        });
      } else {
        const selection = data.selection;
        if (models.length === 1) push('model', translate('modelLabel'), modelLabel(models[0].label));
        else if (selection && typeof selection.label === 'string') {
          push('model', translate('modelLabel'), modelLabel(selection.label));
        }
        push('calls', translate('callsLabel'), translate('callsValue', { count: countText(data.calls) }));
      }
      push('web', translate('webLabel'), translate('webValue', { count: countText(Number(data.toolRequests) || 0) }));
    } else {
      push('state', translate('statusLabel'), view.pending
        ? translate('balanceLoading')
        : reasonLabel(view.data && view.data.reason ? view.data.reason : 'not-live'));
    }

    if (ready && wallet !== undefined) {
      const walletSymbol = currencySymbol(wallet.currency);
      push('balance', translate('balanceLabel'), money(walletTotal(wallet), walletSymbol));
      if ((Number(wallet.granted) || 0) > 0) {
        push('bonus', translate('bonusLabel'), money(wallet.granted, walletSymbol));
      }
    } else {
      push('balance', translate('balanceLabel'), snapshot.status === 'loading' || snapshot.status === 'idle'
        ? translate('balanceLoading')
        : reasonLabel(snapshot.reason));
    }


    return h('div', {
      ref: panelRef,
      className: 'dshco_panel',
      role: 'dialog',
      'aria-label': translate('panelTitle'),
      style: position || { visibility: 'hidden' },
    }, [
      h('div', { key: 'title', className: 'dshco_title' }, [
        h('span', { key: 'label', className: 'dshco_titleLabel' }, [
          h(Icon, { key: 'icon' }),
          translate('costTitle'),
        ]),
        h('span', { key: 'value', className: 'dshco_titleValue' },
          view.exact ? money(view.amount, '¥') : '—'),
      ]),
      h('div', { key: 'rule', className: 'dshco_rule', 'aria-hidden': true }),
      h('dl', { key: 'details', className: 'dshco_details' }, cells),
    ]);
  }

  function CostOverviewEntry(props) {
    const usage = props.useProjection('tokenUsage');
    const snapshot = React.useSyncExternalStore(store.subscribe, store.current, store.current);
    const [open, setOpen] = React.useState(false);
    const [position, setPosition] = React.useState(undefined);
    const rootRef = React.useRef(null);
    const panelRef = React.useRef(null);
    const view = costView(snapshot, props.sessionId);
    const sessionId = props.sessionId;

    const usageKey = usage
      ? [usage.uncachedInputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.outputTokens].join(':')
      : '';

    React.useEffect(() => {
      store.refresh({ sessionId });
      const timer = setInterval(() => store.refresh({ sessionId }), 300000);
      const onVisible = () => {
        if (document.visibilityState === 'visible') store.refresh({ sessionId });
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      };
    }, [sessionId]);

    React.useEffect(() => {
      // The other composer statistics move on this same event, so read the
      // new cost immediately instead of waiting for the next timed poll.
      if (usageKey !== '') store.refresh({ sessionId, force: true });
    }, [usageKey]);

    React.useEffect(() => {
      // Opening the panel is an explicit request for fresh numbers; the Host
      // still applies its own one-minute balance and pricing caches.
      if (open) store.refresh({ sessionId });
    }, [open, sessionId]);

    React.useLayoutEffect(() => {
      if (!open) {
        setPosition(undefined);
        return;
      }
      const place = () => {
        const element = rootRef.current;
        if (element === null) return;
        const rect = element.getBoundingClientRect();
        const width = Math.min(440, window.innerWidth - 24);
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
        setPosition({
          left: `${Math.round(left)}px`,
          bottom: `${Math.round(window.innerHeight - rect.top + 8)}px`,
        });
      };
      place();
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      return () => {
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', place, true);
      };
    }, [open]);

    React.useEffect(() => {
      if (!open) return;
      const onKeyDown = event => {
        if (event.key === 'Escape') setOpen(false);
      };
      const onPointerDown = event => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (rootRef.current && rootRef.current.contains(target)) return;
        if (panelRef.current && panelRef.current.contains(target)) return;
        setOpen(false);
      };
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('pointerdown', onPointerDown, true);
      return () => {
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('pointerdown', onPointerDown, true);
      };
    }, [open]);

    // Match the shipped statistics pills: nothing until this Session has
    // produced tokens, and nothing while this Session's own cost is still in
    // flight, so the row appears together with the other two.
    const used = usage !== undefined && usage !== null
      && ((usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0)
        + (usage.cacheWriteTokens || 0) + (usage.outputTokens || 0)) > 0;
    if (!used || view.data === undefined || view.data === null) return null;

    const costText = view.exact ? translate('pillCost', { amount: money(view.amount, '¥') }) : '—';
    const label = `${costText} ${translate('pillSeparator')} ${balanceLabel(snapshot)}`;

    const panelProps = { view, snapshot, position, panelRef };
    const panel = open
      ? (typeof ReactDOM.createPortal === 'function'
        ? ReactDOM.createPortal(h(Panel, { ...panelProps, key: 'panel' }), document.body, 'panel')
        : h(Panel, { ...panelProps, key: 'panel' }))
      : null;

    return h('span', {
      ref: rootRef,
      className: 'dshco_anchor',
      'data-composer-stat': 'cost-overview',
    }, [
      h('button', {
        key: 'button',
        type: 'button',
        className: 'dshco_pill',
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-label': `${translate('openDetails')}: ${label}`,
        onClick: () => setOpen(!open),
      }, [
        h(Icon, { key: 'icon', className: 'dshco_icon' }),
        h('span', { key: 'label', className: 'dshco_label' }, label),
      ]),
      panel,
    ]);
  }

  CostOverviewEntry.displayName = 'CostOverviewEntry';
  return CostOverviewEntry;
}

function Icon(props) {
  return h('svg', {
    viewBox: '0 0 24 24',
    className: props && props.className ? props.className : 'dshco_icon',
    'aria-hidden': true,
    style: { display: 'block' },
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }, [
    h('path', { key: 'page', d: 'M14.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5L14.5 3Z' }),
    h('path', { key: 'fold', d: 'M14.5 3v4.5a1 1 0 0 0 1 1H20' }),
    h('path', { key: 'bars', d: 'M8 17v-2M12 17v-3.5M16 17v-5' }),
  ]);
}

/**
 * Whether another client module already occupies this plugin's slot cell.
 * A package renamed while the Client stayed open can leave the old module
 * loaded; skipping the duplicate keeps this module's activation from failing.
 */
function slotOccupied(ctx, name, id) {
  try {
    const entries = typeof ctx.slots.entries === 'function' ? ctx.slots.entries(name) : [];
    return Array.isArray(entries) && entries.some(entry => entry.options.id === id);
  } catch (error) {
    return false;
  }
}

export const inject = ['slots', 'locale'];

export function apply(ctx) {
  registerLocale(ctx);

  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = '@dawn0608/dsh-cost-overview';
    tag.dataset.pluginCss = '@dawn0608/dsh-cost-overview/pill.css';
    tag.textContent = css;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, 'cost-overview: styles');

  const translate = createTranslator(ctx);
  const store = createBalanceStore();
  const Entry = createEntry(store, translate);

  ctx.slots.inject('conversation.composer.dock', () => {
    if (slotOccupied(ctx, 'conversation.composer.dock', 'cost-overview')) {
      console.warn('@dawn0608/dsh-cost-overview: conversation.composer.dock already has a "cost-overview" entry; skipping duplicate registration (restart DeepSeek Harness to clear the stale copy)');
      return;
    }
    return ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'cost-overview',
      order: 2,
      registrant: '@dawn0608/dsh-cost-overview',
    }, Entry);
  });
}
