import type { Rng } from "../command/types.js";
import type { GameState } from "../state/index.js";
import type { CharaSlot } from "../state/game-state.js";
import { showBottom, showLowerUnderwear, showTop, showUpperUnderwear } from "../state/clothing.js";
import { talentDisplayName } from "../state/talent-categories.js";
import {
  CFLAG_ID,
  EQUIP_SLOT,
  EXP_ID,
  PALAM_ID,
  PALAMLV,
  TALENT_ID,
} from "../state/settlement.js";

export type KojoNameReference = number | string;
export type KojoNameResolver = (
  reference: KojoNameReference,
) => string | undefined;

export interface KojoNameRenderOptions {
  state: Readonly<GameState>;
  charaNum: number;
  nameResolver?: KojoNameResolver;
  aliases?: Readonly<Record<string, string>>;
  masterName?: string;
  targetName?: string;
  targetFallback?: string;
  numericFallback?: (charaNum: number) => string;
  /** Optional deterministic source RNG for common authored text helpers. */
  rng?: Rng;
  /** Runtime predicate bridge for text helpers such as COND_STR. `null`
   * keeps unresolved conditions fail-closed at final validation. */
  evaluateCondition?: (raw: string) => boolean | null;
}

export interface KojoTextRenderOptions extends KojoNameRenderOptions {
  rng: Rng;
}

interface TextrMacro {
  end: number;
  alternatives: string[];
}

const TEXTR_PREFIX = "%TEXTR(";
const CALLNAME_RE = /%CALLNAME:([^%\r\n]+)%/g;
const CLOTHING_FORMATTER_RE = /%(SHOW_BOTTOM|SHOW_TOP|SHOW_下半身内衣|SHOW_上半身内衣)\(\s*(TARGET|MASTER|PLAYER|\d+)\s*(?:,\s*[^)]*)?\)%/gi;
const PANTSNAME_FORMATTER_RE = /%PANTSNAME\(\s*[^,]+,\s*(TARGET|MASTER|PLAYER|\d+)\s*(?:,\s*([01]))?\s*\)%/gi;
const TINKO_FORMATTER_RE = /%TINKO\(\s*(TARGET|MASTER|PLAYER|\d+)\s*(?:,\s*[^)]*)?\)%/gi;
const SLIT_FORMATTER_RE = /%SLIT\(\s*(?:TARGET|MASTER|PLAYER|\d+)?\s*(?:,\s*[^)]*)?\)%/gi;
const OPPAI_FORMATTER_RE = /%OPPAI_DESCRIPTION\(\s*(TARGET|MASTER|PLAYER|\d+)\s*(?:,\s*[^)]*)?\)%/gi;
const NIPPLE_FORMATTER_RE = /%NIPPLE_DESCRIPTION\(\s*(TARGET|MASTER|PLAYER|\d+)\s*(?:,\s*[^)]*)?\)%/gi;
const CSTR_TOKEN_RE = /%CSTR:(\d+):(\d+)%/g;
const NICKNAME_TOKEN_RE = /%NICKNAME:(\d+)%/g;
const INNERMOST_FUNCTION_FORMATTER_RE = /%([A-Z0-9_]+)\(([^%\r\n]*)\)%/gi;
const HIP_FORMATTER_RE = /%HIP\(\s*(TARGET|MASTER|PLAYER|\d+)\s*(?:,\s*([01])\s*)?(?:,\s*\d+\s*)?\)%/gi;

/**
 * `@HIP` adjective pool — EVENT_MESSAGE.ERB:553-601 (the fork's UTF-8
 * Simplified Chinese wording). Index = the SELECTCASE arm 0-49; arms 38-49
 * map the four fantasy tiers onto a shared adjective each.
 */
const HIP_ADJECTIVES: readonly string[] = [
  "犹如去壳鸡蛋般白嫩的", // 0 — 幼儿体型
  "没什么肉但手感极佳的", // 1
  "孩童般稚嫩的", // 2
  "娇小的", // 3
  "可爱的", // 4
  "娇小可爱的", // 5 — -1 纤细体型
  "纤细匀称的", // 6
  "形状优美的", // 7
  "小巧纤细的", // 8
  "玲珑小巧的", // 9
  "白嫩嫩的", // 10
  "雪白弹嫩的", // 11
  "吹弹可破的娇嫩", // 12
  "洋溢着少女气息的紧致", // 13 — 普通/有肉体型
  "弹性极好洋溢着青春活力的", // 14
  "弹性极好洋溢着青春活力的", // 15
  "弹嫩紧致的", // 16
  "不带一丝赘肉的娇嫩", // 17
  "手感好到舍不得松手的", // 18
  "美型且紧致的", // 19
  "圆润紧致的", // 20
  "线条匀称优美的", // 21
  "雪白水润的", // 22
  "肉肉的", // 23 — 大屁股
  "丰满桃形的", // 24
  "从身材上难以想象的丰满", // 25
  "曲线诱人且弹性十足的", // 26
  "一看就是安产型的", // 27
  "丰满浑圆的", // 28
  "丰腴却没有赘肉的", // 29
  "带着成熟魅力的", // 30
  "肉感十足的", // 31 — 巨臀
  "成熟魅惑的丰满", // 32
  "丰腴浑圆、肉感极佳的", // 33
  "带着女性媚香的硕大", // 34
  "臀浪满溢而出的", // 35
  "熟透了的水蜜桃般的丰盈", // 36
  "令人欲罢不能的丰硕", // 37
  "令人无法移开视线的硕大", // 38-40 — 幻想
  "令人无法移开视线的硕大", // 39
  "令人无法移开视线的硕大", // 40
  "荡漾着白花花臀浪的", // 41-43
  "荡漾着白花花臀浪的", // 42
  "荡漾着白花花臀浪的", // 43
  "夺走人理性的巨大", // 44-46
  "夺走人理性的巨大", // 45
  "夺走人理性的巨大", // 46
  "仿佛将人吸住的超大", // 47-49
  "仿佛将人吸住的超大", // 48
  "仿佛将人吸住的超大", // 49
];

