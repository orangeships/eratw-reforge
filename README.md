# GensoEra — eraTW Reforge

![Version](https://img.shields.io/badge/version-0.3.0--dev-blue)
![Status](https://img.shields.io/badge/status-development-orange)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
[![License](https://img.shields.io/badge/code%20license-MIT-green)](LICENSE)

GensoEra 是 eraTW 的现代化 Web/Tauri 重制项目。它保留以文字、指令和角色互动为中心的体验，并以现代桌面界面重新实现地图移动、角色状态、确定性结算、时间推进、事件、存档和口上显示。

当前 `main` 提供 `0.3.0-dev` 可玩开发预览。存档格式、交互流程和实验性 AI 功能仍可能调整，不应视为稳定发行版。

## 分支说明

- `main`：当前公开玩家版源码，采用精简发布结构，口上由玩家在本机另行提供。

公开分支只保留运行和构建玩家版所需的源码、生成清单与资源。内部规划、代理记忆、审计记录、测试夹具、生成器和本地任务不属于公开发布内容。

## 0.3.0-dev 内容

- 沉浸式与极简两种玩家界面
- 扩展的地图、场景背景、角色立绘与房间表现
- 更完整的指令、宴会、用餐、夜间结算和世界调度流程
- 角色信息、日记、委托、采集、农园、钓鱼和积石等玩家界面
- 弹幕与钓鱼采用黑色命令行风格，保留像素演出
- L1 在适合的剧情节点提供有文笔的行动选项，并向 L3 记录玩家实际选择
- 本地读取玩家自己的 eraTW 口上目录
- 需要自行配置对话模型密钥的可选 AI 文字功能

部分事件、地图细节、结算规则和口上分支仍在迁移中，因此当前版本还不能完整替代原版。

## AI 内容说明

游戏规则与状态结算始终由确定性 runtime 负责。对话模型需配置玩家自己的密钥；角色反应、剧情等扩展功能分别在设置中启用。配置兼容服务后，AI 可用于：

- 补充短场景对话和少量未作者化的日常台词
- 润色不改变事实的环境或广播文字
- 生成受校验、可拒绝的角色日间反应与夜间建议
- 在玩家主动启用时辅助推进受约束的叙事场景与多条剧情弧
- 在设置界面查看或调整玩家侧提示词

AI 不会直接修改角色属性、关系、物品、时间、任务奖励或存档。请求失败、功能关闭或输出未通过校验时，游戏继续使用确定性内容。

对话模型 API Key 由玩家在应用设置中自行填写；公开源码不包含该密钥。Jev 辅助判定服务仍可在设置中配置，已有本机设置继续保留。

## 开始游戏前

桌面版首次启动或原口上目录不可用时，会要求选择口上来源。可以选择：

- 原版 eraTW 项目根目录
- 项目中的 `ERB` 目录
- `ERB/口上・メッセージ関連` 目录

程序只在本机读取所需文件，不会改写原版目录。纯浏览器页面无法读取本机口上，因此完整体验请使用 Tauri 桌面版。

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

## 来源与许可

- 规则与兼容性参考来源于 [eraTW 画蛇又添足](https://gitgud.io/era-games-zh/touhou/eratw-sub-modding)；原版及各贡献者的文本、数据和资源仍归各自权利人所有。
- 本项目是非官方东方 Project 二次创作，使用和再分发时请遵守[东方 Project 二次创作指南](https://touhou-project.news/guideline/)。
- 图片、字体、派生文本及其他第三方内容不因代码采用 MIT 而被重新许可，详见 [NOTICE.md](NOTICE.md)。
