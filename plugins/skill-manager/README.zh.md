# 技能

在 DeepSeek Harness 左侧边栏的「插件」下方打开「技能」。可按名称或简介搜索，选择工作区查看项目技能，点击列表行预览正文。列表使用 Harness 默认 Agent 预设在所选工作区发现的技能。

用「添加技能」选择含 `SKILL.md` 的目录，或选择单个 `SKILL.md`。核对名称和来源后，确认导入并启用。目录导入会保留配套资源，每次最多导入 256 个文件，文件总大小上限为 8 MiB。

可在列表启停已导入的技能，或在详情页卸载。插件将副本保存在 `$DSH_HOME/skill-manager/bundles`，并通过 `$DSH_HOME/skills` 为使用同一主目录的 Harness profile 启用技能。工作区中的同名技能可以优先加载。已有项目、共享、本地和内置技能支持预览。

## 安装

在仓库根目录构建。

```bash
npm ci
npm run build --workspace @dawn0608/dsh-skill-manager
```

在 Harness Desktop 打开「插件 → 添加插件」，输入 `plugins/skill-manager` 目录的绝对路径。如果应用提示重启，按提示操作。

适用于 Harness Desktop `0.2.2-rc.1` 及低于 `0.3.0` 的兼容版本。