/** `@HIP` SELECTCASE ranges per ヒップサイズ (TALENT:108) — ERB:525-537. */
function hipAdjectiveRange(hipSize: number): readonly [number, number] {
  if (hipSize < -1) return [0, 13];
  if (hipSize === -1) return [5, 20];
  if (hipSize === 0) return [13, 23];
  if (hipSize === 1) return [13, 31];
  if (hipSize < 4) return [23, 38];
  return [23, 50];
}

/** `@HIP` TEXTR noun pools per body shape — ERB:639-648. */
function hipNounPool(hipSize: number, bodyType: number): readonly string[] {
  if (bodyType === -2 && hipSize <= -2) return ["屁屁", "屁股", "粉臀", "玉臀", "俏臀"];
  if (hipSize < 0) return ["屁屁", "屁股", "臀部", "粉臀", "玉臀", "俏臀"];
  if (hipSize < 2) return ["屁股", "臀部", "粉臀", "玉臀", "俏臀", "雪臀", "翘臀"];
  return ["屁股", "臀部", "雪臀", "玉臀", "肉尻", "肥臀", "翘臀"];
}

/** `@TOKANJIT` (INFO.ERB:954) — number → 汉字 numeral; liang mode = ARG:1. */
function toKanjiNumeral(value: number, liangMode: boolean): string {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value >= 10000) return "ＢＵＧ";
  let out = "";
  let hasPrev = false;
  const thousands = Math.floor(value / 1000);
  if (thousands > 0) {
    out += (thousands === 2 && liangMode ? "两" : digits[thousands]!) + "千";
    hasPrev = true;
  }
  const hundreds = Math.floor(value / 100) % 10;
  if (hundreds > 0) {
    out += (hundreds === 2 && liangMode ? "两" : digits[hundreds]!) + "百";
    hasPrev = true;
  } else if (hasPrev && value % 100 > 0) {
    out += "零";
  }
  const tens = Math.floor(value / 10) % 10;
  if (tens > 0) {
    // @HIP never passes ARG:2, so a leading 1 keeps the non-abbreviated
    // "一十" form (INFO.ERB:983-988).
    out += digits[tens]! + "十";
    hasPrev = true;
  } else if (hasPrev && value % 10 > 0 && !out.endsWith("零")) {
    out += "零";
  }
  const units = value % 10;
  if (units > 0) {
    out += units === 2 && liangMode && !hasPrev ? "两" : digits[units]!;
  }
  return out;
}

/**
 * `@HIP` status-prefix arm — ERB:522-540. RNG consumption follows the
 * upstream IF/ELSEIF order under Emuera's short-circuit `&&`
 * (OperatorMethod.AndIntInt): a false left operand never rolls the RAND on
 * its right. The 欲情 gate uses the base-game PALAMLV table
 * (`PALAMLV[4] = 10000`; the MAGIC_DLC_好感亲密重做 branch lowers it to
 * 1000 and stays deferred with the DLC itself). The GETMETH_INT
 * transparency lookup is hard-wired to "汗湿": the fork passes simplified
 * 半透明(后) while CLOTHES_METH tables key on 半透明(後), so GETMETH_INT
 * always returns 0 and the upstream ternary always picks the cold arm.
 * Nested %SHOW_下半身内衣%/%PANTSNAME% tokens are emitted for the later
 * passes of `substituteKojoStateFormatters` to expand.
 */
