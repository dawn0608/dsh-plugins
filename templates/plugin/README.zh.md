# 示例插件（@dawn0608/dsh-example）

最小 DeepSeek Harness 插件模板。复制 `templates/plugin/` 到 `plugins/<name>/` 后使用。

## 功能

包含 Host 和 Client 入口、宿主主题样式、双语文案及生命周期测试。

## 安装

在仓库根目录构建并安装复制后的包：

```sh
npm --prefix plugins/<name> run build
dsh plugin --profile <profile> add ./plugins/<name>
```

## 使用与配置

替换包名与元数据、`cordis.patch.yml` 中的短 insert ID、客户端 loader ID、locale 命名空间、CSS 前缀、图标及双语 README。插件页面优先复用宿主已有组件的样式和布局。

## 环境要求与限制

要求 Node.js 24 和 DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`。模板为私有包，仅在准备公开发布时移除 `"private": true`。凭据保留在服务端。

## 开发

运行源码放在 `src/`，测试放在 `test/`，双语元数据放在 `locale/`。`lib/` 为生成目录，不提交。包入口、导出和打包清单与模板保持一致。

```sh
npm run build
npm test
```

发布前在仓库根目录运行 `npm run verify`，检查所有插件、公共脚本及模板。
