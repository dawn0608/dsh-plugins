# DSH Plugins

个人维护的 DeepSeek Harness 插件集合，用于集中维护、版本管理和分享。

## 插件

| 插件 | 说明 | 适用 DSH | 安装包 |
| --- | --- | --- | --- |
| [费用概览](plugins/cost-overview/README.zh.md) | 在输入框下方查看当前会话的费用估算、模型明细和 DeepSeek API 账户余额 | `>=0.2.2-rc.1 <0.3.0` | `@dawn0608/dsh-cost-overview` |
| [MCP 管理](plugins/mcp-manager/README.zh.md) | 在设置中查看当前 profile 的 STDIO 和 Streamable HTTP 服务，并启停可编辑条目 | `>=0.2.2-rc.1 <0.3.0` | `@dawn0608/dsh-mcp-manager` |
| [技能管理](plugins/skill-manager/README.zh.md) | 在侧栏搜索全局技能、预览 Markdown，并启停或卸载已有的受管技能 | `>=0.2.2-rc.1 <0.3.0` | `@dawn0608/dsh-skill-manager` |

## 安装

在 Desktop「插件 → 添加插件」输入表中的 npm 包名。非 Desktop profile 也可以用 CLI 安装，例如安装费用概览。

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-cost-overview
```

费用概览读取账户余额时使用 DSH 为 DeepSeek 配置的 API Key，默认环境变量为 `DEEPSEEK_API_KEY`。已安装旧版「会话花费」的用户可按迁移说明替换安装。[费用概览安装与迁移](plugins/cost-overview/README.zh.md#安装)

也可以从 [GitHub Releases](https://github.com/dawn0608/dsh-plugins/releases) 下载本插件的 `.tgz`，在 DSH 插件页（如支持本地包入口）或 CLI 安装。

从仓库源码安装先构建，再按目录安装：

```bash
npm install
npm run build
dsh plugin --profile <profile> add ./plugins/cost-overview
```

## 开发

```bash
npm install        # 安装根目录的 esbuild
npm run build      # 构建 plugins/* 的 lib/ 产物
npm run check      # 校验插件布局与产物
npm run check:profile -- ~/.dsh/profiles/desktop  # 检查 profile 中重复的插件 insert id
npm test           # 运行全部插件测试
npm run verify     # build + check + test
```

包名统一为 `@dawn0608/dsh-<目录名>`，`npm run check` 会强制校验。

插件源码、适用版本、计费口径和已知限制详见各自的 README；目录约定见 [AGENTS.md](AGENTS.md#插件结构)。

## 新增插件

1. `cp -R templates/plugin plugins/<name>`，替换包名、目录名、`cordis.patch.yml` 的 `id`、client 注册 id、locale 文案、CSS 前缀、README 与图标。
2. 在根 `README.md` 的插件表增加一行。
3. 运行 `npm run verify`；发布按下方发布清单。

## 发布

1. bump `plugins/<name>/package.json` 的版本。
2. 在仓库根目录运行 `npm run verify`。
3. `cd plugins/<name>` 后运行 `npm pack --dry-run` 核对内容，再 `npm publish`（`prepack` 会自动构建 `lib/`）。
4. 打 tag 并创建 GitHub Release，附 `.tgz` 与 `SHA256SUMS.txt`。
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
