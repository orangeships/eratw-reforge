# 旧 eraTW 存档转换

工具只读解析 Emuera `1808` 格式的 `ERA` / `ERAZIP` 普通游戏存档，并把可确认语义的持久状态覆盖到一份当前现代版存档中。旧档和基础档不会被修改，输出始终写到新路径。

当前迁移范围：

- 日期、时刻、季节、资金与赌场筹码；
- 全局 `FLAG`，以及现代生命周期表确认可恢复的 day/persistent `TFLAG`；
- 物品持有数、商店库存；
- 现代 roster 中角色的 `BASE/MAXBASE/ABL/TALENT/EXP/MARK/PALAM/CFLAG/JUEL/EQUIP/TEQUIP/STAIN/TCVAR/BUFF/EX`；
- 角色当前位置、主角住所、房间污垢；
- 农田、酿造变量、已学菜单、日记、出轨知情状态；
- 天气系统和现代运行时已有明确字段的日常事件状态。

`态度`、`合意判定` 属于派生缓存，会由现代关系系统重新计算。`TFLAG/RESULT/SELECTCOM`、旧 ERB 调用栈和正在执行中的训练/睡眠/约会等 continuation 不可安全恢复，转换后从确定性的命令边界继续。没有现代语义所有者的 DLC/插件变量会写进报告，而不会伪造字段。

在 `web/` 目录运行：

```powershell
pnpm.cmd run convert-legacy-relationships --legacy "..\eratw-sub-modding-main\sav\save35.sav" `
  --base "C:\path\to\modern-save.json" `
  --out "C:\path\to\modern-save-imported.json"
```

`--base` 可为裸 `GameState` JSON，也可为包含 `state` 的现代存档信封。默认报告写入 `<out>.report.json`；可用 `--report` 指定。若输出或报告已经存在，工具会拒绝覆盖。
