# 技能管理

[English](README.md) | 中文

在 DeepSeek Harness 左侧边栏的「插件」下方打开「技能」。可按名称或描述搜索全局技能。点击技能可查看描述和渲染后的 `SKILL.md`，并在标题旁查看归属标签或仓库链接。

## 管理技能

- 目录按内置技能、自建技能和第三方技能分组。归属待确认的技能暂列第三方。
- 共享技能的归属记录在 `~/.agents/skills/.provenance.json`（或 `$DSH_AGENTS_HOME/skills` 下）。以说明文件相对技能根目录的路径为键，例如 `my-skill/SKILL.md`，将 `origin` 设为 `self` 或 `third-party`。第三方技能可填写不含凭据的 HTTPS `repository` 地址，详情页会将其显示为链接。
- 此前由插件导入的受管副本可在列表或详情页启停，也可在详情页卸载。受管副本保存在 `$DSH_HOME/skill-manager/bundles`，通过 `$DSH_HOME/skills` 为使用同一主目录的 Harness profile 启用。

## 安装

适用于 DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`。在 Desktop 打开「插件 → 添加插件」，输入 `@dawn0608/dsh-skill-manager`。也可以通过 CLI 安装。

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

从本地源码切换到 npm 包时，先移除已有安装，再添加 npm 包，并按提示重启。若继续使用源码安装，在仓库根目录运行 `npm ci` 和 `npm run build --workspace @dawn0608/dsh-skill-manager`，然后在 Desktop 添加 `plugins/skill-manager` 的绝对路径。

## macOS 可选设置：同步共享技能

用户级后台可同步 Harness、Codex 和 Claude Code 中共享全局技能的启停状态。后台随登录启动，在 Harness 关闭时也能处理 Codex 和 Claude Code 的变更。请在长期保留的对应版本源码目录中设置，并确保 PATH 中能找到 `node` 和 `codex`。[对应版本源码](https://github.com/dawn0608/dsh-plugins/tree/skill-manager-v0.1.1)

```bash
git clone --branch skill-manager-v0.1.1 https://github.com/dawn0608/dsh-plugins.git
cd dsh-plugins
npm ci
node scripts/install-skill-sync.mjs
```

安装脚本会配置用户级 LaunchAgent 和 Claude Code hooks，备份已有的 Codex 和 Claude Code 配置，并输出备份路径。随后重启 Harness，并重新打开 Claude Code 会话以登记工作目录。

将共享技能放在 `~/.agents/skills/<name>/SKILL.md`，保持目录名与技能名一致。后台维护 Claude Code 的软链接。可在 Harness「技能」、Codex「技能」或 Claude Code 的 `/skills` 中启停共享技能。Claude Code 侧同步完全启用和完全停用两种状态。遇到其他位置的同名冲突时，Harness 会提示检查。如果已打开的 Codex 桌面仍显示旧状态，重启 Codex 读取更新。