function hipPrefix(slot: CharaSlot, charaNum: number, rng: Rng): string {
  const equip = (id: number) => slot.state.EQUIP?.[id] ?? 0;
  if ((slot.state.PALAM?.[PALAM_ID.欲情] ?? 0) >= PALAMLV[4]!) {
    if (rng.int(4) === 0) {
      if (equip(EQUIP_SLOT.レオタード) || equip(EQUIP_SLOT.ボディースーツ)) {
        return `紧贴着湿透%SHOW_下半身内衣(${charaNum},3)%、`;
      }
      if (equip(EQUIP_SLOT.下半身内衣１)) {
        return `紧贴着汗湿%PANTSNAME(${equip(EQUIP_SLOT.下半身内衣１)}, ${charaNum})%、`;
      }
      if (equip(EQUIP_SLOT.下半身内衣２)) {
        return `紧贴着汗湿%PANTSNAME(${equip(EQUIP_SLOT.下半身内衣２)}, ${charaNum})%、`;
      }
      return "浮现出晶莹汗珠、";
    }
  }
  if (rng.int(5) === 0) {
    const births = slot.state.EXP?.[EXP_ID.出産経験] ?? 0;
    if (births !== 0 && (slot.state.TALENT?.[TALENT_ID.ヒップサイズ] ?? 0) <= 0) {
      return `很难想象属于${toKanjiNumeral(births, true)}个孩子母亲、`;
    }
  }
  if (rng.int(5) === 0) {
    if (
      (slot.state.CFLAG?.[CFLAG_ID.乳ランクアップ] ?? 0) !== 0 &&
      (slot.state.TALENT?.[TALENT_ID.ヒップサイズ] ?? 0) > 0
    ) {
      // The ternary's condition is already guaranteed by this ELSEIF arm.
      return "怀孕后更显媚惑、";
    }
  }
  return "";
}

/**
 * `@HIP(ARG, ARG:1 = 1)` — EVENT_MESSAGE.ERB:516-664, ported verbatim:
 * status prefix (gated by ARG:1) + ヒップサイズ-tiered adjective +
 * TEXTR noun. Rolls exactly like the ERB: a failed IF chain arm, one
 * RAND(lo,hi) for the adjective, one RAND:len for the @TEXTR noun.
 */
function hipDescription(
  slot: CharaSlot,
  charaNum: number,
  withPrefix: boolean,
  rng: Rng,
): string {
  const hipSize = slot.state.TALENT?.[TALENT_ID.ヒップサイズ] ?? 0;
  const bodyType = slot.state.TALENT?.[TALENT_ID.体型] ?? 0;
  // Evaluation order == upstream RNG consumption order: the status prefix
  // arm rolls first, then the tiered adjective, then the TEXTR noun.
  const prefix = withPrefix ? hipPrefix(slot, charaNum, rng) : "";
  const [lo, hi] = hipAdjectiveRange(hipSize);
  const adjective = HIP_ADJECTIVES[lo + rng.int(hi - lo)] ?? HIP_ADJECTIVES[lo]!;
  const nouns = hipNounPool(hipSize, bodyType);
  const noun = nouns[rng.int(nouns.length)] ?? nouns[0]!;
  return prefix + adjective + noun;
}

const FSYN_CN_ALTERNATIVES: Readonly<Record<string, readonly string[]>> = {
  揉弄: ["揉弄", "爱抚", "抚弄", "把玩"],
  抚弄: ["抚弄", "撩拨", "揉弄"],
  淫荡: ["淫荡", "情色", "猥亵", "下流", "低俗", "好色"],
  激烈的: ["激烈的", "强烈的", "凶猛的", "暴力的", "狂暴的", "无情的"],
  射: ["抽送", "倾注", "泄出", "喷出", "射精", "喷射", "迸射", "释放"],
  射精: ["泄出", "喷出", "射精", "喷射", "射", "释放"],
  灌注: ["灌注", "泵送", "喷射", "喷溅", "射出"],
  喷射: ["喷射", "溅射", "射", "喷出"],
  填充: ["填充", "塞满", "填塞", "塞入", "灌满"],
  扭动: ["蠕动", "扭动", "蜿蜒", "扭摆", "扭曲"],
  夹紧: ["夹紧", "按压", "绞紧", "咬紧"],
  蛇缠: ["蛇缠", "螺吸", "淫扭", "浪摆", "波颤"],
  榨取: ["榨取", "挤榨", "绞拧"],
  呻吟: ["呻吟", "呜咽", "尖叫", "哀鸣"],
  潮喷: ["潮喷", "涌浆", "溅汁"],
  淫颤: ["淫颤", "浪扭", "高潮颤", "哆嗦", "蜜颤"],
  搏动: ["搏动", "悸动", "颤抖", "抽搐", "膨胀"],
  深处: ["直达花芯", "直捣最深处的软肉"],
  高潮: ["高潮", "绝顶"],
  磨臀: ["磨臀", "抽插", "旋扭", "猛肏", "浪动", "摇臀", "摇摆", "扭摆", "顶弄"],
  抽插: ["抽插", "猛撞", "插入", "捅入", "猛冲"],
  抽插2: ["研磨", "泵送", "捣入", "锤打"],
  插入: ["猛塞", "顶入", "捅入", "推入", "插入", "捅进", "埋入", "深入", "放入"],
  按倒: ["按", "推", "扔", "投", "抓", "推挤"],
  阴茎: ["阴茎", "老二", "肉棒", "那活儿", "鸡鸡", "鸡巴"],
  蛋蛋: ["蛋蛋", "阴囊", "睾丸", "蛋袋"],
  阴道: ["小穴", "嫩穴", "肉穴"],
  胯部: ["胯下", "小腹", "私密处", "私处"],
  裆部: ["胯下", "小腹", "私密处", "私处"],
  翘臀: ["翘臀", "丰臀"],
  肛门: ["屁穴", "尻穴", "肛门", "臀部", "屁股"],
  胸部: ["乳房", "乳头", "欧派", "硕果", "巨乳", "胸部"],
  阴唇: ["阴唇", "嫩穴蜜唇", "阴道肉褶", "嫩穴花唇"],
  slit: ["唇缝", "蜜缝", "秘处", "私处", "穴口", "蜜肉", "肉蚌"],
  私处: ["唇缝", "蜜缝", "秘处", "私处", "穴口", "蜜肉", "肉蚌"],
  蜜汁: ["爱液", "嫩穴蜜汁", "阴道花蜜", "淫荡蜜液", "滚烫甘蜜"],
  唇部吞咽音: ["嗯呜", "咕啾", "啵啾", "呲溜", "啾噜", "滋啵", "呸咯", "咕啾啾"],
  嘴唇闷音: ["嗯", "嗯嗯", "姆噗", "呣呋", "呣噗", "呼呜", "啊呜", "嗯噗"],
  唇间溢出: ["噗哈", "呼哇", "哈啊啊", "噗啊"],
  嘿: ["嘿", "咦", "啊", "呀", "呀"],
};

