# eraTW Modern Player Preview

eraTW 的现代 Web/Tauri 游戏本体预览仓库。当前版本为 `0.2.0-alpha.1`，目标是以可序列化、可测试的 TypeScript 确定性运行时承载游戏规则，并由 React/Tauri 提供玩家界面。

## 仓库边界

- `web/`：React 玩家端、游戏数据包与 Tauri 桌面壳。
- `modernization/runtime/`：确定性状态、命令、结算、世界调度和口上路由。
- `modernization/importer/`：本地读取口上所需的最小解析组件。
- `modernization/schemas/`：观察、意图和只读快照等共享契约。
- `modernization/characters/_roles_meta.json`：运行时使用的角色职责元数据。

原版 eraTW 的 ERB、CSV、resources、插件和开发审计工作台不在本仓库中；创作者工作台与调试入口也不属于本次玩家版发布。本仓库不包含维护者的 Agent 配置、MCP 配置、调试缓存或本机密钥。

## 口上来源

本仓库不附带原版口上正文。第一次启动桌面版时，玩家需要选择以下任一目录：

- 原版 eraTW 项目根目录；
- 原版项目的 `ERB` 目录；
- `ERB/口上・メッセージ関連` 目录本身。

程序只授权读取最终识别出的口上目录，并在实际触发对话时于本机按需解析、缓存；不会上传或改写原文件。仓库中保留的 `kojo-index.json` 和 `kojo.catalog.bundle.json` 仅是路由与选项结构，不含完整口上正文。纯浏览器构建无法读取本机目录，因此对话功能保持关闭。

## 当前状态

这是供备份、协作和试玩的 Alpha 快照，不是正式稳定版。已知仍有未迁移或简化的事件、地图、结算与口上分支；缺少或不支持的路径继续失败关闭。AI 功能默认关闭，不能直接修改权威游戏状态。

## 环境要求

- Node.js 20.19 或更高版本
- pnpm
- 构建桌面版时需要 Rust 与 Tauri 2 的系统依赖

## 获取与运行

```powershell
Set-Location web
pnpm install --frozen-lockfile
pnpm.cmd run tauri dev
```

玩家构建：

```powershell
Set-Location web
pnpm.cmd run build:player
```

桌面开发：

```powershell
Set-Location web
pnpm.cmd run tauri dev
```

## 本地离线包

GitHub 快照不包含完整口上正文。若要制作一个不依赖 pnpm 启动、并把口上一起放进安装包的 Windows 版本，请在拥有完整口上 bundle 的开发 checkout 中执行：

```powershell
Set-Location web
pnpm.cmd run package:offline `
  -KojoBundle "F:\path\to\kojo.bundle.json" `
  -TrainMessageBundle "F:\path\to\train-message.bundle.json"
```

脚本只在本机临时复制两个 bundle，构建 Tauri Windows 安装包后立即删除临时输入。产物位于 `web/src-tauri/target/release/bundle/`（通常包含 `.exe` 安装程序和 `.msi`）；最终用户双击安装后即可运行，不需要 Node、pnpm 或原版项目目录。完整口上只进入这个本地安装包，不进入 GitHub 快照，也不会被脚本上传。

## 发布说明

不要提交 `.env*`、`.mcp.json`、API key、Cookie、存档或本机配置。

## 许可

本快照暂未授予开源许可证。现代化代码、上游衍生文本与资源的权利边界尚在整理；未经权利人许可，请勿再分发。
