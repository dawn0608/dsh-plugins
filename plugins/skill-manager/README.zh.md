# 技能管理

在 DeepSeek Harness 左侧边栏的「插件」下方打开「技能」。可按名称或描述搜索全局目录，点击列表行查看完整描述、来源和渲染后的 `SKILL.md`。

列表按内置技能、自建技能和第三方技能分组。内置技能由 Harness 识别。共享技能的归属记录在 `~/.agents/skills/.provenance.json`（或 `$DSH_AGENTS_HOME/skills` 下）。以技能说明文件相对技能根的路径为键，例如 `my-skill/SKILL.md`，将 `origin` 设为 `self` 或 `third-party`。第三方技能可用 `repository` 保存不含凭据的 HTTPS 原仓库地址，链接显示在详情页的「来源」中。未登记的技能暂列第三方技能，详情提示归属待确认。

此前导入的技能可在列表启停，也可在详情页卸载。插件将副本保存在 `$DSH_HOME/skill-manager/bundles`，并通过 `$DSH_HOME/skills` 为使用同一主目录的 Harness profile 启用技能。

## 全局技能同步

在 macOS 上，从本地源码仓库执行 `node scripts/install-skill-sync.mjs`，安装用户级后台并备份 Codex 和 Claude Code 配置。随后重启 Harness 加载新版插件，重新打开 Claude Code 会话以登记工作目录。后台随登录启动，Harness 关闭时仍可处理 Codex 和 Claude Code 的变更。

将要共享的技能保存为 `~/.agents/skills/<name>/SKILL.md`，目录名与技能名保持一致。后台维护 Claude Code 的软链接。Codex 技能页、Claude Code 的 `/skills` 和 Harness 技能页均可操作共享技能。Claude Code 仅同步完全启用和停用。检测到同名条目或冲突时，页面提示检查。来自 Harness 或 Claude Code 的操作会立即写入 Codex 配置。若已打开的 Codex 桌面仍显示旧状态，重启 Codex 读取更新。

## 安装

在仓库根目录构建。

```bash
npm ci
npm run build --workspace @dawn0608/dsh-skill-manager
```

在 Harness Desktop 打开「插件 → 添加插件」，输入 `plugins/skill-manager` 目录的绝对路径。如果应用提示重启，按提示操作。

适用于 Harness Desktop `0.2.2-rc.1` 及低于 `0.3.0` 的兼容版本。