const LIGHT_MOANS = ["嗯", "嗯", "嗯", "啊嗯", "唔", "呃唔", "哈", "哈啊", "啊", "啊呜", "唏", "呼哇", "嗯哼", "哈呀", "啊啊", "哦哦", "诶", "呀", "哦"] as const;
const MILD_MOANS = ["哼", "哦嗯", "哈嗯", "嗯嗯", "啊嗯", "哈啊", "啊啊", "呀", "嗯啊", "哈哈嘿", "哈咦", "啊嘿", "呢呀", "呃哇", "唏呀", "嗯呀", "呀啊", "嗯呼呼"] as const;
const HEAVY_MOANS = ["啊啊呜嗯啊", "齁哦啊嗯", "呜呜哦嗯嘎啊", "哈嗯哈啊", "嗯嗯嘎啊", "哈呀啊", "嗯嗯啊", "啊啊嗯", "嗯嗯噗啊", "哈嗯嘎啊呜", "呢呀啊嗯", "啊咿啊"] as const;
const SEMEN_WORDS = ["子种汁", "白浊", "精液", "妊娠汁", "肉棒牛奶", "孕汁", "受孕牛奶", "白浊乳液", "生命之源"] as const;

function parseFormatterArguments(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === '"' && raw[index - 1] !== "\\") quoted = !quoted;
    if (!quoted) {
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  args.push(current.trim());
  return args;
}

function formatterString(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  const quoted = value.startsWith('@"') ? value.slice(1) : value;
  if (quoted.length >= 2 && quoted.startsWith('"') && quoted.endsWith('"')) {
    return quoted.slice(1, -1).replaceAll('""', '"').replaceAll('\\"', '"');
  }
  return quoted;
}

function formatterPick(values: readonly string[], options: KojoNameRenderOptions): string {
  if (values.length === 0) return "";
  const index = options.rng?.int(values.length) ?? 0;
  return values[((index % values.length) + values.length) % values.length] ?? values[0]!;
}

function formatFsyn(raw: string, options: KojoNameRenderOptions): string | null {
  const [base, ...flags] = formatterString(raw).split(":");
  let choices = FSYN_CN_ALTERNATIVES[base!];
  if (base === "淫荡" && flags.includes("ly")) {
    choices = ["淫荡地", "情色地", "猥亵地", "下流地", "低俗地", "好色地"];
  } else if (base === "插入" && flags.includes("f")) {
    choices = ["推入", "引导", "滑入", "纳入", "插入", "滑进"];
  } else if (base === "射精" && flags.includes("v")) {
    choices = ["射精", "射出"];
  }
  return choices ? formatterPick(choices, options) : null;
}

function formatMoan(args: readonly string[], options: KojoNameRenderOptions): string {
  const mode = formatterString(args[0]) || "l";
  const count = Math.max(1, Number(args[2] || 1) || 1);
  const pool = mode === "h" || mode === "heavy"
    ? HEAVY_MOANS
    : mode === "m" || mode === "mild"
      ? MILD_MOANS
      : LIGHT_MOANS;
  return Array.from({ length: count }, () => formatterPick(pool, options)).join(",");
}

