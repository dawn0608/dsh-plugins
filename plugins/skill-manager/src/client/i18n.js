export const NS = 'skillManager';

export const DICTS = {
  en: {
    title: 'Skills',
    search: 'Search skills',
    imported: 'Imported',
    workspace: 'Workspace',
    local: 'Custom',
    builtin: 'Built-in skills',
    self: 'Self-authored skills',
    'third-party': 'Third-party skills',
    loading: 'Loading skills…',
    empty: 'No skills to display.',
    noMatch: 'No skills match your search.',
    shadowed: 'Shadowed',
    switchLabel: 'Enable {name}',
    back: 'Back to Skills',
    source: 'Source',
    origin: 'Origin',
    unknownOrigin: 'Origin unconfirmed',
    repository: 'Original repository',
    'project-dsh': 'Workspace .dsh/skills',
    'project-agents': 'Workspace .agents/skills',
    custom: 'Configured directory',
    'user-dsh': 'User .dsh/skills',
    'user-agents': 'User .agents/skills',
    bundled: 'Bundled with Harness',
    runtime: 'Registered in Harness',
    preview: 'SKILL.md preview',
    loadingPreview: 'Loading SKILL.md…',
    uninstall: 'Uninstall',
    uninstallTitle: 'Uninstall skill?',
    uninstallHint: 'Remove the imported copy of “{name}” from Harness?',
    cancel: 'Cancel',
    saving: 'Saving…',
    invalid: 'The request is invalid.',
    conflict: 'The skill catalog changed. Wait for the list to refresh and try again.',
    sharedConflict: 'A shared skill has conflicting settings or a matching name in another location.',
    sharedUnavailable: 'Could not sync a shared skill. The background service will retry.',
    'not-found': 'This skill could not be found.',
    unavailable: 'Could not read from or connect to Harness.',
    forbidden: 'This page does not have permission to perform the action.',
    internal: 'The operation failed. Check the Harness logs.',
    incomplete: 'The skill catalog is incomplete. This page will retry automatically.',
  },
  zh: {
    title: '技能',
    search: '搜索技能',
    imported: '已导入',
    workspace: '工作区',
    local: '自定义',
    builtin: '内置技能',
    self: '自建技能',
    'third-party': '第三方技能',
    loading: '正在加载技能…',
    empty: '暂无可显示的技能。',
    noMatch: '没有符合搜索条件的技能。',
    shadowed: '已被覆盖',
    switchLabel: '启用 {name}',
    back: '返回技能列表',
    source: '来源',
    origin: '归属',
    unknownOrigin: '归属待确认',
    repository: '原仓库',
    'project-dsh': '工作区 .dsh/skills',
    'project-agents': '工作区 .agents/skills',
    custom: '自定义目录',
    'user-dsh': '用户 .dsh/skills',
    'user-agents': '用户 .agents/skills',
    bundled: 'Harness 随附',
    runtime: '已在 Harness 注册',
    preview: 'SKILL.md 预览',
    loadingPreview: '正在加载 SKILL.md…',
    uninstall: '卸载',
    uninstallTitle: '卸载技能？',
    uninstallHint: '从 Harness 中移除技能「{name}」的导入副本？',
    cancel: '取消',
    saving: '正在保存…',
    invalid: '请求无效。',
    conflict: '技能列表已变化。请等待列表刷新后重试。',
    sharedConflict: '共享技能存在设置冲突或同名条目。',
    sharedUnavailable: '共享技能同步失败。后台会自动重试。',
    'not-found': '找不到此技能。',
    unavailable: '无法连接 Harness 或读取数据。',
    forbidden: '当前页面没有执行此操作的权限。',
    internal: '操作失败，请查看 Harness 日志。',
    incomplete: '技能列表不完整。页面会自动重试。',
  },
};

export function translateFrom(dict, key, params) {
  const template = Object.hasOwn(dict, key) ? dict[key] : DICTS.en.internal;
  return template.replace(/\{(\w+)\}/g, (match, name) => params?.[name] ?? match);
}

export function createTranslator(locale) {
  const translate = locale.bind(NS);
  return (key, params) => {
    const value = translate(key, params);
    if (typeof value === 'string' && value !== key && value !== NS + '.' + key) return value;
    const language = locale.getSnapshot().active?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    return translateFrom(DICTS[language], key, params);
  };
}
