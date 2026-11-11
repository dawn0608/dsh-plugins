# 技能管理

## 功能

从 DeepSeek Harness 侧边栏 **插件** 下方打开 **技能**，搜索全局技能目录、阅读渲染后的 `SKILL.md`，查看来源标记或原仓库。内置、自建、第三方分组复用 Harness 现有控件，不另加管理页面。

## 安装

在 Desktop **插件 → 添加插件** 中输入 `@dawn0608/dsh-skill-manager`，或在 CLI 中为指定 profile 执行以下命令。

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

通过 Harness 插件管理器升级，提示时重启。安装插件**不会**安装可选后台服务，也没有自动运行服务的 postinstall 脚本。

### 安装或升级可选 macOS 共享同步服务

通过 npm 直接安装或升级服务。

```bash
npx --yes --package @dawn0608/dsh-skill-manager@0.1.7 dsh-skill-sync-install
```

## 使用与配置

- 管理导入副本：用开关启停，在详情中卸载。副本存放在 `$DSH_HOME/skill-manager/bundles`，通过 `$DSH_HOME/skills` 激活。
- 共享技能来源记录在 `$DSH_AGENTS_HOME/skills/.provenance.json`，默认 `~/.agents/skills/.provenance.json`。键为 `my-skill/SKILL.md` 等相对路径，`origin` 为 `self` 或 `third-party`。第三方可填写不含凭据的 HTTPS `repository`，用于展示原仓库链接。来源未确认的技能归入第三方。
- 共享技能以 `$DSH_AGENTS_HOME/skills/<name>/SKILL.md` 为唯一来源，默认 `~/.agents/skills`，文件夹名与技能名一致。Harness、Codex 读取共享目录；可选服务为 Claude Code 补齐链接，内容修改直接反映。删除或重命名源目录时，仅清理可确认由本服务创建且未被替换的链接。同名本地技能、无法确认归属的链接均保留。

### 配置共享同步

安装器支持 `DSH_HOME`、`DSH_AGENTS_HOME`、`CLAUDE_CONFIG_DIR` 及 `~/` 展开，默认分别为 `~/.dsh`、`~/.agents`、`~/.claude`。Harness 与安装器应使用同一组变量。安装器将自包含 daemon 部署到 `$DSH_HOME/skill-manager/shared-sync/runtime`，配置用户 LaunchAgent `local.dsh-skill-sync`，验证服务身份后启用同步。不需要 Codex CLI 或项目 hooks；服务不扫描项目目录。

服务随登录启动，Harness 关闭后仍会同步。各端开关独立：Harness 的共享技能选择保存在 `$DSH_HOME/skill-manager/shared-policy.json`，不修改 Codex 或 Claude 设置。共享根目录不可读或技能文件暂时无效时保留已有状态和链接；单个条目异常不阻塞其他有效技能。技能页提示服务异常或过期状态。客户端可能需要刷新或重启才能重新加载技能。

### 停止与恢复共享同步

卸载插件**不会**停止独立 daemon。请显式停止：

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.dsh-skill-sync.plist"
```

移除该 plist 可阻止下次登录启动。停止同步保留现有文件、链接和各端开关，重新运行 npm 安装器即可恢复服务。

安装器不创建常规备份；启动失败时仅回退本次实际改动，保留并报告并发修改。daemon 日志位于 `$DSH_HOME/skill-manager/shared-sync/error.log`。

## 环境要求与限制

- 要求 DeepSeek Harness `>=0.2.2-rc.1 <0.3.0` 和 Node.js 24 或更高版本。
- 可选后台服务要求 macOS。文件同步不保证正在运行的客户端立即重新加载。

## 开发

在仓库根目录运行 `npm test -w @dawn0608/dsh-skill-manager` 检查本插件，或运行 `npm run verify` 验证整个仓库。