function evaluateCommonFormatter(
  name: string,
  rawArguments: string,
  options: KojoNameRenderOptions,
): string | null {
  const args = parseFormatterArguments(rawArguments);
  switch (name.toUpperCase()) {
    case "BREAKENG":
      // The browser renderer owns line layout; preserve the authored text
      // while still evaluating nested common formatters on the next pass.
      return formatterString(args[0]);
    case "TOUPPER":
      return formatterString(args[0]).toUpperCase();
    case "K30_C_NAME": {
      const rawSubject = formatterString(args[0]).toUpperCase();
      const reference = rawSubject === "MASTER" || rawSubject === "PLAYER" || rawSubject === "0"
        ? 0
        : rawSubject === "TARGET"
          ? options.charaNum
          : Number(rawSubject);
      if (!Number.isSafeInteger(reference)) return null;
      if (reference === 0) {
        return options.masterName || options.state.master.callName || "主角";
      }
      if (reference === options.charaNum) {
        return options.targetName
          ?? resolvedReference(reference, options)
          ?? options.targetFallback
          ?? "对方";
      }
      return resolvedReference(reference, options)
        ?? options.numericFallback?.(reference)
        ?? null;
    }
    case "K17_CNAME": {
      const rawSubject = formatterString(args[0]).trim().toUpperCase();
      const reference = rawSubject === "" || rawSubject === "MASTER" || rawSubject === "PLAYER" || rawSubject === "0"
        ? 0
        : rawSubject === "TARGET"
          ? options.charaNum
          : Number(rawSubject);
      if (!Number.isSafeInteger(reference)) return null;
      return reference === 0
        ? options.masterName || options.state.master.callName || "主角"
        : resolvedReference(reference, options)
          ?? options.numericFallback?.(reference)
          ?? (reference === options.charaNum ? options.targetName ?? options.targetFallback ?? "对方" : null);
    }
    case "SPLIT_G": {
      const source = formatterString(args[0]);
      const delimiter = formatterString(args[1]) || ":";
      return formatterPick(source.split(delimiter), options);
    }
    case "FSYN_CN": return formatFsyn(args[0] ?? "", options);
    case "MOAN_CN": return formatMoan(args, options);
    case "K2_EXPRESSION_VARIATION": {
      const key = formatterString(args[0]).toUpperCase();
      const words: Readonly<Record<string, readonly string[]>> = {
        SPERM: ["白浊液", "精液", "精液", "子种汁"],
        VULVA: ["秘处", "秘裂", "阴门", "女阴"],
        ANUS: ["尻穴", "肛门", "菊门"],
        CROTCH: ["股间", "臀沟", "股沟"],
        PENIS: ["肉棒", "肉棒", "肉棒", "肉棒"],
      };
      return words[key] ? formatterPick(words[key]!, options) : null;
    }
    case "SAMEN_DESCRIPTION": return formatterPick(SEMEN_WORDS, options);
    case "HE_SHE_CN": {
      const rawSubject = formatterString(args[0]).toUpperCase();
      const subject = rawSubject === "MASTER" || rawSubject === "PLAYER" || rawSubject === "0"
        ? options.state.master
        : rawSubject === "TARGET"
          ? options.state.charas[options.charaNum]
          : options.state.charas[Number(rawSubject)];
      if (!subject) return null;
      return (subject.state.TALENT[2] ?? 0) === 2 ? "他" : "她";
    }
    case "PRINT_MALE_CN": {
      const subjectToken = formatterString(args[1]).toUpperCase();
      const subject = subjectToken === "MASTER" || subjectToken === "PLAYER" || subjectToken === "0"
        ? options.state.master
        : subjectToken === "TARGET"
          ? options.state.charas[options.charaNum]
          : options.state.charas[Number(subjectToken)];
      if (!subject) return null;
      const choices = formatterString(args[0]) || "家伙";
      const [male, female = male] = choices.split(":");
      if (male !== female) {
        return (subject.state.TALENT[2] ?? 0) === 2 ? male! : female!;
      }
      const femaleWord: Readonly<Record<string, string>> = {
        "家伙": "女孩",
        "男": "女",
        "男人": "女人",
        "男孩": "女孩",
        "男孩子": "女孩子",
        "先生": "小姐",
        "老哥": "老妹",
      };
      return (subject.state.TALENT[2] ?? 0) === 2
        ? male!
        : (femaleWord[male!] ?? male!);
    }
    case "SPLIT_M": {
      const remaining = formatterString(args[0]).split(":");
      const pad = formatterString(args[1]).split(":")[0] ?? "";
      const count = Math.min(remaining.length, Math.max(0, Number(args[2]) || 0));
      const selected: string[] = [];
      for (let index = 0; index < count; index++) {
        const picked = formatterPick(remaining, options);
        selected.push(picked);
        remaining.splice(remaining.indexOf(picked), 1);
      }
      return selected.join(pad);
    }
    case "GROAN_CN":
    case "GROAN": {
      const mode = formatterString(args[0]);
      const pool = mode === "咕" ? ["咕", "咔", "呵", "喀", "哈啊", "呃"]
        : mode === "嗯" ? ["嗯", "啊", "嘎", "呃"]
          : ["呃", "啊", "哦", "唔", "嗯"];
      const count = Math.max(1, Number(args[2] || 1) || 1);
      return Array.from({ length: count }, () => formatterPick(pool, options)).join(", ");
    }
    case "KISS_CN": {
      const mode = formatterString(args[0]);
      const choices = mode === "吸" || mode.toLowerCase() === "suck"
        ? ["滋啵", "呸咯", "咕啾啾", "呲溜", "嘶噜噜", "咧啰", "啵啊"]
        : ["亲", "姆哇", "啵", "亲亲", "啾"];
      return formatterPick(choices, options);
    }
    case "RANDKISS_CN":
      return evaluateCommonFormatter("KISS_CN", rawArguments, options);
    case "RANDLIPS_CN": {
      const mode = formatterString(args[1]);
      const swallow = formatterPick(FSYN_CN_ALTERNATIVES.唇部吞咽音!, options);
      const muffled = formatterPick(FSYN_CN_ALTERNATIVES.嘴唇闷音!, options);
      const kiss = evaluateCommonFormatter("KISS_CN", JSON.stringify(mode), options) ?? "啾";
      return `${swallow} ${muffled} ${kiss}`;
    }
    case "SLUR": {
      const inner = args[0] ?? "";
      const nested = /^([A-Z_]+)\((.*)\)$/iu.exec(inner);
      const source = nested
        ? evaluateCommonFormatter(nested[1]!, nested[2]!, options)
        : formatterString(inner);
      if (source === null) return null;
      const mode = Number(args[1]);
      if (mode === -1 || mode === -2 || mode === -3 || mode === -4) return source;
      const repeats = mode > 0 ? mode : 2 + (options.rng?.int(4) ?? 0);
      return source ? source + source.at(-1)!.repeat(repeats) : source;
    }
    case "COND_STR": {
      const condition = options.evaluateCondition?.(args[1] ?? "") ?? null;
      return condition === null ? null : condition ? formatterString(args[0]) : "";
    }
    case "PLNOUN": return formatterString(args[0]);
    case "GET_TALENTNAME": {
      const id = Number(args[0]);
      const value = Number(args[1]);
      return Number.isSafeInteger(id) && Number.isSafeInteger(value)
        ? talentDisplayName(id, value)
        : "";
    }
    default: return null;
  }
}

