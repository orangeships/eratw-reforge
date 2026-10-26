# 浏览器分享版部署

公开仓库采用外置口上模式。静态浏览器构建可预览玩家界面和确定性 runtime，但不能读取本机口上目录；完整体验请使用 Tauri 桌面版并选择自己的 eraTW 口上来源。以下步骤只部署静态玩家界面，不包含角色口上或玩家存档。

## 生成产物

```powershell
pnpm.cmd build:player
```

生成目录：

```text
web/dist
```

如果想拖拽上传压缩包，可以把 `web/dist/*` 压成 zip。

## 最快发链接

1. 打开 Netlify Drop：<https://app.netlify.com/drop>
2. 把 `web/dist` 整个文件夹拖进去。
3. 等上传完成，复制生成的网址发给别人。

## 其他可选路线

- Vercel：适合以后持续更新，导入仓库或用 CLI 部署。
- GitHub Pages：免费稳定，但需要把仓库推到 GitHub，并配置 Pages/GitHub Actions。
- 本机穿透：localtunnel / ngrok / Pinggy 等可以临时用，但稳定性和网络可达性不如静态托管。

