# DSH Plugins 仓库规则

本仓库维护 DeepSeek Harness 插件。[根 README](README.md) 是安装、开发和发布流程的入口。单个插件的用法和限制写在其 README，跨插件的设计或迁移说明按需放入 `docs/`。

## 插件结构

- 新增插件按[新增插件流程](README.md#新增插件)从 [templates/plugin](templates/plugin/) 起步。目录为 `plugins/<name>/`，包名为 `@dawn0608/dsh-<name>`，`cordis.patch.yml` 的 insert ID 使用短名 `<name>`。
- 运行源码放在 `src/`，构建产物放在 `lib/`。客户端加载外壳由 [build-plugin.mjs](scripts/build-plugin.mjs) 生成，加载标识等于包名。入口、导出和打包清单以模板及 `npm run check` 为准。
- 默认使用 Node.js 和 JavaScript。按实际需求引入依赖或持久化设施。配置示例使用占位符，真实凭据不得进入 Git、日志、公开配置或构建产物，服务端密钥留在宿主。
- 插件包含页面时，先查阅 DeepSeek Harness 现有相关组件，所有组件的样式和布局优先复用宿主实现，不自行重新设计；确需扩展时保持与宿主一致。

## 双语文案

- 客户端文案通过 `ctx.locale` 提供，中英文词典键保持一致。
- `locale/{en,zh}.json` 分别提供对应语言的 `meta.title` 和 `meta.description`。中文 `meta.detail` 指向已打包的 `README.zh.md`，英文使用 `README.md`。维护两份 README 的内容对应，测试覆盖中文详情误回退到英文的情况。
- README 统一采用“功能、安装、使用与配置、环境要求与限制、开发”结构，中英文结构与内容对应；仅描述当前功能、配置、环境要求与限制，不写旧版本兼容或迁移说明，保持精简。

## 验证与发布

- 按改动范围验证，插件改动使用 `npm run verify` 做完整检查。测试使用隔离配置和数据。安装或迁移后用 `npm run check:profile -- <profile-dir>` 检查跨包重复的 insert ID。
- 明确要求发布且目标包可发布时，按[发布清单](README.md#发布)执行。私有包走[本地安装流程](README.md#安装)。

## 备份与资源使用

本机及生产环境默认不额外备份；Git 可恢复或能重建的代码、依赖、产物和数据不另存副本。普通发布及不丢失原始数据的迁移无需备份；只有操作可能不可逆地损坏核心且无法重新取得的数据时，才复用已有恢复材料或保留最小必要临时副本。不默认日备、固定份数或周期演练；用毕清理，核对路径与运行引用。唯一历史业务原件和用户明确留存的材料按用途保留，不能将样例、业务运行记录或正式输出当作冗余备份删除。
