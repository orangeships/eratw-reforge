/**
 * 特殊服装差分 — 声明式条件树 + 纯函数求值器。
 *
 * 上游机制：每个角色的 `@IMAGE_In_特殊服装(CHARA)` 在特定条件下把
 * `RESULTS = _token`（如 `_セーラー` / `_バニー` / `_下着`），
 * `IMAGE.ERB:700-703` 执行 `服装 += RESULTS`，于是「服装」段从 `裸` 变成
 * `裸_浴袍` / `服_セーラー`，最终 `IMAGE.ERB:771` 拼出
 * `立絵_裸_浴袍_通常_30` —— **追加词插在「服装」和「表情」之间**。
 *
 * 为什么不直接照抄成 TypeScript 函数：上游 132 个角色共 1,289 条
 * `RESULTS = _token`，而且同一个 token 在同一个角色的多个
 * `SELECTCASE CFLAG:n:差し替え適用` 分支里重复出现、条件各不相同。
 * 照抄会得到 1,289 个几乎一样的分支，而**分支优先级一旦译错就是错图**
 * （把别人那套美术画出来）。所以改成：生成期把 ERB 抽成条件树，
 * 运行期用一个可测的纯函数求值。
 *
 * 设计约束（对应 AGENTS.md）：
 *  - **条件词汇表是封闭的**。抽取器遇到表外的语法必须 `throw`（带文件:行号），
 *    绝不静默跳过——静默跳过会表现成「立绘少了」，和串图一样难查。
 *  - 求值器不碰 `GameState`，只吃一个 `OutfitContext`。这样每条规则都能
 *    在测试里单独构造输入验证。
 *  - 未建模的谓词不在表里。抽取器编译期就会失败，不会漏到运行期。
 */

/** 求值需要的全部状态。字段是**已解析**的标量，不是 GameState 引用。 */
export interface OutfitContext {
  /** 画的是谁（`VIS_C`：变身时是变身后的角色）。 */
  charaNum: number;
  /** `CFLAG:charaNum:差し替え適用` — 玩家选的替换包。 */
  variant: number;
  /** `GROUPMATCH(value, group)`。 */
  groupMatch: (value: number, group: number) => boolean;
  /** `FLAG:立絵種類` — true 表示顔絵模式。 */
  portraitKindFace: boolean;
  /** `CHECK_NUDE(charaNum)`。 */
  checkNude: boolean;
  /** `CURRENT_CLOTHES_SET(charaNum)` — 服装套装 id（62/74/…）。 */
  clothesSet: number;
  /** `NUDITYCHECK(charaNum)` — 加权分 **0..32**（不是 0..3）。
   *  上游 `差分画像用関数.ERB:1-59`：最大 32 = 全身内衣 3 + 外搭 20 + 连衣裙 9。
   *  ⚠️ 是 IF/ELSEIF 链不是各项独立累加，且**照抄上游 bug：`EQUIP:15 裙子` 全函数
   *  从未被引用**。见 `portrait-outfit-context.ts` 的 `nudityCheckOf`。 */
  nudityCheck: number;
  /** `CHECK_CLO(name, charaNum)` 的全部取值。 */
  checkClo: Readonly<Record<string, boolean>>;
  /** `IS_BUNNY(charaNum)`。 */
  isBunny: boolean;
  /** `BATHROOM()` — 当前在浴室。 */
  bathroom: boolean;
  /** `BATHROBE_SWITCH` — DLC 选项 56「浴袍补丁」，默认 false。 */
  bathrobeSwitch: boolean;
  /** `EQUIP:charaNum:<slotName>`。 */
  equip: Readonly<Record<string, number>>;
  /** `TEQUIP:charaNum:<name>`。 */
  tequip: Readonly<Record<string, number>>;
  /** `TCVAR:charaNum:<name>`。 */
  tcvar: Readonly<Record<string, number>>;
  /** `DAY:n`（0 起的时间段）。 */
  day: readonly number[];
  /** `TIME:n`（0..4）。 */
  time: readonly number[];
  /**
   * 数字 `FLAG:n`。**稀疏 map**（与 `state.flagStore` 同形），不是数组 ——
   * 摊平会在「每角色 × 每帧 × 每个画点」各分配一次上千元素数组，而 FLAG id
   * 到 1061+（`FLAG_ID.告白禁止`）。求值一律 `ctx.flag[n] ?? 0`。
   */
  flag: Readonly<Record<number, number>>;
  /** `CFLAG:charaNum:<id>`。 */
  cflag: Readonly<Record<number, number>>;
  /** `CFLAG:MASTER:<id>` —— 主角的 CFLAG。只有 `CFLAG:CHARA:a == CFLAG:MASTER:b`
   *  这类**跨角色**比较会读它（`Chara_data_17_アリス.ERB:210`）。 */
  masterCflag: Readonly<Record<number, number>>;
  /** `TALENT:charaNum:<name>`。 */
  talent: Readonly<Record<string, number>>;
  /** `TFLAG:<id>`。 */
  tflag: Readonly<Record<number, number>>;
  /** `ABL:charaNum:<id>`。 */
  abl: Readonly<Record<number, number>>;
  /** `FESTIVAL()` —— 今天的节日名，没有节日时是空串。 */
  festival: string;
  /** `睡眠時間(charaNum)` —— 当前是否在睡眠时段。 */
  sleepingCheck: boolean;
  /** `BETWEENTIME(lo, hi)` 用的当前时刻（0..1439 分钟）。 */
  minutesNow: number;
  /** `IS_半脱(charaNum, strict)`。 */
  isHalfUndressed: boolean;
  /** `WORKING(charaNum)`。 */
  working: boolean;
  /**
   * 以下 5 个是**角色专属判定**。它们本质是角色特例而不是通用谓词，
   * 所以 context 给标量、IR 给独立节点，而不是把逻辑塞进求值器。
   */
  /** `K63_HOOD()` —— 影狼的兜帽（`Chara_data_63_影狼.ERB:332`）。 */
  k63Hood: boolean;
  /** `SPIRIT_马尾判定_64()` —— `FLAG:9 % 2`（勇儀，`GRAPH系_ImgChara.ERB:399`）。 */
  spiritTailed: boolean;
  /** `CHK_DATENOW(CFLAG:约会中)` —— 今天是否在约会。 */
  dateNow: boolean;
  /** `PREVCOM` —— 上一个指令号（`state.turnContext?.prevCom`，0 = 无）。 */
  prevCom: number;
  /** `GET_TARGETNUM()` —— 同房间的其他（除主角）角色数。 */
  targetNum: number;
}

