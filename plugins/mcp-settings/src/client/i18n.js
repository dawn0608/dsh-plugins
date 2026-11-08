/** Client dictionaries and the locale-service binding for the MCP settings page. */

export const NS = 'mcpSettings';

export const DICTS = {
  zh: {
    nav: 'MCP',
    title: 'MCP 服务',
    intro: '管理写入当前 profile 补丁的 MCP 服务。保存后 Harness 会热加载新配置，监听该文件的外部工具也会自动同步。',
    add: '新增服务',
    refresh: '刷新',
    loading: '正在读取配置…',
    loadFailed: '读取配置失败',
    retry: '重试',
    emptyTitle: '还没有 MCP 服务',
    emptyHint: '新增一个本地 stdio 或远程 Streamable HTTP 服务。',
    pathLabel: '配置文件',
    tools: '{count} 个工具',
    toolsNone: '未发现工具',
    enabled: '已启用',
    disabled: '已停用',
    edit: '编辑',
    delete: '删除',
    confirmDelete: '确认删除',
    confirmDeleteHint: 'Harness 与同步器都会移除该服务。',
    cancel: '取消',
    save: '保存',
    saving: '保存中…',
    saved: '已保存，正在应用…',
    savedPending: '已写入，但尚未发现工具；请检查命令或 URL。',
    deleteFailed: '删除失败',
    saveFailed: '保存失败',
    conflict: '配置文件已被其他程序修改，已刷新列表，请重试。',
    locked: '配置文件正被其他操作占用，请稍后重试。',
    profileUnavailable: '无法定位或读写当前 profile 补丁文件。',
    network: '无法连接 Harness。',
    unauthorized: '当前页面没有访问 Host 的权限。',
    readOnly: '只读',
    readOnlyNotInsert: '该 MCP 条目不在 insert 列表中，只能手动编辑。',
    readOnlyBlockShape: '所在的 patch 块包含其他字段。',
    readOnlyRowShape: '条目包含面板不支持的字段。',
    readOnlyMissingId: '条目缺少 id。',
    readOnlyDuplicateId: '条目 id 重复或被覆盖。',
    readOnlyConditional: '启用状态是条件表达式。',
    readOnlyMissingName: '条目缺少 serverName。',
    readOnlyConfig: '配置结构不受支持。',
    readOnlyConfigEnabled: '条目在 config 中使用了 enabled，无法安全改写。',
    duplicate: '服务名重复',
    duplicateHint: '同一 serverName 在补丁中出现多次，Harness 只会加载其中一个。',
    transportStdio: '本地 stdio',
    transportHttp: '远程 Streamable HTTP',
    transportUnknown: '未知传输方式',
    name: '服务名',
    nameHint: '仅限字母、数字、下划线和连字符，1–32 个字符。',
    command: '命令',
    commandHint: '可执行文件，例如 /opt/homebrew/bin/node。',
    args: '参数',
    argsHint: '每行一个参数。',
    cwd: '工作目录（可选）',
    env: '环境变量',
    envHint: '敏感值建议使用环境变量引用，而不是把明文写进配置文件。',
    url: '服务 URL',
    urlHint: 'http 或 https 的 Streamable HTTP 端点。',
    headers: '请求头',
    headersHint: '敏感值建议使用环境变量引用。',
    addEnv: '添加环境变量',
    addHeader: '添加请求头',
    key: '键',
    value: '值',
    valueMode: '值类型',
    reference: '环境变量引用',
    literal: '固定值',
    keep: '保留原值',
    hidden: '已设置（隐藏）',
    replace: '替换',
    clear: '清除',
    refVariable: '环境变量名',
    refPrefix: '值前缀（可选，如 Bearer ）',
    remove: '移除',
    enabledLabel: '启用',
    transportLabel: '传输方式',
    required: '必填',
    nameFormat: '只能使用字母、数字、下划线和连字符，长度 1–32。',
    nameReserved: '“{name}”是同步器保留的名称。',
    nameDuplicate: '“{name}”已被其他服务使用。',
    commandInvalid: '命令包含不支持的字符。',
    argsInvalid: '参数包含不支持的字符。',
    cwdInvalid: '工作目录包含不支持的字符。',
    urlInvalid: '请输入有效的 http/https URL，且不要包含用户名或密码。',
    envNameInvalid: '环境变量名只能包含字母、数字和下划线，且不能以数字开头。',
    headerNameInvalid: '请求头名称无效。',
    valueInvalid: '值包含不支持的字符或过长。',
    refVariableInvalid: '环境变量名无效。',
    refPrefixInvalid: '前缀不能包含换行、反引号或 ${。',
    keepUnavailable: '原值不存在，请重新输入。',
    transportInvalid: '该字段不适用于当前传输方式。',
    invalid: '请求无效。',
    internal: '保存失败，请查看 Harness 日志。',
    removePair: '移除这一行',
    addTitle: '新增 MCP 服务',
    editTitle: '编辑 {name}',
    readOnlyHint: '只读条目可以删除，但不能在面板中编辑。',
    unknownName: '未命名条目',
    unnamed: '（无 serverName）',
    errorSummary: '请修正以下问题：',
    savedRefresh: '已保存。',
    deleted: '已删除。',
    hiddenValueKept: '当前值已保留。',
    closeEditor: '关闭编辑器',
    toolsWaiting: '正在连接…',
  },
};

