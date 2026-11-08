# 技能

在 DeepSeek Harness 左侧边栏的「插件」下方打开「技能」。可按名称或描述搜索全局目录，点击列表行查看完整描述、来源和 `SKILL.md` 预览。

自定义技能和内置技能支持预览。此前导入的技能可在列表启停，也可在详情页卸载。插件将副本保存在 `$DSH_HOME/skill-manager/bundles`，并通过 `$DSH_HOME/skills` 为使用同一主目录的 Harness profile 启用技能。

## 安装

在仓库根目录构建。

```bash
npm ci
npm run build --workspace @dawn0608/dsh-skill-manager
```

在 Harness Desktop 打开「插件 → 添加插件」，输入 `plugins/skill-manager` 目录的绝对路径。如果应用提示重启，按提示操作。

适用于 Harness Desktop `0.2.2-rc.1` 及低于 `0.3.0` 的兼容版本。