/**
 * 条件节点。**这个联合是封闭的**——`build-special-outfit.ts` 的抽取器
 * 只能产出这些形态，遇到别的语法直接编译失败。
 */
export type OutfitCond =
  | { k: "always" }
  /** `FLAG:立絵種類` */
  | { k: "flagFace" }
  /** `CFLAG:n:差し替え適用 == v` / 单纯真值 */
  | { k: "variantEq"; v: number }
  | { k: "variantTruthy" }
  /** `GROUPMATCH(CFLAG:n:差し替え適用, g)` */
  | { k: "variantGroup"; g: number }
  /** `GROUPMATCH(<替换包字段>, a, b, …)` —— 取值属于候选集合。 */
  | { k: "variantIn"; ids: number[] }
  /** `CURRENT_CLOTHES_SET(CHARA) == v` */
  | { k: "clothesSetEq"; v: number }
  /** `SELECTCASE NUDITYCHECK(CHARA)` 的 `CASE lo TO hi` / `CASE lo`。
   *  也用于 `SELECTCASE CFLAG:n:差し替え適用`（`lo === hi`）。 */
  | { k: "nudityCheckCase"; lo: number; hi: number }
  /** `CHECK_CLO("name", CHARA)` */
  | { k: "checkClo"; name: string }
  | { k: "isBunny" }
  | { k: "checkNude" }
  | { k: "bathroom" }
  | { k: "bathrobeSwitch" }
  /** `EQUIP:CHARA:slot == v` / `!= v` / 单纯真值 */
  | { k: "equipTruthy"; slot: string }
  | { k: "equipEq"; slot: string; v: number }
  | { k: "equipNe"; slot: string; v: number }
  /** `CFLAG:n:id == v` / 真值 */
  | { k: "cflagEq"; id: number; v: number }
  | { k: "cflagTruthy"; id: number }
  /** `TALENT:n:name` 真值 */
  | { k: "talentTruthy"; name: string }
  /** `TFLAG:n` 真值 */
  | { k: "tflagTruthy"; id: number }
  /** 数字 `FLAG:n` 真值 / `== v` / `% m` */
  | { k: "flagTruthy"; n: number }
  | { k: "flagMod"; n: number; m: number }
  /** `TEQUIP:n:name` 真值 / `== v` */
  | { k: "tequipTruthy"; name: string }
  | { k: "tequipEq"; name: string; v: number }
  /** `TCVAR:n:name` 真值 / `== v` */
  | { k: "tcvarTruthy"; name: string }
  | { k: "tcvarEq"; name: string; v: number }
  /** `DAY:n == v` / `TIME:n == v` / `% m` */
  | { k: "dayEq"; n: number; v: number }
  | { k: "timeEq"; n: number; v: number }
  /** `DAY:n % m` 之类的取模（`DAY:0 % 2` = 每隔一段换一套立绘）。 */
  | { k: "dayMod"; n: number; m: number }
  | { k: "timeMod"; n: number; m: number }
  /** `INRANGE(DAY:n, lo, hi)` —— 上游 INRANGE 是 `INRANGE(被测值, 下界, 上界)`。 */
  | { k: "dayIn"; n: number; lo: number; hi: number }
  | { k: "timeIn"; n: number; lo: number; hi: number }
  | { k: "cflagIn"; id: number; lo: number; hi: number }
  /** `INRANGE(NUDITYCHECK(chara), lo, hi)` —— 裸露度落在区间内。 */
  | { k: "nudityCheckIn"; lo: number; hi: number }
  /** `DAY:n < v` 之类的大于/小于比较（`==` / `!=` 已由 dayEq + not 表达）。 */
  | { k: "dayCmp"; n: number; op: "lt" | "le" | "gt" | "ge"; v: number }
  | { k: "timeCmp"; n: number; op: "lt" | "le" | "gt" | "ge"; v: number }
  /** `TALENT:name < 0` —— 负值 talent（年龄 -1 = 幼）也是上游真实语义。 */
  | { k: "talentCmp"; name: string; op: "lt" | "le" | "gt" | "ge"; v: number }
  /** `ABL:<chara>:<id>` —— 14 号槽是「露出癖」，是真条件不是恒真。 */
  | { k: "ablTruthy"; id: number }
  | { k: "ablCmp"; id: number; op: "lt" | "le" | "gt" | "ge"; v: number }
  /** `CFLAG:<chara>:<id> >= v` —— 妊娠日数、积攒度这类数值型 CFLAG。 */
  | { k: "cflagCmp"; id: number; op: "lt" | "le" | "gt" | "ge"; v: number }
  /** `CFLAG:a == CFLAG:b` —— `現在位置 == 初期位置` 这类两字段比较。 */
  | { k: "cflagEqField"; id: number; otherId: number }
  /** `TFLAG:a == TFLAG:b` —— `TFLAG:103 == TFLAG:104`。 */
  | { k: "tflagEqField"; id: number; otherId: number }
  /** `CFLAG:CHARA:a == CFLAG:MASTER:b` —— **跨角色**比较（`Chara_data_17_アリス.ERB:210`）。 */
  | { k: "cflagEqMaster"; id: number; otherId: number }
  /** `TFLAG:a == CHARA` —— 与**被画角色**的编号比较（`Chara_data_70_小鈴.ERB:178`）。 */
  | { k: "tflagEqChara"; id: number }
  /** `DAY:n % m == v` —— 泛化的取模比较（`% m` 只支持 `== 0` 时曾漏掉 `DAY:3 % 10 == 6`）。 */
  | { k: "dayModCmp"; n: number; m: number; v: number }
  | { k: "timeModCmp"; n: number; m: number; v: number }
  /** `TCVAR:name <= v` 之类的关系比较。 */
  | { k: "tcvarCmp"; name: string; op: "lt" | "le" | "gt" | "ge"; v: number }
  | { k: "tequipCmp"; name: string; op: "lt" | "le" | "gt" | "ge"; v: number }
  | { k: "tflagCmp"; id: number; op: "lt" | "le" | "gt" | "ge"; v: number }
  /** `GROUPMATCH(FESTIVAL(), "萬聖節", …)` —— 字符串取值的多值匹配。 */
  | { k: "festivalIn"; values: string[] }
  /**
   * `IS_SCHOOLUNIFORM(chara)` —— 上游 `STAND_COM_IMAGE.ERB:103-110` 的定义
   * 就是 `CURRENT_CLOTHES_SET == 74 || == 80`，所以直接展开成套装号集合，
   * 不在运行期再调一次函数。
   */
  | { k: "clothesSetIn"; ids: number[] }
  /**
   * `睡眠時間(chara)` —— 上游 `COMMON.ERB:886-902`：角色当前是否处于睡眠时段。
   *
   * 单独建模而不是留成 `unsupported`，是因为它一个人就影响 57 条规则
   * （`CFLAG:CHARA:睡眠 || CFLAG:CHARA:陪睡中 || 睡眠時間(CHARA)` 这种
   * 或式条件里只要有一项没实现，整条就恒假，`_下着` 这类高频套装就一张
   * 都出不来）。**求值仍是 fail-closed**：运行期没接上就是 false = 少画一张。
   */
  | { k: "sleepingCheck" }
  /**
   * `BETWEENTIME(CFLAG:起床時間, CFLAG:就寝時間 + CFLAG:清醒剤)`。
   *
   * 端点是「槽位 ± 常量」：`loDelta` / `hiDelta` 允许负数（`就寝時間-180`
   * 这种写法在 `Chara_data_13_大妖精.ERB:169` 就有）。**绝不能在抽取期把
   * 端点填成 0** —— 那不是 fail-closed，那是猜值，会让「23:00 在不在来访
   * 时段」恒等于「恰好 0 点」。
   */
  | { k: "betweenTime"; lo: number; loDelta: number; hi: number; hiDelta: number }
  /** `IS_半脱(chara, strict)` —— 上衣半脱状态。 */
  | { k: "isHalfUndressed"; strict: boolean }
  /** `WORKING(chara)` —— 正在工作中。 */
  | { k: "working" }
  /** `K63_HOOD()` —— 影狼的兜帽。 */
  | { k: "k63Hood" }
  /** `SPIRIT_马尾判定_64()` —— 勇儀的马尾（`FLAG:9 % 2`）。 */
  | { k: "spiritTailed" }
  /** `CHK_DATENOW(CFLAG:约会中)`。 */
  | { k: "dateNow" }
  /** `PREVCOM == v`。 */
  | { k: "prevComEq"; v: number }
  /** `GET_TARGETNUM() == v`。 */
  | { k: "targetNumEq"; v: number }
  | { k: "cflagMod"; id: number; m: number }
  | { k: "equipMod"; slot: string; m: number }
  | { k: "tflagMod"; id: number; m: number }
  | { k: "tequipMod"; name: string; m: number }
  | { k: "tcvarMod"; name: string; m: number }
  | { k: "and"; items: OutfitCond[] }
  | { k: "or"; items: OutfitCond[] }
  | { k: "not"; item: OutfitCond }
  /**
   * 抽取器认识语法、但运行期没有实现的谓词。
   *
   * **求值为 false（fail-closed）**——这条规则不会生效，所以表现是
   * 「少一张立绘」，绝不会「画成别人那套」。`why` 保留原始 ERB 文本，
   * 让 `build-special-outfit` 能报出还差哪些谓词。
   */
  | { k: "unsupported"; why: string };