DICTS.en = {
  nav: 'MCP',
  title: 'MCP servers',
  intro: 'Manage the MCP servers written to this profile patch. Saving applies through Harness hot reload, and external tools watching the file sync automatically.',
  add: 'Add server',
  refresh: 'Refresh',
  loading: 'Reading configuration…',
  loadFailed: 'Could not read the configuration',
  retry: 'Retry',
  emptyTitle: 'No MCP servers yet',
  emptyHint: 'Add a local stdio server or a remote Streamable HTTP server.',
  pathLabel: 'Configuration file',
  tools: '{count} tools',
  toolsNone: 'No tools discovered',
  enabled: 'Enabled',
  disabled: 'Disabled',
  edit: 'Edit',
  delete: 'Delete',
  confirmDelete: 'Confirm delete',
  confirmDeleteHint: 'Harness and the synchronizer both remove this server.',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved; applying…',
  savedPending: 'Written, but no tools appeared yet. Check the command or URL.',
  deleteFailed: 'Delete failed',
  saveFailed: 'Save failed',
  conflict: 'The configuration changed on disk. The list was refreshed; try again.',
  locked: 'The profile is being written by another operation. Try again shortly.',
  profileUnavailable: 'The profile patch for this desktop profile cannot be located or written.',
  network: 'Could not reach Harness.',
  unauthorized: 'This page is not authorized to call the Host.',
  readOnly: 'Read-only',
  readOnlyNotInsert: 'This MCP entry is not inside an insert list; edit it by hand.',
  readOnlyBlockShape: 'Its patch block contains other fields.',
  readOnlyRowShape: 'The entry contains fields this panel does not manage.',
  readOnlyMissingId: 'The entry has no id.',
  readOnlyDuplicateId: 'The entry id is duplicated or overridden.',
  readOnlyConditional: 'Enablement is a conditional expression.',
  readOnlyMissingName: 'The entry has no serverName.',
  readOnlyConfig: 'The configuration shape is unsupported.',
  readOnlyConfigEnabled: 'The entry uses enabled inside config and cannot be rewritten safely.',
  duplicate: 'Duplicate name',
  duplicateHint: 'The same serverName appears more than once; Harness loads only one of them.',
  transportStdio: 'Local stdio',
  transportHttp: 'Remote Streamable HTTP',
  transportUnknown: 'Unknown transport',
  name: 'Server name',
  nameHint: 'Letters, digits, underscores, and hyphens only, 1–32 characters.',
  command: 'Command',
  commandHint: 'An executable, for example /opt/homebrew/bin/node.',
  args: 'Arguments',
  argsHint: 'One argument per line.',
  cwd: 'Working directory (optional)',
  env: 'Environment',
  envHint: 'Use an environment reference for secrets instead of writing plaintext into the configuration.',
  url: 'Server URL',
  urlHint: 'An http or https Streamable HTTP endpoint.',
  headers: 'Headers',
  headersHint: 'Use an environment reference for secrets.',
  addEnv: 'Add environment variable',
  addHeader: 'Add header',
  key: 'Key',
  value: 'Value',
  valueMode: 'Value type',
  reference: 'Environment reference',
  literal: 'Fixed value',
  keep: 'Keep current value',
  hidden: 'Set (hidden)',
  replace: 'Replace',
  clear: 'Clear',
  refVariable: 'Environment variable',
  refPrefix: 'Value prefix (optional, e.g. Bearer )',
  remove: 'Remove',
  enabledLabel: 'Enabled',
  transportLabel: 'Transport',
  required: 'Required.',
  nameFormat: 'Use only letters, digits, underscores, and hyphens, 1–32 characters.',
  nameReserved: '"{name}" is reserved by the synchronizer.',
  nameDuplicate: '"{name}" is already used by another server.',
  commandInvalid: 'The command contains unsupported characters.',
  argsInvalid: 'An argument contains unsupported characters.',
  cwdInvalid: 'The working directory contains unsupported characters.',
  urlInvalid: 'Enter a valid http/https URL without a user name or password.',
  envNameInvalid: 'Environment names use letters, digits, and underscores, and cannot start with a digit.',
  headerNameInvalid: 'The header name is invalid.',
  valueInvalid: 'The value contains unsupported characters or is too long.',
  refVariableInvalid: 'The environment variable name is invalid.',
  refPrefixInvalid: 'The prefix cannot contain a newline, a backtick, or ${.',
  keepUnavailable: 'The current value is unavailable; enter a new one.',
  transportInvalid: 'This field does not apply to the selected transport.',
  invalid: 'The request is invalid.',
  internal: 'Save failed; check the Harness logs.',
  removePair: 'Remove this row',
  addTitle: 'Add MCP server',
  editTitle: 'Edit {name}',
  readOnlyHint: 'Read-only entries can be deleted but not edited here.',
  unknownName: 'Unnamed entry',
  unnamed: '(no serverName)',
  errorSummary: 'Fix the following:',
  savedRefresh: 'Saved.',
  deleted: 'Deleted.',
  hiddenValueKept: 'The current value is kept.',
  closeEditor: 'Close the editor',
  toolsWaiting: 'Connecting…',
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
  }, 'mcp-settings: dictionaries');
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
