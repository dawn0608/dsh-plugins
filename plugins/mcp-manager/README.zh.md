# MCP 管理

[English](README.md) | 中文

在 DeepSeek Harness 打开「设置 → MCP 管理」，查看当前 profile 用户补丁中的 MCP 服务。每行显示服务名、传输方式（STDIO 或 Streamable HTTP）和启用状态。

## 管理服务

- 用可编辑条目上的开关启停服务。开关更新条目的 `disabled` 设置，Harness 会热加载变更。
- 在当前 profile 的 `cordis.patch.yml` 中添加、编辑或删除服务。也可把服务提供方的安装说明交给 AI，请它修改该文件。面板打开时会自动刷新。
- 顶层 `insert` 列表之外的条目、缺少 ID 或 ID 重复的条目、使用条件式 `disabled` 的条目，以及其他无法安全修改的条目均为只读。面板也会标出同名服务。

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

适用于 DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`。

在 Desktop 打开「插件 → 添加插件」，输入 `@dawn0608/dsh-mcp-manager`。通过 CLI 管理 profile 时，可运行以下命令。

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-mcp-manager
```

也可从 [GitHub Releases](https://github.com/dawn0608/dsh-plugins/releases?q=mcp-manager) 下载 `.tgz`，再运行 `dsh plugin --profile <profile> add /path/to/package.tgz` 安装。用 CLI 管理 desktop profile 前请完全退出 Harness Desktop。

从源码安装时，在仓库根目录构建。

```bash
npm ci
npm run build --workspace @dawn0608/dsh-mcp-manager
```

构建完成后，通过本地包入口选择 `plugins/mcp-manager`。切换安装来源时，先移除已有安装。安装后打开「设置 → MCP 管理」，按应用提示重启。

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

面板管理当前 profile 的用户补丁。bundle 自带服务、其他 profile 以及 Codex 和 Claude Code 的配置各自独立管理。

## 开发

```bash
npm test          # 含构建；单元测试覆盖补丁编辑、校验、引用、锁与原子写、状态接口
npm run verify    # 仓库根目录
```

Host 构建产物内联了采用 ISC 许可证的 `yaml` 依赖。[上游许可证](https://github.com/eemeli/yaml/blob/main/LICENSE)

## 许可证

MIT
