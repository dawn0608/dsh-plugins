# MCP 设置

在 DeepSeek Harness 原生「设置」中新增 **MCP** 面板，用来查看、新增、编辑、启停和删除 MCP 服务，并把结果写入当前 Desktop profile 的 `cordis.patch.yml`。支持本地 `stdio` 服务与远程 Streamable HTTP 服务。

## 功能

- 列出 profile 补丁中所有 `insert → @deepseek-ai/dsh-mcp-client` 条目：服务名、传输方式、启停状态、当前发现到的工具数。
- 新增 / 编辑 / 删除，以及不打开编辑器直接启停。
- 保存前校验：服务名格式与长度、保留名（`node_repl`）、同文件内重名、必填字段、URL、环境变量名、请求头名、引用变量名。错误按字段显示在界面；Host 端会再校验一次。
- 保存时会加 profile 写锁并原子替换；只改写目标条目，其他 patch 块、注释、`!!js` 表达式和换行保持原样。
- 保存后 Harness 热加载新配置；监听该文件的外部同步器（例如三端 MCP 同步脚本）会在下一次轮询时自动同步。
- 状态里的「工具数」来自 Host 的实时工具注册表；为 0 时表示尚未发现工具，不代表保存失败。

## 凭据

MCP 配置里的敏感值（env 值、请求头值）建议使用 Harness 支持的 Loader `!!js` 引用，而不是写入明文：

```yaml
env:
  MCP_TOKEN: !!js 'process.env.MCP_TOKEN'
headers:
  Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

面板的「环境变量引用」模式会生成上面两种写法；变量值来自 Harness 进程环境。读取状态时只返回「是否已设置」和变量名，不返回值；日志只记录动作、服务名与错误码。已有的明文敏感值在界面中显示为「已设置（隐藏）」，编辑其他字段时会原样保留，除非显式替换或清除。

## 安装

在插件仓库根目录构建后，用 DSH 的插件安装入口安装本地包：

```bash
cd ~/Developer/dsh-plugins
npm install
npm run build
```

然后在 Desktop 的插件页安装本地目录 `plugins/mcp-settings`，或使用 CLI：

```bash
dsh plugin --profile desktop add ./plugins/mcp-settings
```

安装完成后打开「设置 → MCP」。如果页面没有立即出现，刷新一次页面；替换已安装包或修改插件代码后需要重启 Harness 才能加载新的插件代码。

## 配置

插件自身没有必填配置。可选：

```yaml
- id: mcp-settings
  name: '@dawn0608/dsh-mcp-settings'
  config:
    patchPath: /absolute/path/to/cordis.patch.yml
```

`patchPath` 只应在非标准 profile 布局下使用；默认从 `DSH_PROFILE_DIR` 推导。

## 限制

- 只管理当前 profile 的 **用户 patch 文件**；bundle 自带行、Codex/Claude 配置、其他 profile 不在范围内。
- 行必须位于顶层 `insert` 列表、id 唯一、`disabled` 为布尔值；不满足时显示为只读（可删除，不能编辑）。
- 同一文件内重名会在保存时被拒绝；bundle 与用户 patch 之间的重名由 MCP client 在加载时报错。
- 带 `!!js`、`headers` 或非可移植环境的条目会被三端同步器标记为 skipped，这是有意为之：凭据留在本机。
- `yaml` 仅在构建时使用并内联进 `lib/index.js`，运行期没有额外依赖；其 ISC 许可证见上游仓库 `eemeli/yaml`。

## 开发

```bash
npm test          # 含构建；单元测试覆盖补丁编辑、校验、引用、锁与原子写、状态接口
npm run verify    # 仓库根目录
```

## 许可证

MIT
