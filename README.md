# eraTW Reforge

![Version](https://img.shields.io/badge/version-0.2.0--alpha.1-blue)
![Status](https://img.shields.io/badge/status-alpha-orange)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
[![License](https://img.shields.io/badge/code%20license-MIT-green)](LICENSE)

eraTW Reforge 是 eraTW 的现代化 Web/Tauri 重制项目。它保留 era 游戏以文字、指令和角色互动为中心的体验，并以现代桌面界面重新实现地图移动、角色状态、指令结算、时间推进、事件、存档和口上显示。

当前版本为 `0.2.0-alpha.1`。这是可以运行和试玩的 Alpha 版本，游戏系统仍在持续补全。

## 当前内容

- 经典文字游戏界面与地图移动
- 角色状态、关系、时间和世界调度
- 日常与互动指令、确定性结算及事件流程
- 存档与读档
- 从玩家自己的 eraTW 目录读取角色口上

部分事件、地图细节、结算规则和口上分支仍在迁移中，因此当前版本还不能视为完整替代原版。

## 开始游戏前

桌面版每次启动都会要求选择口上来源，验证成功后才会进入游戏。可以选择以下任一目录：

- 原版 eraTW 的项目根目录
- 项目中的 `ERB` 目录
- `ERB/口上・メッセージ関連` 目录

口上目录可以位于电脑上的任意位置，不需要与 eraTW Reforge 放在同一个文件夹。程序只会在本机读取所需文件，不会上传或改写原文件。

纯浏览器页面无法读取本机口上目录，因此完整体验请使用 Tauri 桌面版。

## 从源码运行

需要 Node.js 20.19 或更高版本、pnpm，以及 Tauri 2 所需的 Rust 和系统依赖。

```powershell
Set-Location web
pnpm.cmd install --frozen-lockfile
pnpm.cmd run tauri dev
```

构建玩家版：

```powershell
Set-Location web
pnpm.cmd run tauri build
```

## 版本状态

`0.2.0-alpha.1` 主要用于试玩、反馈和继续验证迁移结果。后续版本会继续补全原版机制、事件与角色内容，并改善桌面端体验和兼容性。

## 来源与许可

- 规则与兼容性参考来源于 [eraTW 画蛇又添足](https://gitgud.io/era-games-zh/touhou/eratw-sub-modding)；原版及各贡献者的文本、数据和资源仍归各自权利人所有。
- 本项目是非官方东方 Project 二次创作，使用和再分发时请遵守[东方 Project 二次创作指南](https://touhou-project.news/guideline/)。
- 图片、字体、派生文本及其他第三方内容不因代码采用 MIT 而被重新许可，详见 [NOTICE.md](NOTICE.md)。
