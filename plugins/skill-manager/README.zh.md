# 技能管理

## 功能

从 DeepSeek Harness 侧边栏 **插件** 下方打开 **技能**，搜索全局技能目录、阅读渲染后的 `SKILL.md`，查看来源标记或原仓库。内置、自建、第三方分组复用 Harness 现有控件，不另加管理页面。

## 安装

在 Desktop **插件 → 添加插件** 中输入 `@dawn0608/dsh-skill-manager`，或在 CLI 中为指定 profile 执行以下命令。

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

通过 Harness 插件管理器升级，提示时重启。

## 使用与配置

- 管理导入副本：用开关启停，在详情中卸载。副本存放在 `$DSH_HOME/skill-manager/bundles`，通过 `$DSH_HOME/skills` 激活。
- 共享技能来源记录在 `$DSH_AGENTS_HOME/skills/.provenance.json`，默认 `~/.agents/skills/.provenance.json`。键为 `my-skill/SKILL.md` 等相对路径，`origin` 为 `self` 或 `third-party`。第三方可填写不含凭据的 HTTPS `repository`，用于展示原仓库链接。来源未确认的技能归入第三方。
- 目录技能（包括 `~/.agents/skills`）由 Harness 原生发现和加载。插件展示宿主目录与详情，仅允许启停和卸载本插件拥有的导入副本。
- `DSH_HOME` 和 `DSH_AGENTS_HOME` 默认分别为 `~/.dsh` 和 `~/.agents`，支持绝对路径与 `~/`。插件不管理其他应用的技能或配置。

## 环境要求与限制

- 要求 DeepSeek Harness `>=0.2.2-rc.1 <0.3.0` 和 Node.js 24 或更高版本。
- 文件操作适配 Windows、macOS 和 Linux。导入副本在 Windows 使用目录 junction，在其他平台使用目录软链接，不需要管理员权限或开发者模式。
- 不需要 Python、Codex、Claude Code 或后台服务。路径冲突或其他进程占用文件时，需要排除冲突后重试。

## 开发

在仓库根目录运行 `npm test -w @dawn0608/dsh-skill-manager` 检查本插件，或运行 `npm run verify` 验证整个仓库。
