import { watchRefresh } from '../../../../src/client/refresh.js';
/** Client half: the composer pill, its panel, and the slot registration. */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { countText, currencySymbol, money } from './format.js';
import { createTranslator, registerLocale } from './i18n.js';
import { usePanelPosition } from './position.js';
import { createBalanceStore, walletTotal } from './store.js';
import css from './style.css';

const h = React.createElement;

function createEntry(translate) {
  function reasonLabel(reason) {
    switch (reason) {
      case 'missing-key': return translate('reasonMissingKey');
      case 'unauthorized': return translate('reasonUnauthorized');
      case 'forbidden': return translate('reasonForbidden');
      case 'network': return translate('reasonNetwork');
      case 'timeout': return translate('reasonTimeout');
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

  function costLabel(amount, estimated) {
    return amount === null || !Number.isFinite(amount) ? translate('unpriced') : translate(estimated ? 'partialCost' : 'pillCost', { amount: money(amount, '¥') });
  }

  function Panel({ cost, snapshot, position, panelRef }) {
    const ready = snapshot.status === 'ready';
    const wallet = ready ? snapshot.wallets[0] : undefined;
    const cells = [];
    const push = (key, label, value) => {
      cells.push(h('dt', { key: `${key}-l` }, label));
      cells.push(h('dd', { key: `${key}-v` }, value));
    };
    const modelLabel = label => (typeof label === 'string' && label !== '' ? label : translate('unknownModel'));

    if (cost?.ok === true) {
      const models = Array.isArray(cost.models) ? cost.models : [];
      if (models.length > 1) {
        // One line per model, carrying both its cost and its request count.
        models.forEach((model, index) => {
          push(`model-${index}`, index === 0 ? translate('modelLabel') : '',
            `${modelLabel(model.label)} ${costLabel(model.cost)} · ${translate('callsValue', { count: countText(model.calls) })}`);
        });
      } else {
        const selection = cost.selection;
        if (models.length === 1) push('model', translate('modelLabel'), modelLabel(models[0].label));
        else if (selection && typeof selection.label === 'string') {
          push('model', translate('modelLabel'), modelLabel(selection.label));
        }
        push('calls', translate('callsLabel'), translate('callsValue', { count: countText(cost.calls) }));
      }
      if (cost.pricingStatus === 'partial') push('incomplete', translate('statusLabel'), translate('incompleteCost'));
      push('web', translate('webLabel'), translate('webValue', { count: countText(Number(cost.toolRequests) || 0) }));
    } else {
      push('state', translate('statusLabel'), reasonLabel(cost?.reason ?? snapshot.reason));
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
      style: position ?? { visibility: 'hidden', left: 0, top: 0 },
    }, [
      h('div', { key: 'title', className: 'dshco_title' }, [
        h('span', { key: 'label', className: 'dshco_titleLabel' }, [
          h(Icon, { key: 'icon' }),
          translate('costTitle'),
        ]),
        h('span', { key: 'value', className: 'dshco_titleValue' },
          cost?.ok === true ? costLabel(cost.pricingStatus === 'partial' ? cost.knownSubtotal : cost.total, cost.pricingStatus === 'partial') : '—'),
      ]),
      h('div', { key: 'rule', className: 'dshco_rule', 'aria-hidden': true }),
      h('dl', { key: 'details', className: 'dshco_details' }, cells),
    ]);
  }

  function CostOverviewEntry(props) {
    const usage = props.useProjection('tokenUsage');
    const { sessionId } = props;
    const [snapshot, setSnapshot] = React.useState(null);
    const [open, setOpen] = React.useState(false);
    const storeRef = React.useRef(null);
    const rootRef = React.useRef(null);
    const panelRef = React.useRef(null);
    const previousUsage = React.useRef(null);

    const usageKey = usage
      ? [usage.uncachedInputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.outputTokens].join(':')
      : '';
    const used = ((usage?.uncachedInputTokens || 0) + (usage?.cacheReadTokens || 0)
      + (usage?.cacheWriteTokens || 0) + (usage?.outputTokens || 0)) > 0;
    const cost = snapshot?.cost;
    const visible = used && snapshot?.sessionId === sessionId
      && (cost != null || snapshot?.status === 'unavailable');
    const showPanel = visible && open;
    const position = usePanelPosition(showPanel, rootRef, panelRef);

    React.useEffect(() => {
      const store = createBalanceStore();
      storeRef.current = store;
      store.subscribe(setSnapshot);
      setSnapshot(store.current());
      return () => {
        storeRef.current = null;
        store.dispose();
      };
    }, []);

    React.useEffect(() => {
      const store = storeRef.current;
      return watchRefresh(() => store.refresh({ sessionId }), 300000);
    }, [sessionId]);

    React.useEffect(() => {
      const previous = previousUsage.current;
      previousUsage.current = { sessionId, key: usageKey };
      // The mount and switch read already covers the initial projection.
      if (usageKey !== '' && previous?.sessionId === sessionId && previous?.key !== usageKey) {
        storeRef.current?.refresh({ sessionId, force: true });
      }
    }, [sessionId, usageKey]);

    React.useEffect(() => {
      if (!showPanel) return;
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
    }, [showPanel]);

    if (!visible) return null;

    const costText = cost?.ok === true ? costLabel(cost.pricingStatus === 'partial' ? cost.knownSubtotal : cost.total, cost.pricingStatus === 'partial') : '—';
    const label = `${costText} ${translate('pillSeparator')} ${balanceLabel(snapshot)}`;

    const panelProps = { cost, snapshot, position, panelRef };
    const panel = showPanel
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
        onClick: () => {
          setOpen(!open);
          if (!open) storeRef.current?.refresh({ sessionId, force: true });
        },
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
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }, [
    h('circle', { key: 'ring', cx: 12, cy: 12, r: 8.5 }),
    h('path', { key: 'currency', d: 'm8.8 7.7 3.2 3.6 3.2-3.6M12 11.3v5.2M8.7 12.1h6.6M8.7 14.6h6.6' }),
  ]);
}

/**
 * Whether another client module already occupies this plugin's slot cell.
 * Duplicate package aliases must not register the same composer entry twice.
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
  const Entry = createEntry(translate);

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
