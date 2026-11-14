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

- 按名称或描述搜索，打开技能查看详情。列表使用 Harness 原生全局技能目录及来源优先级。
- 随 Harness 提供的官方包内的技能归入内置，例如预设组合通过 `customSkillDirs` 挂载的 `dsh-doc`。
- 共享技能来源读取 `$DSH_AGENTS_HOME/skills/.provenance.json`；`DSH_AGENTS_HOME` 默认为 `~/.agents`，支持绝对路径与 `~/`。键为 `my-skill/SKILL.md` 等相对路径，`origin` 为 `self` 或 `third-party`；可选的不含凭据的 HTTPS `repository` 提供原仓库链接。来源未确认的技能归入第三方。
- 打开页面、恢复可见时立即刷新，前台每 15 秒检查一次。

## 环境要求与限制

- 要求 Harness `>=0.2.2-rc.1 <0.3.0` 和 Node.js 24 或更高版本，不依赖其他 AI 工具或后台服务。
- 插件仅供浏览，技能加载与调用遵循 Harness 原生规则和技能自身的 frontmatter，不修改技能或应用配置。

## 开发

在仓库根目录运行 `npm test -w @dawn0608/dsh-skill-manager`，或运行 `npm run verify` 验证全部插件。测试使用隔离文件及原生 Harness 服务。
