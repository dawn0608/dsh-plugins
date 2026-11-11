# MCP 管理

## 功能

- 在「设置 → MCP 管理」中查看当前 profile 的 MCP 服务名称、传输方式和启停开关。
- 支持本地 STDIO 和远程 Streamable HTTP。面板打开时会自动刷新列表。
- 启停服务只修改条目级的 `disabled` 字段。插件通过 profile 写锁原子替换补丁文件，保留其他配置、引用和注释。
- 为 Desktop profile 配置共享 MCP 同步后，可通过「从三端移除」确认将服务从 Harness、Codex 和 Claude Code 移除。

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

共享 MCP 同步只同步可移植的服务新增和配置修改，以及明确的卸载操作；各端开关和超时保持独立。配置暂时缺失会从已知定义恢复，不当作全局删除。

同步程序及锁定依赖清单随包提供于 `lib/sync/mcp_sync.py` 和 `lib/sync/requirements.txt`。将脚本部署到固定运行目录，使用 Python 3.12 或更高版本的虚拟环境安装依赖；现有后台和卸载命令桥接继续使用该固定路径。插件安装不会自动启动后台。

要启用三端移除，请先配置宿主的同步后台，然后在 Desktop profile 补丁中加入以下覆盖配置，填写 Python 环境和脚本的绝对路径。三端移除使用当前 profile 的补丁，配置了 `patchPath` 覆盖路径时不可用。

```yaml
- id: mcp-manager
  config:
    sharedSync:
      python: /absolute/path/to/venv/bin/python
      script: /absolute/path/to/mcp_sync.py
```

在符合条件的条目旁点击「从三端移除」并确认。如果打开确认框后补丁发生变化，关闭确认框并查看当前列表，再决定是否重试。显示等待同步时，表示移除请求已记录，三端同步仍未完成。

将敏感环境变量和请求头的值留在 Harness 进程环境中，使用 Loader `!!js` 引用：

```yaml
env:
  MCP_TOKEN: !!js 'process.env.MCP_TOKEN'
headers:
  Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

## 环境要求与限制

- 适用 DSH `>=0.2.2-rc.1 <0.3.0`。本地开发需要 Node.js 24 或更高版本。
- 启停开关管理当前 profile 的用户补丁文件。三端移除仅在显式启用的 Desktop profile 中提供，适用于服务名受支持且唯一的可编辑条目，由同步程序处理共享 MCP 配置中的服务。
- bundle 自带条目及其他 profile 不在面板的管理范围内。
- 可启停的条目必须位于顶层 `insert` 列表，ID 唯一，且 `disabled` 字段省略或为布尔值。无法安全启停的条目显示为只读。重名服务会单独标记。
- 设置页通过 Harness 的认证连接读取数据。列表响应只包含服务摘要，不含 URL、命令参数、环境变量或请求头等配置字段。

## 开发

在仓库根目录运行 `npm test -w @dawn0608/dsh-mcp-manager` 验证本插件，或运行 `npm run verify` 执行全仓检查。构建会将 YAML 解析器打包到宿主入口。插件采用 [MIT 许可证](LICENSE)，随包的 [YAML 解析器](https://github.com/eemeli/yaml) 采用 ISC 许可证。
