# 项目开发规范

本仓库是 DeepSeek Harness 插件集合，规则只覆盖插件结构、命名、构建、测试和发布。构建/检查/发布命令以根 `README.md` 为准；插件细节写各自 README，跨插件设计或阶段记录需要时再建 `docs/`，不建空目录。

## 插件结构

新插件放 `plugins/<name>/`，包名统一为 `@dawn0608/dsh-<name>`（`session-cost` ↔ `@dawn0608/dsh-session-cost`，`npm run check` 强制校验）；运行代码只写 `src/`，构建产物只写 `lib/`：

```text
plugins/<name>/
  src/index.js              # Host 入口：export inject / apply(ctx)
  src/*.js                  # Host 模块
  src/client/index.js       # Web 干净模块：只 export apply / inject
  src/client/*.js           # 客户端模块（i18n、store、format、组件）
  src/client/style.css      # 客户端样式（构建期内联）
  test/*.test.mjs
  cordis.patch.yml          # insert：id 用短名，name 用包名
  locale/{en,zh}.json       # 插件页 meta.title / meta.description
  icon.svg                  # ≤256 KiB
  README.md / README.zh.md
  LICENSE
  lib/                      # 构建产物（gitignore，npm files 包含）
```

- `package.json`：`main`/`exports["."]` → `./lib/index.js`，`exports["./client"]` → `./lib/client.js`，另导出 `./cordis.patch.yml`、`./locale/*.json`、`./icon`；`files` 只列 `lib`、patch、locale、icon、双 README、LICENSE；`scripts` 含 `build`、`pretest`、`test`、`prepack`。
- Client 源码不写 `window.__ModuleLoader__.load`，外壳由 `scripts/build-plugin.mjs` 注入且 id 等于包名；文案经 `ctx.locale`。
- `npm run build` 后用 `npm run check` 校验；`npm test` 会先构建，含 locale 对齐与 client 契约测试。
- `npm run check:profile -- <profile-dir>` 检查已安装 profile 是否有多个包插入同一个 row id；发布/安装后按需运行。
- 发布前 `npm pack --dry-run` 核对 tarball；发布物不含 `src/`、`test/`。

## 新增插件

1. `cp -R templates/plugin plugins/<name>`，替换包名、目录名、patch `id`、client 注册 id、locale 文案、CSS 前缀、README 与图标。
2. 在根 `README.md` 插件表增加一行。
3. `npm install`（首次）→ `npm run verify`；发布按根 README 的发布清单。

## 工程边界

- 插件默认 Node/JS，不预设后端、数据库、Docker；确需外部服务或持久数据时，在 `docs/<plugin>/` 补设计、运行与迁移规则。
- 从最小可运行工程起步，按需维护依赖、锁文件和检查入口；不建空目录/空文档，不为模板引入无关设施。
- 凭据不得进入 Git、日志、公开配置或构建产物；环境示例只含占位符；服务端密钥不下发客户端。
- 验收以需求/契约为准；失败、截断、数据不足或部分结果注明原因与范围；从现有 lint、类型检查、测试、构建和 CI 中选用相关检查；隔离测试不访问生产。

## 发布

按根 README 的发布清单执行：版本 bump → `npm run verify` → `npm pack --dry-run` → `npm publish` → tag 与 GitHub Release → profile 安装后运行 `npm run check:profile -- <profile-dir>`；发布后核对 tarball 与插件表。
