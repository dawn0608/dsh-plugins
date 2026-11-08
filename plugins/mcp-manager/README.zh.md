# MCP 管理

在 DeepSeek Harness「设置 → MCP 管理」中查看当前 Desktop profile 的 MCP 服务，并启用或停用服务。支持本地 `stdio` 和远程 Streamable HTTP。

- 列表显示服务名、传输方式、启停状态和已发现的工具数。工具数为零时显示「未发现工具」。
- 可把服务提供方的安装说明交给 AI，让它更新当前 profile 的 `cordis.patch.yml`。修改完成后，点「刷新」查看配置。
- 开关通过 profile 写锁和原子写入修改目标条目的 `disabled` 状态。Harness 热加载变更，监听该文件的同步器会在后续轮询时读取它。

## 凭据

MCP 配置里的敏感值（env 值、请求头值）建议使用 Harness 支持的 Loader `!!js` 引用，而不是写入明文：

```yaml
env:
  MCP_TOKEN: !!js 'process.env.MCP_TOKEN'
headers:
  Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

引用值由 Harness 进程环境提供。

## 安装

在插件仓库根目录构建后，用 DSH 的插件安装入口安装本地包：

```bash
cd ~/Developer/dsh-plugins
npm install
npm run build
```

在 Desktop「插件 → 添加插件」中选择本地目录 `plugins/mcp-manager`。如果已安装旧包，先卸载，再安装改名后的包。安装后打开「设置 → MCP 管理」，按应用提示重启。

## 配置

插件自身没有必填配置。可选：

```yaml
- id: mcp-manager
  name: '@dawn0608/dsh-mcp-manager'
  config:
    patchPath: /absolute/path/to/cordis.patch.yml
```

`patchPath` 只应在非标准 profile 布局下使用；默认从 `DSH_PROFILE_DIR` 推导。

## 限制

- 只管理当前 profile 的 **用户 patch 文件**；bundle 自带行、Codex/Claude 配置、其他 profile 不在范围内。
- 行必须位于顶层 `insert` 列表、id 唯一、`disabled` 为布尔值；无法安全启停的条目显示为只读。
- 列表会标出同一文件内的重名服务。
- 带 `!!js`、`headers` 或非可移植环境的条目会被三端同步器标记为 skipped，这是有意为之：凭据留在本机。
- `yaml` 仅在构建时使用并内联进 `lib/index.js`，运行期没有额外依赖；其 ISC 许可证见上游仓库 `eemeli/yaml`。

## 开发

```bash
npm test          # 含构建；单元测试覆盖补丁编辑、校验、引用、锁与原子写、状态接口
npm run verify    # 仓库根目录
```

## 许可证

MIT