/**
 * 规则产出的服装词。
 *
 * 大多数是字面量（`RESULTS = _セーラー`），但上游允许行内条件表达式：
 * `RESULTS = _%\@ FLAG:立絵種類 ? 半裸 # パンイチ\@%`
 * ——顔絵模式用「半裸」，立绘模式用「パンイチ」。这是**同一个规则产出两个
 * 不同的精灵名**（`顔絵_裸_半裸_...` vs `立絵_裸_パンイチ_...`），所以词本身
 * 也得是条件式的，不能压平成字符串。
 */
export type OutfitToken = string | { when: OutfitCond; then: string; otherwise: string };

/**
 * 一条规则：命中 `when` 就把服装段追加 `token`。
 * `token` **不含**前导下划线（上游 `RESULTS = _セーラー` 存的是 `_セーラー`，
 * 这里存 `セーラー`，拼名时由调用方补 `_`）。
 */
export interface OutfitRule {
  token: OutfitToken;
  when: OutfitCond;
}

/**
 * 一个角色的完整 `@IMAGE_In_特殊服装` 移植。
 *
 * `strategy` 显式记录上游的胜出规则，而不是把它藏进求值器——因为
 * 「第一个匹配赢」还是「最后一个匹配赢」是**上游语义的一部分**，
 * 必须能从数据上核对，不能靠读代码的人记得。
 */
