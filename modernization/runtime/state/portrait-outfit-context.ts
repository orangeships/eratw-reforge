import {
  BASE_ID,
  CFLAG_ID,
  EQUIP_SLOT,
  FLAG_ID,
  TCVAR_ID,
  TEQUIP_ID,
} from "./settlement.js";
import { readTequip } from "./tequip.js";
import { portraitKindOf } from "./portrait-kind.js";
import { portraitVariantOf } from "./portrait-variant.js";
import { festivalNow } from "../world/calendar.js";
import { timeZoneOf } from "../world/time-of-day.js";
import {
  bathCheck,
  chkDateNow,
  inHome,
  MAIN_MAP_ID,
} from "../world/location-predicates.js";
import {
  presentNpcs,
} from "../scene/presence.js";
import { inWrap } from "./portrait-special-outfit.js";
import type { GameState, CharaSlot } from "./game-state.js";
import {
  EQUIP_ID_BY_NAME,
  TALENT_ID_BY_NAME,
  TCVAR_ID_BY_NAME,
  TEQUIP_ID_BY_NAME,
  outfitKeyId,
} from "./portrait-outfit-keys.generated.js";
import type { OutfitContext } from "./portrait-special-outfit.js";

/**
 * `GameState` → `OutfitContext` 的装配层。
 *
 * 特殊服装判定（上游 `@IMAGE_In_特殊服装`）需要的全部状态，在现代 runtime
 * 里都是**数字下标的稀疏表**；而抽取出来的 IR 用的是**中日文名字**。
 * 这个模块负责把两边接上，并把「还没有实现的上游判定」显式置为
 * fail-closed 值。
 *
 * ## fail-closed 原则（贯穿本文件）
 *
 * 任何**不知道**的量一律给 0 / false，**绝不**给一个「大概是这个意思」的值。
 * 因为判定是 OR 结构，一个猜错的 true 会让整条规则命中 → **画出错的立绘**；
 * 而一个 false 只是这张图不出现 → 少画一张。后者可见、可查，前者不可见。
 *
 * 具体到几个容易出错的地方：
 * - `clothesSet` 猜成 0 → `CURRENT_CLOTHES_SET == 0` 恒不成立（安全），
 *   但若有人把「套装未知」当成「套装 55 兔女郎」就会给裸体角色穿兔女郎（危险）。
 * - `checkNude` 猜成 false → 裸体角色永远选不到 `_裸_` 分支（少图，安全）；
 *   猜成 true → 穿衣角色会被画成裸体（危险）。
 * - `bathrobeSwitch` 猜成 true → 所有角色在浴室都套浴袍（危险）。
 *
 * 因此下面的每个 `?? 0` 都有注释说明**为什么 0 在这里是安全方向**。
 */

const ZERO: Readonly<Record<string, number>> = {};

/** `OutfitContext.equip` 的键既可能是中文名也可能是数字字符串，两边都塞。 */
function equipLookup(chara: CharaSlot | undefined): Readonly<Record<string, number>> {
  if (!chara) return ZERO;
  const equip = chara.state.EQUIP;
  const out: Record<string, number> = {};
  for (const [name, id] of Object.entries(EQUIP_ID_BY_NAME)) {
    const v = equip[id];
    // 槽位没穿东西时省略键：IR 求值走 `?? 0`，省略与 0 等价，但键少一大半。
    if (v !== undefined && v !== 0) out[name] = v;
  }
  // IR 里也出现过字面数字键（`EQUIP:CHARA:10`），原样带上
  for (const [k, v] of Object.entries(equip)) out[k] = v;
  return out;
}

function tequipLookup(chara: CharaSlot | undefined): Readonly<Record<string, number>> {
  if (!chara) return ZERO;
  const out: Record<string, number> = {};
  for (const [name, id] of Object.entries(TEQUIP_ID_BY_NAME)) {
    const v = readTequip(chara, id);
    if (v !== 0) out[name] = v;
  }
  for (const [k, v] of Object.entries(chara.state.TEQUIP ?? {})) out[k] = v;
  return out;
}

