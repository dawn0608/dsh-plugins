# 技能管理

[English](README.md) | 中文

## 功能概览

从 DeepSeek Harness 侧边栏 **插件** 下方打开 **技能**，搜索全局技能目录、阅读渲染后的 `SKILL.md`，查看来源标记或原仓库。内置、自建、第三方分组复用 Harness 现有控件，不另加管理页面。

## 安装与升级

要求 DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`。在 Desktop **插件 → 添加插件** 中输入 `@dawn0608/dsh-skill-manager`，或执行：

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

通过 Harness 插件管理器升级，提示时重启。由源码目录切换到 npm 时，先移除旧目录安装。安装插件**不会**安装可选后台服务，也没有自动运行服务的 postinstall 脚本。

## 管理技能

- 保留已有导入副本的管理能力：用开关启停，在详情中卸载。副本仍位于 `$DSH_HOME/skill-manager/bundles`，通过 `$DSH_HOME/skills` 激活。
- 共享技能来源记录在 `$DSH_AGENTS_HOME/skills/.provenance.json`，默认 `~/.agents/skills/.provenance.json`。键为 `my-skill/SKILL.md` 等相对路径，`origin` 为 `self` 或 `third-party`。第三方可填写不含凭据的 HTTPS `repository`，用于展示原仓库链接。来源未确认的技能归入第三方。
- 共享技能放在 `$DSH_AGENTS_HOME/skills/<name>/SKILL.md`，文件夹名与技能名一致。可选服务维护 Claude Code 链接，仅删除自己创建且文件系统身份仍吻合的链接；保留预先存在的链接及缺少身份凭据的旧所有权记录。

## 可选 macOS 共享同步

前置条件：macOS、Node.js `>=24`，以及 PATH 中可用的 `codex` CLI。通过 npm 显式安装或升级服务，不需要保留源码仓库：

```bash
npx --yes --package @dawn0608/dsh-skill-manager@0.1.2 dsh-skill-sync-install
```

安装器支持 `DSH_HOME`、`DSH_AGENTS_HOME`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR` 以及 `~/` 展开，默认分别为 `~/.dsh`、`~/.agents`、`~/.codex`、`~/.claude`。Harness 与安装器应使用同一组变量。可通过 `DSH_SKILL_SYNC_CODEX` 指定 Codex 可执行文件。安装器将已打包且自包含的 daemon 复制到 `$DSH_HOME/skill-manager/shared-sync/runtime`，配置用户 LaunchAgent `local.dsh-skill-sync` 和 Claude Code 的 `SessionStart` / `CwdChanged` hooks，并在新服务身份验证成功后报告完成。其他 hooks 保留，仅精准迁移由旧自有 LaunchAgent 证明归属的命令。重启 Harness 并重新打开 Claude Code 会话，以登记工作目录。

服务随登录启动，Harness 关闭后仍会同步。可在 Harness **技能**、Codex **Skills** 或 Claude Code `/skills` 切换共享技能。Claude Code 同步涵盖完全开启或停用状态。各端确认成功后分别保存状态，失败重试前核对基线；保留外部新作出的反向选择并报告冲突，直到在 Harness 中显式选择解决。同名冲突保持可见。同步失败不会解除原有 Harness 停用策略。技能页提示服务异常或过期状态以及上次同步成功时间。已打开的 Codex 窗口可能需要重启才会重新读取设置。

## 停止与恢复

卸载插件**不会**停止独立 daemon。请显式停止：

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.dsh-skill-sync.plist"
```

移除该 plist 可阻止下次登录启动；在 Claude Code 的 `SessionStart` / `CwdChanged` hooks 中仅移除本服务的准确命令，保留其他 hooks。停止同步会保留当前启停设置，重新运行 npm 安装器即可恢复服务。

每次安装均输出 `$DSH_HOME/skill-manager/shared-sync/backup-*` 下的私有备份目录，包括原路径及是否存在的清单，以及原有 Claude/Codex 设置、同步状态、runtime 和 plist。启动或就绪检查失败时，安装器恢复本次改动的文件并重新加载原先正在运行的服务；并发修改会保留并提示人工恢复。手动恢复前先停服务、检查清单，仅恢复选定备份，不要直接覆盖更新的设置。同步失败时保留已有停用状态。daemon 日志位于 `$DSH_HOME/skill-manager/shared-sync/error.log`。真实 Codex/Claude 会话与 launchd 联动仍需在实际环境中验收。