export interface SpecialOutfitTable {
  charaNum: number;
  /** `first` = 文档顺序第一个命中的规则赢；`last` = 最后一个赢。 */
  strategy: "first" | "last";
  /** 文档顺序，未做任何重排。 */
  rules: OutfitRule[];
  /** 上游 `@IMAGE_In_特殊服装` 在源文件里的行号，供人工核对。 */
  sourceLine: number;
}

/** 求值一个条件树。纯函数：不写状态、不读全局、不用随机。 */
export function evalOutfitCond(cond: OutfitCond, ctx: OutfitContext): boolean {
  switch (cond.k) {
    case "always":
      return true;
    case "flagFace":
      return ctx.portraitKindFace;
    case "variantEq":
      return ctx.variant === cond.v;
    case "variantTruthy":
      // `CFLAG:n:差し替え適用` 单独作条件 = 玩家选了替换包
      return ctx.variant !== 0;
    case "variantGroup":
      return ctx.groupMatch(ctx.variant, cond.g);
    case "variantIn":
      return cond.ids.includes(ctx.variant);
    case "clothesSetEq":
      return ctx.clothesSet === cond.v;
    case "nudityCheckCase":
      return ctx.nudityCheck >= cond.lo && ctx.nudityCheck <= cond.hi;
    case "checkClo":
      return ctx.checkClo[cond.name] === true;
    case "isBunny":
      return ctx.isBunny;
    case "checkNude":
      return ctx.checkNude;
    case "bathroom":
      return ctx.bathroom;
    case "bathrobeSwitch":
      return ctx.bathrobeSwitch;
    case "equipTruthy":
      return (ctx.equip[cond.slot] ?? 0) !== 0;
    case "equipEq":
      return (ctx.equip[cond.slot] ?? 0) === cond.v;
    case "equipNe":
      return (ctx.equip[cond.slot] ?? 0) !== cond.v;
    case "cflagEq":
      return (ctx.cflag[cond.id] ?? 0) === cond.v;
    case "cflagTruthy":
      return (ctx.cflag[cond.id] ?? 0) !== 0;
    case "talentTruthy":
      return (ctx.talent[cond.name] ?? 0) !== 0;
    case "tflagTruthy":
      return (ctx.tflag[cond.id] ?? 0) !== 0;
    case "flagTruthy":
      return (ctx.flag[cond.n] ?? 0) !== 0;
    case "flagMod":
      return (ctx.flag[cond.n] ?? 0) % cond.m === 0;
    case "tequipTruthy":
      return (ctx.tequip[cond.name] ?? 0) !== 0;
    case "tequipEq":
      return (ctx.tequip[cond.name] ?? 0) === cond.v;
    case "tcvarTruthy":
      return (ctx.tcvar[cond.name] ?? 0) !== 0;
    case "tcvarEq":
      return (ctx.tcvar[cond.name] ?? 0) === cond.v;
    case "dayEq":
      return (ctx.day[cond.n] ?? 0) === cond.v;
    case "timeEq":
      return (ctx.time[cond.n] ?? 0) === cond.v;
    case "dayMod":
      return (ctx.day[cond.n] ?? 0) % cond.m === 0;
    case "timeMod":
      return (ctx.time[cond.n] ?? 0) % cond.m === 0;
    case "dayIn":
      return inRange(ctx.day[cond.n] ?? 0, cond.lo, cond.hi);
    case "timeIn":
      return inRange(ctx.time[cond.n] ?? 0, cond.lo, cond.hi);
    case "cflagIn":
      return inRange(ctx.cflag[cond.id] ?? 0, cond.lo, cond.hi);
    case "nudityCheckIn":
      return inRange(ctx.nudityCheck, cond.lo, cond.hi);
    case "dayCmp":
      return compareNum(ctx.day[cond.n] ?? 0, cond.op, cond.v);
    case "timeCmp":
      return compareNum(ctx.time[cond.n] ?? 0, cond.op, cond.v);
    case "talentCmp":
      return compareNum(ctx.talent[cond.name] ?? 0, cond.op, cond.v);
    case "ablTruthy":
      return (ctx.abl[cond.id] ?? 0) !== 0;
    case "ablCmp":
      return compareNum(ctx.abl[cond.id] ?? 0, cond.op, cond.v);
    case "cflagCmp":
      return compareNum(ctx.cflag[cond.id] ?? 0, cond.op, cond.v);
    case "festivalIn":
      return cond.values.includes(ctx.festival);
    case "clothesSetIn":
      return cond.ids.includes(ctx.clothesSet);
    case "sleepingCheck":
      return ctx.sleepingCheck;
    case "betweenTime":
      // 端点是 CFLAG 槽位号（可带 ±常量偏移），值必须在运行期取。
      return inWrap(
        ctx.minutesNow,
        (ctx.cflag[cond.lo] ?? 0) + cond.loDelta,
        (ctx.cflag[cond.hi] ?? 0) + cond.hiDelta,
      );
    case "isHalfUndressed":
      return ctx.isHalfUndressed;
    case "working":
      return ctx.working;
    case "k63Hood":
      return ctx.k63Hood;
    case "spiritTailed":
      return ctx.spiritTailed;
    case "dateNow":
      return ctx.dateNow;
    case "prevComEq":
      return ctx.prevCom === cond.v;
    case "targetNumEq":
      return ctx.targetNum === cond.v;
    case "cflagMod":
      return (ctx.cflag[cond.id] ?? 0) % cond.m === 0;
    case "cflagEqField":
      return (ctx.cflag[cond.id] ?? 0) === (ctx.cflag[cond.otherId] ?? 0);
    case "tflagEqField":
      return (ctx.tflag[cond.id] ?? 0) === (ctx.tflag[cond.otherId] ?? 0);
    case "cflagEqMaster":
      return (ctx.cflag[cond.id] ?? 0) === (ctx.masterCflag[cond.otherId] ?? 0);
    case "tflagEqChara":
      return (ctx.tflag[cond.id] ?? 0) === ctx.charaNum;
    case "dayModCmp":
      return (ctx.day[cond.n] ?? 0) % cond.m === cond.v;
    case "timeModCmp":
      return (ctx.time[cond.n] ?? 0) % cond.m === cond.v;
    case "tcvarCmp":
      return compareNum(ctx.tcvar[cond.name] ?? 0, cond.op, cond.v);
    case "tequipCmp":
      return compareNum(ctx.tequip[cond.name] ?? 0, cond.op, cond.v);
    case "tflagCmp":
      return compareNum(ctx.tflag[cond.id] ?? 0, cond.op, cond.v);
    case "equipMod":
      return (ctx.equip[cond.slot] ?? 0) % cond.m === 0;
    case "tflagMod":
      return (ctx.tflag[cond.id] ?? 0) % cond.m === 0;
    case "tequipMod":
      return (ctx.tequip[cond.name] ?? 0) % cond.m === 0;
    case "tcvarMod":
      return (ctx.tcvar[cond.name] ?? 0) % cond.m === 0;
    case "and":
      return cond.items.every((item) => evalOutfitCond(item, ctx));
    case "or":
      return cond.items.some((item) => evalOutfitCond(item, ctx));
    case "not":
      return !evalOutfitCond(cond.item, ctx);
    // fail-closed: 少画一张，绝不画错
    case "unsupported":
      return false;
    default: {
      // 漏一个 case 会静默返回 undefined（falsy），把「玩家选了替换包」这类
      // 条件恒判 false —— 不报错、只是立绘悄悄少一套。踩过一次
      // （`variantTruthy` 漏了），所以这里强制编译器报出来。
      const never: never = cond;
      throw new Error(`evalOutfitCond 漏了节点: ${JSON.stringify(never)}`);
    }
  }
}

