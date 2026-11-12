/** Client dictionaries and the locale-service binding for the plugin UI. */

export const NS = 'costOverview';

export const DICTS = {
  zh: {
    pillCost: '{amount}',
    partialCost: '已知部分 {amount}',
    unpriced: '无法计价',
    incompleteCost: '费用不完整',
    pillBalance: '余额 {amount}',
    pillBalanceUnknown: '余额 —',
    pillBalanceLoading: '余额 …',
    pillSeparator: '·',
    panelTitle: '费用概览',
    costTitle: '会话费用',
    modelLabel: '模型',
    callsLabel: '模型请求',
    callsValue: '{count} 次',
    webLabel: '网页搜索与抓取',
    webValue: '{count} 次',
    balanceLabel: '账户余额',
    bonusLabel: '赠送余额',
    statusLabel: '状态',
    balanceLoading: '读取中…',
    openDetails: '查看费用与余额明细',
    reasonMissingKey: '未配置 API Key',
    reasonUnauthorized: 'API Key 无效',
    reasonForbidden: '无权读取会话数据',
    reasonNetwork: '网络请求失败',
    reasonTimeout: '请求超时',
    reasonNoWallet: '暂无可用余额',
    reasonNotLive: '会话未在运行',
    reasonPricePending: '价格获取中',
    reasonPriceFailed: '价格获取失败',
    reasonFailed: '读取失败',
    unknownModel: '未知',
  },
};

// en is a real English dictionary. Keep its key set identical to zh.
DICTS.en = {
  pillCost: '{amount}',
  partialCost: 'Known subtotal {amount}',
  unpriced: 'Price unavailable',
  incompleteCost: 'Incomplete cost',
  pillBalance: 'Balance {amount}',
  pillBalanceUnknown: 'Balance —',
  pillBalanceLoading: 'Balance …',
  pillSeparator: '·',
  panelTitle: 'Cost Overview',
  costTitle: 'Session cost',
  modelLabel: 'Model',
  callsLabel: 'Model requests',
  callsValue: '{count}',
  webLabel: 'Web search & fetch',
  webValue: '{count}',
  balanceLabel: 'Account balance',
  bonusLabel: 'Granted',
  statusLabel: 'Status',
  balanceLoading: 'Loading…',
  openDetails: 'Open the cost and balance breakdown',
  reasonMissingKey: 'Missing API key',
  reasonUnauthorized: 'Invalid API key',
  reasonForbidden: 'Cannot access session data',
  reasonNetwork: 'Network error',
  reasonTimeout: 'Request timed out',
  reasonNoWallet: 'No available balance',
  reasonNotLive: 'Session not running',
  reasonPricePending: 'Fetching prices',
  reasonPriceFailed: 'Failed to fetch prices',
  reasonFailed: 'Read failed',
  unknownModel: 'Unknown',
};

/** Interpolate `{name}` placeholders without depending on the locale service. */
export function format(template, params) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    params && Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
}

/** Register both dictionaries under the plugin namespace; safe when locale is unavailable. */
export function registerLocale(ctx) {
  return ctx.effect(() => {
    try {
      return ctx.locale.register(NS, DICTS);
    } catch (error) {
      return () => {};
    }
  }, 'cost-overview: dictionaries');
}

/** Resolve the active language through the locale service, falling back to English. */
export function createTranslator(ctx) {
  let bound;
  try {
    bound = ctx.locale.bind(NS);
  } catch (error) {
    bound = null;
  }
  const fallback = () => {
    let active = 'en';
    try {
      active = ctx.locale.getSnapshot().active || 'en';
    } catch (error) {
      active = 'en';
    }
    return String(active).toLowerCase().startsWith('zh') ? DICTS.zh : DICTS.en;
  };
  return (key, params) => {
    let text;
    if (bound !== null) {
      try {
        text = bound(key, params);
      } catch (error) {
        text = undefined;
      }
    }
    if (typeof text !== 'string' || text === key) {
      const dict = fallback();
      text = format(dict[key] !== undefined ? dict[key] : DICTS.en[key], params);
    }
    return text;
  };
}