function tcvarLookup(chara: CharaSlot | undefined): Readonly<Record<string, number>> {
  if (!chara) return ZERO;
  const out: Record<string, number> = {};
  for (const [name, id] of Object.entries(TCVAR_ID_BY_NAME)) {
    const v = chara.state.TCVAR[id];
    if (v !== undefined && v !== 0) out[name] = v;
  }
  for (const [k, v] of Object.entries(chara.state.TCVAR)) out[k] = v;
  return out;
}

function talentLookup(chara: CharaSlot | undefined): Readonly<Record<string, number>> {
  if (!chara) return ZERO;
  const out: Record<string, number> = {};
  for (const [name, id] of Object.entries(TALENT_ID_BY_NAME)) {
    const v = chara.state.TALENT[id];
    if (v !== undefined) out[name] = v;
  }
  for (const [k, v] of Object.entries(chara.state.TALENT)) out[k] = v;
  return out;
}

/** `DAY:0..3` / `TIME:0..4`，IR 用 `DAY:n` 下标寻址。 */
function dayArray(state: GameState): readonly number[] {
  return [
    state.time.dayIndex,
    0, // DAY:1 上游未建模（日数细分）
    state.time.season ?? 0, // DAY:2 季節 —— 未设时给 0 而非 1（春），
                            // 因为 0 不等于任何真实季节，判定恒假 = 少图（安全）。
    state.time.date ?? 0,   // DAY:3 日付 —— 同上
  ];
}

function timeArray(state: GameState): readonly number[] {
  const zone = timeZoneOf(state.time.tickValue);
  return [0, 0, zone, 0, 0];
}

/**
 * `BATHROOM()` —— 当前**在**浴室。
 *
 * 上游 `MOVEMENTS/物件関連/PLACE_拠点共通.ERB:289-301`：
 * ```
 * SIF !ARG
 * 	ARG = CFLAG:MASTER:現在位置      ← 无参 = 主角的位置
 * SIF !IN_HOME(ARG)
 * 	RETURNF 0
 * RETURNF BATHCHECK(ARG)
 * ```
 * 剥掉 GMF 那个存档开关分支，它就是 `IN_HOME(主角位置) && BATHCHECK(主角位置)`。
 *
 * ⚠️ **无参调用取的是主角位置，不是目标角色。**（对比 `CHECK_NUDE` 内部用的
 * 是 `BATHROOM(CFLAG:CHARA:現在位置)`，取目标角色。）我第一版把 `chara`
 * 传进来是错的 —— 那样会让「主角在浴室、目标不在」的角色也套上浴袍。
 *
 * ⚠️ `bathCheck` 是 `BATHCHECK`（「该地点**有**浴室设施」），这正是上游
 * `BATHROOM` 内部调的那个 —— 所以这里接它是**对的**，但 `outRoof`（屋外判定）
 * 绝对不能接。
 *
 * 现代两个函数都已移植：`inHome`(`location-predicates.ts:121`)、
 * `bathCheck`(`:214`，含 `PLACE_BATH` 位与两条 defer 分支，注释已写明)。
 */
function bathroomOf(state: GameState, chara: CharaSlot | undefined): boolean {
  void chara; // 上游无参调用只看主角位置，刻意不用目标角色
  const loc = state.master.location;
  if (!inHome(loc)) return false;
  return bathCheck(state, loc);
}

/**
 * `睡眠時間(chara)` —— 当前是否处于睡眠时段。
 *
 * 上游 `COMMON.ERB:886-902`：主角看 `CFLAG:MASTER:睡眠`，其余角色比较
 * `就寝時間 + 清醒剤` 与当前时刻是否跨过 `起床時間`。
 *
 * 只有 `CFLAG:313 睡眠` 这个**直接标记**在现代是可信的；跨零点的时间区间
 * 比较需要 `就寝時間` / `起床時間` / `清醒剤` 三个 CFLAG，其中只有
 * `睡眠` 语义完整，其余尚未接入，所以**不做**跨零点判定。给 false = 少图。
 */