/**
 * `INRANGE(v, lo, hi)` —— 闭区间。参数顺序见 `INRANGE_NODE_DOC`。
 *
 * **参数顺序是查实过的，不是猜的**：`COMMON.ERB:3961` 有个包装函数
 * `RETURNF INRANGE(ARG:0, MIN(ARG:1, ARG:2), MAX(ARG:1, ARG:2))` ——
 * 它把**第 2、3 参数**用 MIN/MAX 排序当区间端点，说明那两个是上下界，
 * 第 1 个才是被测值。反过来写会把「5~7 点」画成「5 点以上」。
 */
function inRange(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi;
}

/**
 * `BETWEENTIME(lo, hi)` —— 上游 `COMMON.ERB:847-863`：
 *
 * ```
 * IF ARG < ARG:1
 * 	IF TIME >= ARG && TIME < ARG:1   → 1     ;半开区间 [lo, hi)
 * ELSE
 * 	IF TIME >= ARG || TIME < ARG:1   → 1     ;跨零点环绕
 * ```
 *
 * **两个细节曾经写错过**：
 * 1. **半开**，右端点**排除**（`TIME < ARG:1`），不是闭区间。
 * 2. 分支条件是 `ARG < ARG:1` **严格小于**，所以 `lo === hi` 走 `ELSE` 分支
 *    → `TIME >= lo || TIME < lo` → **恒真**。用 `lo <= hi` 判断会让这个
 *    退化情形变成「只有恰好等于时才真」。
 *
 * ⚠️ **别和 `INRANGE` 搞混**：`inRange` 是**闭区间**（`差分画像用関数.ERB:925`
 * 的 `INRANGE(WAKEUPTIME - SLEEPTIME, 120, 840)` 用的是闭区间语义）。
 * 两个函数语义不同，都在上游出现。
 */