function substituteKojoCommonFormatters(
  text: string,
  options: KojoNameRenderOptions,
): string {
  let out = text;
  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    out = out.replace(INNERMOST_FUNCTION_FORMATTER_RE, (token, name: string, rawArguments: string) => {
      const replacement = evaluateCommonFormatter(name, rawArguments, options);
      if (replacement === null) return token;
      changed = true;
      return replacement;
    });
    if (!changed) break;
  }
  return out;
}

function parseTextrMacro(text: string, start: number): TextrMacro | null {
  let cursor = start + TEXTR_PREFIX.length;
  const verbatim = text[cursor] === "@";
  if (verbatim) cursor += 1;
  if (text[cursor] !== "\"") return null;
  cursor += 1;

  let body = "";
  while (cursor < text.length) {
    const char = text[cursor]!;

    if (verbatim && char === "\"" && text[cursor + 1] === "\"") {
      body += "\"";
      cursor += 2;
      continue;
    }
    if (!verbatim && char === "\\" && cursor + 1 < text.length) {
      const escaped = text[cursor + 1]!;
      if (escaped === "\"" || escaped === "\\") {
        body += escaped;
        cursor += 2;
        continue;
      }
    }
    if (char === "\"") {
      let close = cursor + 1;
      while (/\s/.test(text[close] ?? "")) close += 1;
      if (text[close] === ")" && text[close + 1] === "%") {
        return {
          end: close + 2,
          alternatives: body.split("/"),
        };
      }
      return null;
    }

    body += char;
    cursor += 1;
  }

  return null;
}

/**
 * Select every authored `%TEXTR("a/b")%` alternative in source order.
 *
 * Empty alternatives are significant in era text, so `a/` remains a
 * two-way choice. Malformed calls are left untouched for final validation.
 */
export function selectTextrAlternatives(text: string, rng: Rng): string {
  if (!text.includes(TEXTR_PREFIX)) return text;

  let out = "";
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(TEXTR_PREFIX, cursor);
    if (start < 0) {
      out += text.slice(cursor);
      break;
    }

    out += text.slice(cursor, start);
    const macro = parseTextrMacro(text, start);
    if (!macro) {
      out += TEXTR_PREFIX;
      cursor = start + TEXTR_PREFIX.length;
      continue;
    }

    const index = rng.int(Math.max(1, macro.alternatives.length));
    out += macro.alternatives[index] ?? macro.alternatives[0] ?? "";
    cursor = macro.end;
  }
  return out;
}

function stateName(
  state: Readonly<GameState>,
  charaNum: number,
): string | undefined {
  if (charaNum === 0) return state.master.callName;
  return state.charas[charaNum]?.callName;
}

