# MCP 管理

## 功能

- 在「设置 → MCP 管理」中查看当前 profile 的 MCP 服务名称、传输方式和启停开关。
- 支持本地 STDIO 和远程 Streamable HTTP。面板打开时会自动刷新列表。
- 启停服务只修改条目级的 `disabled` 字段。插件通过 profile 写锁原子替换补丁文件，保留其他配置、引用和注释。

## 安装

在 Desktop「插件」页搜索 `@dawn0608/dsh-mcp-manager`，或对目标 profile 执行以下命令。

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-mcp-manager
```

也可从 [GitHub Releases](https://github.com/dawn0608/dsh-plugins/releases?q=mcp-manager) 下载 `.tgz`，再运行 `dsh plugin --profile <profile> add /path/to/package.tgz` 安装。用 CLI 管理 Desktop profile 前请完全退出 Harness Desktop。

从源码安装时，在仓库根目录运行 `npm ci` 和 `npm run build`，再通过本地插件入口选择 `plugins/mcp-manager`。安装后打开「设置 → MCP 管理」，按提示重启 Harness。

## 使用与配置

开关仅启停当前 Harness profile 的服务，不同步到 Codex 或 Claude Code。新增服务或修改连接设置时，可把提供方的安装说明交给 AI，让它更新该 profile 的 `cordis.patch.yml`。

插件通常使用 Harness 宿主提供的当前 profile 名称、目录和补丁路径。若宿主未提供这些信息，插件依次检查 `DSH_PROFILE_DIR`、在 `DSH_HOME` 和 `DSH_PROFILE` 均设置时使用的 `DSH_HOME/profiles/<DSH_PROFILE>`，以及启动参数中包含 profile 清单和补丁文件的绝对目录。无法定位或读取补丁时，面板会提示 profile 不可用。显式配置的绝对路径 `patchPath` 优先于这些来源。

```yaml
- id: mcp-manager
  name: '@dawn0608/dsh-mcp-manager'
  config:
    patchPath: /absolute/path/to/cordis.patch.yml
```

将敏感环境变量和请求头的值留在 Harness 进程环境中，使用 Loader `!!js` 引用：

```yaml
env:
  MCP_TOKEN: !!js 'process.env.MCP_TOKEN'
headers:
  Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

## 环境要求与限制

- 适用 DSH `>=0.2.2-rc.1 <0.3.0`。本地开发需要 Node.js 24 或更高版本。
- 启停开关仅管理当前 profile 的用户补丁文件；其他应用自行管理各自的 MCP 配置。
- 不需要 Python、Codex、Claude Code 或后台服务。
- bundle 自带条目及其他 profile 不在面板的管理范围内。
- 可启停的条目必须位于顶层 `insert` 列表，ID 唯一，且 `disabled` 字段省略或为布尔值。无法安全启停的条目显示为只读。重名服务会单独标记。
- 设置页通过 Harness 的认证连接读取数据。列表响应只包含服务摘要，不含 URL、命令参数、环境变量或请求头等配置字段。

## 开发

在仓库根目录运行 `npm test -w @dawn0608/dsh-mcp-manager` 验证本插件，或运行 `npm run verify` 执行全仓检查。构建会将 YAML 解析器打包到宿主入口。插件采用 [MIT 许可证](LICENSE)，随包的 [YAML 解析器](https://github.com/eemeli/yaml) 采用 ISC 许可证。