export function inWrap(v: number, lo: number, hi: number): boolean {
  return lo < hi ? v >= lo && v < hi : v >= lo || v < hi;
}

/** `TALENT:name < 0` 之类。注意 `==` / `!=` 不用这里，抽取器直接生成 eq + not。 */
function compareNum(v: number, op: "lt" | "le" | "gt" | "ge", rhs: number): boolean {
  switch (op) {
    case "lt":
      return v < rhs;
    case "le":
      return v <= rhs;
    case "gt":
      return v > rhs;
    case "ge":
      return v >= rhs;
  }
}

/** 条件成立时返回该规则实际产出的词。 */
export function evalOutfitToken(token: OutfitToken, ctx: OutfitContext): string {
  if (typeof token === "string") return token;
  return evalOutfitCond(token.when, ctx) ? token.then : token.otherwise;
}

/**
 * 解析一个角色该用哪个特殊服装 token。
 *
 * 返回 `undefined` = 上游这一帧没有设置 `RESULTS`，即「不追加任何词」，
 * 名字保持 4 段式。**不要把 undefined 当成「默认 token」**——
 * `VARSET RESULTS` 在每个函数开头都执行，不赋值就是空。
 */
export function resolveSpecialOutfit(
  table: SpecialOutfitTable | undefined,
  ctx: OutfitContext,
): string | undefined {
  if (!table || table.rules.length === 0) return undefined;
  const hit = table.strategy === "first"
    ? table.rules.find((rule) => evalOutfitCond(rule.when, ctx))
    : findLast(table.rules, (rule) => evalOutfitCond(rule.when, ctx));
  return hit ? evalOutfitToken(hit.token, ctx) : undefined;
}

function findLast<T>(items: readonly T[], pred: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (pred(item)) return item;
  }
  return undefined;
}

/**
 * 拼出最终资源名的「服装」段。
 *
 * 上游 `IMAGE.ERB:694-704` 的语义：`服装` 初始为空 → 按 `CHECK_NUDE`
 * 取 `裸` 或 `服`，然后若有特殊服装 token 则 `服装 += "_" + token`。
 * 调用方**已经算出非空服装时**上游会跳过特殊服装（`IF 服装 == ""` 守卫），
 * 对应 `allowSpecial === false`。
 */
export function outfitTokenOf(
  table: SpecialOutfitTable | undefined,
  ctx: OutfitContext,
  allowSpecial = true,
): string | undefined {
  if (!allowSpecial) return undefined;
  return resolveSpecialOutfit(table, ctx);
}