function sleepingCheckOf(state: GameState, charaNum: number, chara: CharaSlot | undefined): boolean {
  const subject = charaNum === 0 ? state.master : chara;
  return (subject?.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0;
}

/**
 * `CHECK_NUDE(chara)` —— 上游 `IMAGE.ERB:898-910`：
 * ```
 * SIF FLAG:立絵種類 && !TEQUIP:上半身着衣状況 → 1
 * SIF !FLAG:立絵種類 && !TEQUIP:上半身着衣状況 && !TEQUIP:下半身着衣状況 → 1
 * SIF BATHROOM(CFLAG:CHARA:現在位置) && !TFLAG:泡風呂 → 1
 * 否则 0
 * ```
 * 前两条只依赖 `TEQUIP:0/1`（`clothing-write.ts:163 recomputeExposure` 维护），
 * 可以照抄。第三条依赖逐字符的浴室设施表，未接入 → false（少图）。
 *
 * 注意别用 `isNaked()` 顶替：那是「所有衣服都脱了」，语义比 CHECK_NUDE 宽，
 * 两者判定集合不同（例如顔絵模式下 CHECK_NUDE 允许下半身仍穿着）。
 *
 * ⚠️ **也别用 `describeClothing().naked` 顶替** —— 那个要求上下衣 + 两种内衣
 * **全空**，而 CHECK_NUDE **根本不看内衣**。「只穿内衣、其它全裸」时两者
 * 结论相反。渲染层过去用的是 `describeClothing().naked`（`HSessionView`），
 * 那个偏差**在换装之前就存在**；本函数导出后，底图与换装用同一个判断。
 */
export function checkNude(state: GameState, charaNum: number): boolean {
  const chara = charaNum === 0 ? state.master : state.charas[charaNum];
  return checkNudeOf(state, chara);
}

function checkNudeOf(state: GameState, chara: CharaSlot | undefined): boolean {
  if (!chara) return false;
  const face = portraitKindOf(state) === "face";
  const upperOff = readTequip(chara, TEQUIP_ID.上半身着衣状況) === 0;
  const lowerOff = readTequip(chara, TEQUIP_ID.下半身着衣状況) === 0;
  if (face && upperOff) return true;
  if (!face && upperOff && lowerOff) return true;
  return false;
}

/**
 * `NUDITYCHECK(chara)` —— 上游 `差分画像用関数.ERB:1-59` 的加权分，**0..32**。
 *
 * ⚠️ **是 IF/ELSEIF 链，不是各项独立累加。** 13 连衣裙 / 14 和服 / 10 紧身衣
 * 三者**只命中一个**（+9 / +9 / +4）；16/17 上衣只命中一个（+5）；11/12 下衣
 * 也只命中一个（+4）。写成独立求和会让「连衣裙+和服」得 18，而上游是 9 ——
 * 那会选到完全不同的一套立绘。最大值 3+20+9 = 32。
 *
 * ⚠️ **照抄上游 bug：`ELSEIF EQUIP:13` / `ELSEIF EQUIP:14`（:52-55）是死代码**，
 * 因为外层 `ELSE` 已经保证了 13/14 都为 0；`EQUIP:15 裙子` 全函数从未被引用。
 * 补上它会让「穿裙子的裸体角色」裸露度变化，换一批立绘 —— 与上游不一致。
 * **这里刻意保留这个 bug。**
 */
function nudityCheckOf(chara: CharaSlot | undefined): number {
  if (!chara) return 0;
  const at = (slot: number): boolean => (chara.state.EQUIP[slot] ?? 0) > 0;
  const S = EQUIP_SLOT;
  let score = 0;

  // ;全身内衣
  if (at(S.レオタード)) score += 3;
  else {
    if (at(S.下半身内衣１)) score += 1;
    else if (at(S.下半身内衣２)) score += 1;
    if (at(S.上半身内衣１)) score += 2;
    else if (at(S.上半身内衣２)) score += 2;
  }

  // ;外搭
  if (at(S.外搭)) score += 20;

  // ;全身外套 —— ELSEIF 链
  if (at(S.連衣裙)) score += 9;
  else if (at(S.和服)) score += 9;
  else if (at(S.ボディースーツ)) score += 4;
  else {
    if (at(S.上身衣服２)) score += 5;
    else if (at(S.上身衣服１)) score += 5;
    if (at(S.裤子)) score += 4;
    else if (at(S.下身衣服)) score += 4;
    // ELSEIF EQUIP:13 / EQUIP:14 是上游死代码，见上方说明，不实现
  }
  return score;
}

/**
 * `IS_BUNNY(chara)` —— 上游 `STAND_COM_IMAGE.ERB:88-101`：
 * `CURRENT_CLOTHES_SET == 55 || == 66`，两个都是兔女郎套装。
 */
function isBunnyOf(clothesSet: number): boolean {
  return clothesSet === 55 || clothesSet === 66;
}

/**
 * `CURRENT_CLOTHES_SET(chara)`。
 *
 * 上游 `CHECK_CLO.ERB:50-305`（256 行）四个分支：
 *  1. `TCVAR:EVENT_CLOTHING_SET` 非 0 → 返回它   ← ✅ 已实现
 *  2. `INRANGE(CFLAG:衣装一時変更, 1, 99)` → 返回 `衣装一時変更`  ← ✅ 已实现
 *  3. `衣装一時変更==100 || 基本服装セット==1000` → 走 245 行的套装反查表
 *     （需要 `衣装セット` 的**按名**查表 + `CFLAG:609/610`，**未移植**）
 *  4. `:305 RETURNF CFLAG:基本服装セット`        ← ✅ 已实现（这是最终 else）
 *
 * **跳过第 3 支是安全的**：`衣装一時変更==100` / `基本服装セット==1000` 是
 * 极少数状态，落回第 4 支 = 少一条图。**绝不能拿一个「随便的套装」兜底** ——
 * 那会让角色穿错衣服。
 */
function currentClothesSetOf(chara: CharaSlot | undefined): number {
  if (!chara) return 0;
  // 支 1：TCVAR:911 EVENT_CLOTHING_SET
  const eventSet = chara.state.TCVAR[TCVAR_ID.EVENT_CLOTHING_SET] ?? 0;
  if (eventSet !== 0) return eventSet;
  // 支 2：CFLAG:656 衣装一時変更 ∈ [1, 99]
  const temp = chara.state.CFLAG[CFLAG_ID.衣装一時変更] ?? 0;
  if (temp >= 1 && temp <= 99) return temp;
  // 支 3 未实现（见上方说明）→ 直接落支 4
  return chara.state.CFLAG[CFLAG_ID.基本服装SET] ?? 0;
}

/**
 * `CHECK_CLO(name, chara)`。
 *
 * 上游 `CHECK_CLO.ERB:1-35` 只有 4 个合法 name，而**实测 1287 条规则里只出现
 * `bra_visible`**（另外 3 个 0 次引用），所以只实现它。
 *
 * `bra_visible` 的上游定义（`CHECK_CLO.ERB:13-19`，逐字）：
 * ```
 * RETURNF (!EQUIP:上半身上着１ && !EQUIP:上半身上着２ && !EQUIP:外衣
 *        && !EQUIP:着物 && !EQUIP:ワンピース && !EQUIP:レオタード && !EQUIP:ボディースーツ
 *        && (EQUIP:上半身下着１ || EQUIP:上半身下着２))
 *   || GETMETH_INT(ARG, "衣装セット", CURRENT_CLOTHES_SET(ARG), "SWIMWEAR")
 * ```
 *
 * **我第一版用 `TEQUIP:上半身着衣状況 === 0` 是错的** —— 那是 `recomputeExposure`
 * 维护的暴露度标记，上游判的是**这 7 个具体 EQUIP 槽位**。错的方向危险：
 * 更宽松 → 穿衣角色被判成「内衣可见」→ 命中 `_下着` → 画出内衣立绘。
 *
 * 第二分支的 `SWIMWEAR` 我原先判断「需要角色 CSV 字段、现代没有」——**也是错的**。
 * 它读的是 eraTW 的 METH 类系统（不是 `CSV/Chara/*.csv`）。我扫了
 * `ERB/OBJ/CLASS/衣装セット.ERB` + `METH_衣装セット.ERB`，**恰好 10 个套装对象
 * 有 `CASE "SWIMWEAR"` = 1**（24/25/26/27/28/29/30/47/52/53，与
 * `Chara_data_162_チミ.ERB:174`「套装 52/53 → 比基尼」互证）。
 * **所以两个分支都不需要任何外部数据。**
 *
 * ⚠️ `上半身下着１/２` 这两个名字**不在 IR 的 18 个 equip key 里**（只出现在
 * CHECK_CLO 函数体内，抽取器看不到），但**在生成的 `EQUIP_ID_BY_NAME` 里**。
 */
function checkCloOf(
  chara: CharaSlot | undefined,
  clothesSet: number,
): Readonly<Record<string, boolean>> {
  if (!chara) return {};
  const worn = (name: string): boolean => {
    const id = EQUIP_ID_BY_NAME[name];
    return id !== undefined && (chara.state.EQUIP[id] ?? 0) !== 0;
  };
  // ⚠️ 槽位名必须用**上游 CHECK_CLO 源码里的原名**，不能自己挑等价物：
  // 「上半身上着１/２」= 上衣（槽 17/16），「上半身下着１/２」= 上半身内衣（槽 7/8）。
  // 我第一版把 `上半身内衣１/２` 误当成上衣放进了「没穿」列表 —— 于是只要穿着
  // 内衣就判 false，`bra_visible` 永远不成立。名字一律查表，不手抄 id。
  const upperBodyBare = [
    "上半身上着１", "上半身上着２", "外衣", "着物", "ワンピース", "レオタード", "ボディースーツ",
  ].every((slot) => !worn(slot));
  const hasTopUnderwear = worn("上半身下着１") || worn("上半身下着２");
  return {
    bra_visible: (upperBodyBare && hasTopUnderwear) || SWIMWEAR_SET_IDS.has(clothesSet),
  };
}

/**
 * `衣装セット.<id>.SWIMWEAR == 1` 的 10 个套装 id。
 *
 * 源：`ERB/OBJ/CLASS/衣装セット.ERB`（衣装セット24/25/26/27/28/29/30/47/52/53）
 * 与 `METH_衣装セット.ERB` 的同 10 个对象。泳装套装。
 */
const SWIMWEAR_SET_IDS: ReadonlySet<number> = new Set([24, 25, 26, 27, 28, 29, 30, 47, 52, 53]);

/**
 * 数字 FLAG。`state.flagStore` 本来就是稀疏 `Record<number, number>`，
 * **直接透传**，不做任何转换。
 *
 * 之前这里是 `EMPTY_ARRAY` —— 真遗漏（`game-state.ts:1049` 的数据一直在）。
 * 修的时候我想过摊平成数组（IR 节点用 `FLAG:n` 下标寻址），但那会在
 * 「每角色 × 每帧 × 每个画点」各分配一次上千元素数组（FLAG id 到 1061+），
 * 纯浪费。IR 求值一律走 `ctx.flag[n] ?? 0`，稀疏 map 一样работает。
 */
function flagLookup(state: GameState): Readonly<Record<number, number>> {
  return state.flagStore;
}

/**
 * `SPIRIT_马尾判定_64` —— `RETURNF FLAG:9 % 2`（`魔改内容/GRAPH系_ImgChara.ERB:395-399`）。
 *
 * 条件形态是「奇数天成立」，即 `!(FLAG:9 % 2 == 0)`。
 * 依赖 `flag` 数组（见 `flagArray`）。
 */
function spiritTailedOf(state: GameState): boolean {
  return (state.flagStore[9] ?? 0) % 2 !== 0;
}

/**
 * `K63_HOOD(ARG)` —— 影狼的兜帽判定（`Chara_data_63_影狼.ERB:332-339`）：
 * ```
 * SIF CFLAG:63:うふふ → RETURNF 0
 * SIF GET_MAPID(CFLAG:63:現在位置) == 2 || (OUTROOF(CFLAG:63:現在位置) && DAY:2 == 4) → RETURNF 1
 * RETURNF 0
 * ```
 * `うふふ` 与 `诶嘿嘿` **是同一个 CFLAG 317**（`.als` 里的日文别名）。
 * `GET_MAPID(placeId) = placeId / 100`（`COMMON2.ERB:30`）—— 纯算术。
 *
 * **只实现「在人里」那一支**，`OUTROOF && 冬` 支 fail-closed（`outRoof` 存在但
 * 它要 `placeFlagsOf` 的位域，与 `K63_HOOD` 用的 `現在位置` 是不同的寻址路径，
 * 少一条分支 = 少图 = 安全）。
 */
function k63HoodOf(chara: CharaSlot | undefined): boolean {
  if (!chara) return false;
  if ((chara.state.CFLAG[317] ?? 0) !== 0) return false; // うふふ中 → 不戴
  const place = chara.state.CFLAG[CFLAG_ID.現在位置] ?? 0;
  return Math.floor(place / 100) === 2; // GET_MAPID(現在位置) == 2（人里）
  // `|| (outRoof(...) && DAY:2 == 4)` 这一支刻意不实现 —— 见上方说明
}

/**
 * `SHIRAHU(ARG)` —— `COMMON.ERB:827-841`，返回 0/1/2（2 = うふふ中）。
 * `WORKING` 的第一道门：`IF !SHIRAHU(ARG) && !ARG:1 → RETURNF 0`。
 */
function shirahuOf(state: GameState, chara: CharaSlot | undefined): number {
  if (!chara) return 0;
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0
    && (chara.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0) {
    return 0;
  }
  const asleep =
    (chara.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0
    || (chara.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0
    || (chara.state.TCVAR[TCVAR_ID.烂醉] ?? 0) !== 0
    || (chara.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0;
  if (asleep) return 0;
  return (state.tflagStore?.[102] ?? 0) > 1 ? 2 : 1;
}

/**
 * `CHARA_HOLIDAY(ARG, ARG:1=0)` —— `MOVEMENTS/JOB_仕事内容.ERB:9-21`。
 * 0 = 工作日，1 = 休息日。
 */
function charaHolidayOf(
  chara: CharaSlot | undefined,
  minutesNow: number,
): boolean {
  if (!chara) return true; // 无角色 → 当休息日（fail-closed 的安全侧）
  if ((chara.state.BASE[BASE_ID.工作量] ?? 0) <= 0) return true;
  const end = chara.state.TCVAR[TCVAR_ID.工作結束] ?? 0;
  if (end > 0 && minutesNow > end) return true;
  return (chara.state.TCVAR[TCVAR_ID.工作開始] ?? 0) === -1;
}

/**
 * `WORKING(ARG, ARG:1)` —— `COMMON.ERB:1013-1027`，「是否在工作时段」。
 * ⚠️ 上游是**两个参数**；特殊服装里都写成单参（`WORKING(CHARA)`），此时
 * `ARG:1` = 0，第一道门 `!SHIRAHU(ARG) && !ARG:1` 退化成只看 `SHIRAHU`。
 */
function workingOf(
  state: GameState,
  chara: CharaSlot | undefined,
  minutesNow: number,
): boolean {
  if (!chara) return false;
  if (shirahuOf(state, chara) === 0) return false;
  const start = chara.state.TCVAR[TCVAR_ID.工作開始] ?? 0;
  const end = chara.state.TCVAR[TCVAR_ID.工作結束] ?? 0;
  if (!inWrap(minutesNow, start, end)) return false;
  if ((chara.state.BASE[BASE_ID.工作量] ?? 0) <= 0) return false;
  if (charaHolidayOf(chara, minutesNow)) return false;
  return true;
}

/**
 * `IS_半脱(ARG, ARG:1)` —— `魔改内容/qol/qol_脱衣.ERB:27-49`。
 *
 * **宽窄两分支上游语义完全相同**，都等于 `TEQUIP:上半身裸露状態`：
 * 宽分支里的 `SIF !CAN_半脱(ARG) → RETURNF 0` 永远成立，因为
 * `CAN_半脱`（`qol_脱衣.ERB:15`）的 `EQUIP:ARG:0 == 0` **恒真** ——
 * 装备槽位是 1..22（`CSV/Equip.csv` 核实），**没有 0 号槽**。
 * 于是 `诶嘿嘿` / `GROUPMATCH(PREVCOM,…)` 那两条永远到不了。
 *
 * ⚠️ **保留这个上游 bug。** 修好它会让宽分支开始通过 `诶嘿嘿`/`PREVCOM`
 * 返回 1 → 换一批与上游不同的立绘。
 */
function isHalfUndressedOf(chara: CharaSlot | undefined): boolean {
  if (!chara) return false;
  return readTequip(chara, TEQUIP_ID.上半身裸露状態) !== 0;
}

/**
 * `CHK_DATENOW(CFLAG:约会中)` —— `MOVEMENTS/物件関連/COMMON2.ERB:7-19`，
 * 剥掉 GMF 分支后就是「参数 ≠ MAIN_MAP」。
 * `CFLAG:约会中` 存的是约会目的地的 MAPID；`MAIN_MAP_ID = 0`
 * （`location-predicates.ts:64` 已写明）。现代另有 `chkDateNow`（`:137`）。
 */
function chkDateNowOf(chara: CharaSlot | undefined): boolean {
  return chkDateNow(chara?.state.CFLAG[CFLAG_ID.约会中] ?? MAIN_MAP_ID);
}

/** DLC 选项 56「浴袍补丁」。`#DIM SAVEDATA`，默认 0 = 关闭。 */
function bathrobeSwitchOf(state: GameState): boolean {
  return (state.dlcSavedata?.["BATHROBE_SWITCH"] ?? 0) !== 0;
}

/**
 * 装配一个角色当前帧的换装判定上下文。
 *
 * `charaNum` 传的是**实际画的是谁**（变身时是变身后的角色），与上游
 * `VIS_C` 一致。
 */
export function buildOutfitContext(
  state: GameState,
  charaNum: number,
): OutfitContext {
  const chara = charaNum === 0 ? state.master : state.charas[charaNum];
  const clothesSet = currentClothesSetOf(chara);
  const kind = portraitKindOf(state);
  const cflag: Record<number, number> = { ...(chara?.state.CFLAG ?? {}) };
  // 替换包 id 走专用字段 `variant`，同时也放进 cflag 让
  // `CFLAG:CHARA:差し替え適用` 形态的规则也能读到。
  const variant = portraitVariantOf(state, charaNum);
  if (variant !== 0) cflag[CFLAG_ID.差し替え適用] = variant;

  const ctl: Record<string, number> = {};
  if (state.flagStore[FLAG_ID.立絵種類] !== undefined) {
    ctl["立絵種類"] = state.flagStore[FLAG_ID.立絵種類]!;
    ctl["立ち絵種類"] = state.flagStore[FLAG_ID.立絵種類]!;
  }

  return {
    charaNum,
    variant,
    // `GROUPMATCH(CFLAG:差し替え適用, g)`。上游是「取值属于候选组」；
    // 抽取器只保留最后一个候选（实测当前数据全是单候选），所以等价于相等。
    groupMatch: (value, group) => value === group,
    portraitKindFace: kind === "face",
    checkNude: checkNudeOf(state, chara),
    clothesSet,
    nudityCheck: nudityCheckOf(chara),
    checkClo: checkCloOf(chara, clothesSet),
    isBunny: isBunnyOf(clothesSet),
    bathroom: bathroomOf(state, chara),
    bathrobeSwitch: bathrobeSwitchOf(state),
    equip: equipLookup(chara),
    tequip: tequipLookup(chara),
    tcvar: tcvarLookup(chara),
    day: dayArray(state),
    time: timeArray(state),
    flag: flagLookup(state),
    cflag,
    masterCflag: { ...(state.master.state.CFLAG ?? {}) },
    talent: talentLookup(chara),
    tflag: { ...(state.tflagStore ?? {}) },
    abl: { ...(chara?.state.ABL ?? {}) },
    festival: festivalNow(state.time),
    sleepingCheck: sleepingCheckOf(state, charaNum, chara),
    minutesNow: state.time.tickValue % 1440,
    isHalfUndressed: isHalfUndressedOf(chara),
    working: workingOf(state, chara, state.time.tickValue % 1440),
    // 角色专属：影狼兜帽 / 勇儀马尾 / 小町的「房里只有一个人」/ 约会当天
    k63Hood: k63HoodOf(chara),
    spiritTailed: spiritTailedOf(state),
    dateNow: chkDateNowOf(chara),
    prevCom: state.turnContext?.prevCom ?? 0,
    targetNum: presentNpcs(state, state.master.location).length,
  };
}

// 让 tsc 知道 key 模块被用到了（它是生成物，不该被 tree-shake 掉别名表）
void outfitKeyId;
void TCVAR_ID;
