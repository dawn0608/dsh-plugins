# 技能管理

## 功能

从 Harness 侧边栏 **插件** 下方打开 **技能**，搜索内置、自建和第三方技能，预览 Markdown，查看原仓库。代码块支持复制和换行。

## 安装

在 **插件 → 添加插件** 中输入 `@dawn0608/dsh-skill-manager`，或运行：

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

提示时重启 Harness。通过 CLI 修改 Desktop profile 前需完全退出应用。

## 使用与配置

- 开关仅控制当前 profile 中 `~/.agents/skills` 和 Harness 用户技能目录的技能。停用后仍可预览，但模型和 `/技能名` 均无法调用；开启后恢复技能自身的 frontmatter 规则。
- 原生 Settings 服务将 `disabledSkills` 保存到当前 profile 的插件配置，记录绑定来源、规范化文件路径和名称。改名或移动后视为新条目，不修改技能原件或其他应用配置。
- `DSH_HOME` 和 `DSH_AGENTS_HOME` 默认分别为 `~/.dsh` 和 `~/.agents`，支持绝对路径与 `~/`。
- 共享技能来源读取 `$DSH_AGENTS_HOME/skills/.provenance.json`。键为 `my-skill/SKILL.md` 等相对路径，`origin` 为 `self` 或 `third-party`；可选的不含凭据的 HTTPS `repository` 提供原仓库链接。来源未确认的技能归入第三方。
- 打开页面、恢复可见和操作完成后立即刷新，前台每 15 秒检查一次。

## 环境要求与限制

- 要求 Harness `>=0.2.2-rc.1 <0.3.0` 和 Node.js 24 或更高版本，不依赖其他 AI 工具或后台服务。
- 内置、插件自带、项目及自定义 provider 技能不提供开关。保留宿主来源优先级，同名项目技能不受影响。
- 仅两个用户根目录内的原生文件技能可启停。配置冲突时需刷新后重试。插件不导入、卸载、复制或同步技能。

## 开发

在仓库根目录运行 `npm test -w @dawn0608/dsh-skill-manager`，或运行 `npm run verify` 验证全部插件。测试使用隔离文件及原生技能注册表、Settings 和 ConfigEditor 服务。
