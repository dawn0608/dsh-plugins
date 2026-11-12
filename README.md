# DSH Plugins

个人维护的 DeepSeek Harness 插件集合，用于集中维护、版本管理和分享。

## 插件

| 插件 | 说明 | 适用 DSH | 安装包 |
| --- | --- | --- | --- |
| [费用概览](plugins/cost-overview/README.zh.md) | 在输入框下方查看当前会话的费用估算、模型明细和 DeepSeek API 账户余额 | `>=0.2.2-rc.1 <0.3.0` | `@dawn0608/dsh-cost-overview` |
| [MCP 管理](plugins/mcp-manager/README.zh.md) | 在设置中查看当前 profile 的 STDIO 和 Streamable HTTP 服务，并启停可编辑条目 | `>=0.2.2-rc.1 <0.3.0` | `@dawn0608/dsh-mcp-manager` |
| [技能管理](plugins/skill-manager/README.zh.md) | 搜索和预览全局技能，用户技能开关仅影响当前 Harness profile | `>=0.2.2-rc.1 <0.3.0` | `@dawn0608/dsh-skill-manager` |

## 安装

三个插件均可在 Desktop「插件 → 添加插件」按 npm 包名安装。非 Desktop profile 也可以使用 CLI；选择需要的包安装：

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

使用 CLI 修改 Desktop profile 前请完全退出应用。费用概览的模型/API Key 配置、MCP 的配置范围和技能的 profile 本地开关，分别见插件说明。管理插件只操作 Harness，不修改其他应用配置。

也可以从 [GitHub Releases](https://github.com/dawn0608/dsh-plugins/releases) 下载本插件的 `.tgz`，在 DSH 插件页（如支持本地包入口）或 CLI 安装。

从仓库源码安装先构建，再按目录安装：

```bash
npm ci
npm run build
dsh plugin --profile <profile> add ./plugins/cost-overview
```

## 开发

```bash
npm ci             # 安装锁定的开发依赖
npm run build      # 构建 plugins/* 的 lib/ 产物
npm run check      # 校验插件布局与产物
npm run check:profile -- ~/.dsh/profiles/desktop  # 检查 profile 中重复的插件 insert id
npm test           # 运行全部插件测试
npm run verify     # 插件构建、规范、测试，以及公共工具和模板验证
```

包名统一为 `@dawn0608/dsh-<目录名>`，`npm run check` 会强制校验。

`src/client/` 存放两个管理插件共用的必要宿主控件与文档样式，构建时内联进各插件；已发布包不依赖本仓库或宿主私有 Client 模块。来源与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

插件源码、适用版本、计费口径和已知限制详见各自的 README；目录约定见 [AGENTS.md](AGENTS.md#插件结构)。

## 新增插件

1. `cp -R templates/plugin plugins/<name>`，替换包名、目录名、`cordis.patch.yml` 的 `id`、client 注册 id、locale 文案、CSS 前缀、README 与图标。
2. 在根 `README.md` 的插件表增加一行。
3. 运行 `npm run verify`；发布按下方发布清单。

## 发布

1. bump `plugins/<name>/package.json` 的版本。
2. 在仓库根目录运行 `npm run verify`。
3. `cd plugins/<name>` 后运行 `npm pack --dry-run` 核对内容，生成 `.tgz` 并在隔离 profile 验证；使用 `npm publish <包文件.tgz> --access public` 发布已验证的同一文件。
4. 打 `<name>-v<version>` tag 并创建 GitHub Release，附实际发布的 `.tgz` 与 `SHA256SUMS.txt`。同批插件使用同一源码提交，版本号分别维护；部分发布失败时仅补齐失败项。
5. 同步根 README 插件表；在目标 profile 安装后，回到仓库根目录运行 `npm run check:profile -- <profile-dir>`。

## 获取仓库

```bash
git clone https://github.com/dawn0608/dsh-plugins.git
cd dsh-plugins
```

## 开发约定

- 插件代码与对应说明一起维护。
- 配置示例仅使用占位符，不提交真实凭据、环境文件或本地运行数据。
- 项目协作规范见 [AGENTS.md](AGENTS.md)。

## 许可证

本项目使用 [MIT License](LICENSE)。
