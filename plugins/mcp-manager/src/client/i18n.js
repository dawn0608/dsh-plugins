/** Client dictionaries and the locale-service binding for the MCP settings page. */

export const NS = 'mcpManager';

export const DICTS = {
  zh: {
    title: 'MCP 管理',
    refresh: '刷新',
    loadFailed: '读取配置失败',
    retry: '重试',
    emptyTitle: '还没有 MCP 服务',
    tools: '{count} 个工具',
    toolsNone: '未发现工具',
    toolsUnknown: '工具状态未知',
    disabled: '已停用',
    duplicate: '重名',
    duplicateHint: '同一服务名出现多次，Harness 只会加载其中一个。',
    readOnly: '只读',
    readOnlyFailure: '该条目为只读，无法在面板中修改。',
    unknownName: '未命名条目',
    readOnlyNotInsert: '该 MCP 条目不在 insert 列表中。',
    readOnlyBlockShape: '所在的 patch 块包含其他字段。',
    readOnlyRowShape: '条目包含面板不支持的字段。',
    readOnlyMissingId: '条目缺少 id。',
    readOnlyDuplicateId: '条目 id 重复或被覆盖。',
    readOnlyConditional: '启用状态是条件表达式。',
    readOnlyMissingName: '条目缺少 serverName。',
    readOnlyConfig: '配置结构不受支持。',
    readOnlyConfigEnabled: '条目在 config 中使用了 enabled，无法安全改写。',
    transportStdio: '本地 stdio',
    transportHttp: '远程 Streamable HTTP',
    transportUnknown: '未知传输方式',
    switchLabel: '启用 {name}',
    invalid: '请求无效。',
    internal: '操作未完成，请查看 Harness 日志。',
    conflict: '配置文件已被其他程序修改，已刷新列表，请重试。',
    locked: '配置文件正被其他操作占用，请稍后重试。',
    profileUnavailable: '无法定位或读写当前 profile 补丁文件。',
    network: '无法连接 Harness。',
    unauthorized: '当前页面没有访问 Host 的权限。',
  },
};

DICTS.en = {
  title: 'MCP Management',
  refresh: 'Refresh',
  loadFailed: 'Could not read the configuration',
  retry: 'Retry',
  emptyTitle: 'No MCP servers yet',
  tools: '{count} tools',
  toolsNone: 'No tools found',
  toolsUnknown: 'Tool status unknown',
  disabled: 'Disabled',
  duplicate: 'Duplicate name',
  duplicateHint: 'The same server name appears more than once; Harness loads only one of them.',
  readOnly: 'Read-only',
  readOnlyFailure: 'This entry is read-only and cannot be changed from the panel.',
  unknownName: 'Unnamed entry',
  readOnlyNotInsert: 'This MCP entry is outside an insert list.',
  readOnlyBlockShape: 'Its patch block contains other fields.',
  readOnlyRowShape: 'The entry contains fields this panel does not manage.',
  readOnlyMissingId: 'The entry has no id.',
  readOnlyDuplicateId: 'The entry id is duplicated or overridden.',
  readOnlyConditional: 'Enablement is a conditional expression.',
  readOnlyMissingName: 'The entry has no serverName.',
  readOnlyConfig: 'The configuration shape is unsupported.',
  readOnlyConfigEnabled: 'The entry uses enabled inside config and cannot be rewritten safely.',
  transportStdio: 'Local stdio',
  transportHttp: 'Remote Streamable HTTP',
  transportUnknown: 'Unknown transport',
  switchLabel: 'Enable {name}',
  invalid: 'The request is invalid.',
  internal: 'The operation did not complete; check the Harness logs.',
  conflict: 'The configuration changed on disk. The list was refreshed; try again.',
  locked: 'The profile is being written by another operation. Try again shortly.',
  profileUnavailable: 'The profile patch for this desktop profile cannot be located or written.',
  network: 'Could not reach Harness.',
  unauthorized: 'This page is not authorized to call the Host.',
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
  }, 'mcp-manager: dictionaries');
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