function namedStateReference(
  state: Readonly<GameState>,
  name: string,
): string | undefined {
  if (state.master.callName === name) return state.master.callName;
  for (const slot of Object.values(state.charas)) {
    if (slot?.callName === name) return slot.callName;
  }
  return undefined;
}

function resolvedReference(
  reference: KojoNameReference,
  options: KojoNameRenderOptions,
): string | undefined {
  const injected = options.nameResolver?.(reference);
  if (injected) return injected;
  if (typeof reference === "number") {
    return stateName(options.state, reference);
  }
  return namedStateReference(options.state, reference);
}

/** Resolve supported `%CALLNAME:*%` and `%MASTERNAME:N%` text tokens. */
export function substituteKojoCallNames(
  text: string,
  options: KojoNameRenderOptions,
): string {
  if (
    !text.includes("%CALLNAME:") &&
    !text.includes("MASTERNAME") &&
    !/%[A-Z0-9_]+\([^%\r\n]*\)%/i.test(text)
  ) {
    return text;
  }

  const masterName =
    options.masterName ||
    options.state.master.callName ||
    "主角";
  const targetName =
    options.targetName ??
    resolvedReference(options.charaNum, options) ??
    options.targetFallback ??
    "对方";

  let out = text.replace(CALLNAME_RE, (token, rawReference: string) => {
    const reference = rawReference.trim();
    if (reference === "MASTER" || reference === "PLAYER" || reference === "0") {
      return masterName;
    }
    if (reference === "TARGET" || reference === "CHARA") {
      return targetName;
    }

    const alias = options.aliases?.[reference];
    if (alias !== undefined) return alias;

    if (/^\d+$/.test(reference)) {
      const charaNum = Number(reference);
      return resolvedReference(charaNum, options) ??
        options.numericFallback?.(charaNum) ??
        `角色${charaNum}`;
    }

    const named = /^\[\[([^\]\r\n]+)\]\]$/.exec(reference);
    if (named) {
      // Named ERB references carry a readable canonical character name.
      // Prefer a live/catalog resolver when available, then use that authored
      // name rather than leaking the `[[...]]` syntax.
      return resolvedReference(named[1]!, options) ?? named[1]!;
    }

    return token;
  });

  out = out
    .replace(/%MASTERNAME:\d+%/g, masterName)
    .replace(/\[MASTERNAME:\d+\]/g, masterName);
  return substituteKojoCommonFormatters(out, options);
}

/** Resolve the browser-safe clothing formatter subset used by authored kojo. */
export function substituteKojoStateFormatters(
  text: string,
  options: KojoNameRenderOptions,
): string {
  const subjectFor = (rawSubject: string): number => rawSubject === "TARGET"
      ? options.charaNum
      : rawSubject === "MASTER" || rawSubject === "PLAYER"
        ? 0
        : Number(rawSubject);
  const common = substituteKojoCommonFormatters(text, options);
  // HIP runs before the clothing/pants passes so its prefix arm can emit
  // nested %SHOW_下半身内衣%/%PANTSNAME% tokens for them to expand.
  const hip = common.replace(HIP_FORMATTER_RE, (token, rawSubject: string, prefixFlag: string | undefined) => {
    const subject = subjectFor(rawSubject);
    const slot = subject === 0 ? options.state.master : options.state.charas[subject];
    if (!slot || !options.rng) return token;
    return hipDescription(slot, subject, prefixFlag !== "0", options.rng);
  });
  const clothing = hip.replace(CLOTHING_FORMATTER_RE, (token, formatter: string, rawSubject: string) => {
    const subject = subjectFor(rawSubject);
    const slot = subject === 0 ? options.state.master : options.state.charas[subject];
    if (!slot) return token;
    switch (formatter) {
      case "SHOW_BOTTOM": return showBottom(slot);
      case "SHOW_TOP": return showTop(slot);
      case "SHOW_下半身内衣": return showLowerUnderwear(slot, true);
      case "SHOW_上半身内衣": return showUpperUnderwear(slot);
      default: return token;
    }
  });
  const pants = clothing.replace(PANTSNAME_FORMATTER_RE, (token, rawSubject: string, descriptor: string | undefined) => {
    const subject = subjectFor(rawSubject);
    const slot = subject === 0 ? options.state.master : options.state.charas[subject];
    return slot ? (showLowerUnderwear(slot, descriptor === "1") || token) : token;
  });
  const anatomy = pants.replace(TINKO_FORMATTER_RE, (token, rawSubject: string) => {
    const subject = subjectFor(rawSubject);
    const slot = subject === 0 ? options.state.master : options.state.charas[subject];
    if (!slot) return token;
    // TINKO_TYPE.ERB always appends this terminal noun. Its following SIF
    // uses Emuera's operator precedence, so it does not replace the result.
    return "肉棒";
  });
  const slit = anatomy.replace(SLIT_FORMATTER_RE, "小穴");
  const breasts = slit.replace(OPPAI_FORMATTER_RE, (token, rawSubject: string) => {
    const subject = subjectFor(rawSubject);
    const slot = subject === 0 ? options.state.master : options.state.charas[subject];
    if (!slot) return token;
    // EVENT_MESSAGE.ERB's non-look terminal arms normalize ordinary breasts
    // to 乳房; randomized descriptive arms remain owned by source RNG routes.
    return (slot.state.TALENT[2] ?? 0) & 1 ? "乳房" : "胸膛";
  });
  const nipples = breasts.replace(NIPPLE_FORMATTER_RE, (token, rawSubject: string) => {
    const subject = subjectFor(rawSubject);
    const slot = subject === 0 ? options.state.master : options.state.charas[subject];
    if (!slot) return token;
    // NIPPLE_DESCRIPTION's source arms include 蓓蕾 as its plain female
    // descriptor. Male subjects retain a literal anatomical fallback.
    return (slot.state.TALENT[2] ?? 0) & 1 ? "蓓蕾" : "乳头";
  });
  const strings = nipples
    .replace(CSTR_TOKEN_RE, (token, rawSubject: string, rawKey: string) =>
      options.state.kojoStrings?.cstr?.[Number(rawSubject)]?.[Number(rawKey)] ?? token)
    .replace(NICKNAME_TOKEN_RE, (token, rawChara: string) =>
      options.state.kojoStrings?.nickname?.[Number(rawChara)] ?? token);
  return substituteKojoCommonFormatters(strings, options);
}

/** Render the source-verified random-text and caller-name formatter subset. */
export function renderKojoText(
  text: string,
  options: KojoTextRenderOptions,
): string {
  return substituteKojoCallNames(
    selectTextrAlternatives(text, options.rng),
    options,
  ).replace(/\[K17_CNAME\(\)\]/gi, options.masterName || options.state.master.callName || "主角");
}

/**
 * Minimal view of the kojo VM's real-string slot, used by
 * `substituteKojoStringLocals`. The full `KojoVmState` lives in
 * `static-router.ts`; defining a structural subset here keeps the
 * text-renderer importable without pulling the rest of the runtime
 * graph. A missing VM yields empty strings — which mirrors the VM-side
 * `executeKojoVm` behaviour where unresolved locals collapse to `""`.
 */
export interface KojoStringLocalsView {
  resolvedStringLocals?: readonly string[];
  resolvedNamedStringLocals?: Readonly<Record<string, string>>;
  namedLocals?: Readonly<Record<string, number>>;
}

/**
 * Resolve the four string-local placeholders against the kojo walk's
 * real-string mirror. Each `%LOCALS:N%` / `%LOCAL:N%` / `%RESULTS:N%` /
 * `%RESULT:N%` token becomes the value previously written by
 * `setVmStringLocal`. The function is a pure string transform; it
 * never inspects GameState or makes routing decisions. Unknown tokens
 * survive untouched so downstream substitution passes still see them.
 */
export function substituteKojoStringLocals(
  text: string,
  vm: KojoStringLocalsView | undefined,
): string {
  if (
    !text.includes("%LOCALS") &&
    !text.includes("%LOCAL") &&
    !text.includes("%RESULTS") &&
    !text.includes("%RESULT") &&
    !text.includes("PAGENUM") &&
    !text.includes("PAGECOUNT")
  ) {
    return text;
  }
  const read = (index: number) =>
    vm?.resolvedStringLocals?.[index] ?? "";
  const readNamed = (name: string) =>
    vm?.resolvedNamedStringLocals?.[name] ?? "";
  // Local-pattern regex matches both bare `%LOCAL%` and `%LOCAL:N%`.
  // We intentionally allow case-insensitive matching because the
  // upstream ERB is inconsistent (`%locals:1%` appears too).
  const localToken = /%LOCALS?(?::(\d+))?%/gi;
  const resultsToken = /%RESULTS?(?::(\d+))?%/gi;
  // Named locals (`#DIMS name`) use a different storage key; they are
  // emitted only by code-generated text and only via `vm.namedStringLocals`,
  // not via `%...%` tokens. Skip them here.
  void readNamed;
  let out = text.replace(localToken, (token, rawIndex: string | undefined) => {
    const index = rawIndex ? Number(rawIndex) : 0;
    const value = read(index);
    return value === "" ? token : value;
  });
  out = out.replace(resultsToken, (token, rawIndex: string | undefined) => {
    const index = rawIndex ? Number(rawIndex) : 0;
    const value = read(index);
    return value === "" ? token : value;
  });
  out = out.replace(/%(PAGENUM|PAGECOUNT)%|[\[{](PAGENUM|PAGECOUNT)[\]}]/gi,
    (token, percentName: string | undefined, wrappedName: string | undefined) => {
      const value = vm?.namedLocals?.[(percentName ?? wrappedName ?? "").toUpperCase()];
      return value === undefined ? token : String(value);
    });
  return out;
}
