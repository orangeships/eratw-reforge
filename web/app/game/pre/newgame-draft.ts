/**
 * #13 原版开场流程 — the new-game draft.
 *
 * The choices the opening wizard collects before `buildInitialState`
 * applies them. Faithful to the 原版 扮演模式 path of `@NEWGAME_MAKE`:
 *   - identity      `@NEWGAME_MAKE_INIT` (性別 / 体力 / 気力) + 称呼
 *   - 能力(ABL)     `@CUSTOM_TERMINAL` → `@CUSTOM_ABL` (the ANATA editor)
 *   - residence     `@SET_MAINHOME` (NEWGAME.ERB:56)
 *
 * **魔法版 is intentionally NOT built** (per user): the NARIKIRI branch
 * (`@NEWGAME_MAKE_NARIKIRI`, play AS an existing character + MAGIC_DLC) is
 * ignored — only the vanilla 扮演模式 (FLAG:游戏模式 = 0, ANATA) is modeled.
 *
 * Implemented slices: 称呼 + 性別 + 居住地, ANATA 能力 editor, 素质 editor,
 * 经验 editor, 基础细项, 口上启停, and NEWGAME_OPTION skeleton.
 * The gender labels are verbatim from 身体设定 (NEWGAME_MAKE.ERB:172-174).
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

/** `FLAG:游戏模式` — 0 扮演模式 (the only modeled path; 1 魔法版 is dropped). */
export type GameMode = 0;

/** 性別 (Talent.csv id 2) — 1 女性 / 2 男性 / 3 扶她 (NEWGAME_MAKE.ERB:19). */
export type Gender = 1 | 2 | 3;

/** Body-shape values offered by the upstream `@TINKO_DECIDE` menu. */
export type PenisShape = 1 | 2 | 3 | 4 | 5 | 6;

export const PENIS_SHAPE_OPTIONS: readonly { value: PenisShape; label: string }[] = [
  { value: 1, label: "未成熟" },
  { value: 2, label: "短小" },
  { value: 3, label: "普通" },
  { value: 4, label: "发光" },
  { value: 5, label: "带疣" },
  { value: 6, label: "粗大" },
];

export function hasPenis(gender: Gender): boolean {
  return (gender & 2) !== 0;
}

export function penisShapeLabel(shape: PenisShape | undefined): string {
  return PENIS_SHAPE_OPTIONS.find((option) => option.value === shape)?.label ?? "普通";
}

export interface NewGameDraft {
  mode: GameMode;
  /** `CALLNAME:MASTER` — how the world addresses the protagonist. */
  callName: string;
  gender: Gender;
  /** Shape selection for a body with a male organ. */
  penisShape?: PenisShape;
  /** ANATA 能力(ABL) levels keyed by Abl.csv id, each 0..2 (`@CUSTOM_ABL`
   *  non-debug `MAX_ABL = 2`). A missing id reads as the seeded default. */
  abl: Record<number, number>;
  /** ANATA 素质(性格档位) keyed by Talent.csv id (`@CUSTOM_TALENT`, slice 3a:
   *  leveled disposition 素质). A missing id reads as the seeded default. */
  talent: Record<number, number>;
  /** ANATA 经验 keyed by Exp.csv id (`@CUSTOM_EXP`, slice 4, 非 debug
   *  MAX=30, presets 0/1/5/10/20/30). A missing id reads as 0. */
  exp: Record<number, number>;
  /** ANATA 基础 — 体力/気力 MAXBASE (`@CUSTOM_BASE`, slice 4, clamp
   *  1000..2500, step 100, default 2000). Undefined = seed default. */
  maxHp?: number;
  maxMp?: number;
  /** Kojo packs disabled in the opening selection step, keyed by charaNum. */
  disabledKojo: Record<number, true>;
  /** Selected kojo variant per character. Missing = bundled default variant. */
  selectedKojoVariants?: Record<number, string>;
  /** `FLAG:甲斐性無` opening toggle. Undefined/false = has courage. */
  noGuts?: boolean;
  /** `自宅位置` (`@SET_MAINHOME`) — a room string inside the home region. */
  homeLocation: string;
}

/** NEWGAME_MAKE_INIT defaults: 男 (性別=2); 体力/気力 = 2000 (modeled elsewhere). */
export const DEFAULT_DRAFT: NewGameDraft = {
  mode: 0,
  callName: "主人公",
  gender: 2,
  penisShape: 3,
  abl: {},
  talent: {},
  exp: {},
  disabledKojo: {},
  selectedKojoVariants: {},
  noGuts: false,
  homeLocation: "神社:倉庫",
};

export interface GenderOption {
  gender: Gender;
  label: string;
}

/** 身体设定 prompt (NEWGAME_MAKE.ERB:172-174, verbatim). */
export const GENDER_OPTIONS: GenderOption[] = [
  { gender: 1, label: "女人" },
  { gender: 2, label: "男人" },
  { gender: 3, label: "扶他" },
];

/** ANATA-editable ability cap (`@CUSTOM_ABL` non-debug `MAX_ABL = 2`). */
export const ANATA_ABL_MAX = 2;

export interface AnataAbl {
  id: number;
  name: string;
  /** Gender gate (`@CUSTOM_選べない能力`): 百合 needs a female body (性別 & 1),
   *  断袖 needs a non-female body. `undefined` = always selectable. */
  requires?: "female" | "nonFemale";
}

/**
 * The abilities the ANATA editor exposes — faithful to `@CUSTOM_ABL_MENU` +
 * `@CUSTOM_選べない能力` (NEWGAME_CUSTOM.ERB:459-582) in NON-debug mode:
 * ids 0-18 only (中毒 30-39 / 生活 40-49 / 性技 50-59 + TSLv excluded), with
 * 百合(17)/断袖(18) gender-gated. Names are transcribed from `CSV/Abl.csv`.
 */
export const ANATA_ABL: AnataAbl[] = [
  { id: 0, name: "Ｃ感覚" },
  { id: 1, name: "Ｖ感覚" },
  { id: 2, name: "Ａ感覚" },
  { id: 3, name: "Ｂ感覚" },
  { id: 4, name: "Ｍ感覚" },
  { id: 9, name: "親密" },
  { id: 10, name: "従順" },
  { id: 11, name: "欲望" },
  { id: 12, name: "技巧" },
  { id: 13, name: "奉仕精神" },
  { id: 14, name: "露出癖" },
  { id: 15, name: "受虐属性" },
  { id: 16, name: "施虐属性" },
  { id: 17, name: "百合属性", requires: "female" },
  { id: 18, name: "断袖属性", requires: "nonFemale" },
];

/** Whether an ANATA ability is selectable for the chosen gender. */
export function anataAblSelectable(abl: AnataAbl, gender: Gender): boolean {
  const female = (gender & 1) === 1; // 性別 & 1 (女 or 扶她)
  if (abl.requires === "female") return female;
  if (abl.requires === "nonFemale") return !female;
  return true;
}

export interface ResidenceOption {
  value: string;
  label: string;
  blurb: string;
  /** Region (map) this 私室 belongs to. The player picks a region, then a room
   *  inside it — faithful to `@SET_MAINHOME` (region → 私室候補). */
  mapName: string;
  roomCode: number;
  roomName: string;
  /** The 家主 (landlord) whose room this is. "—" for the protagonist's own
   *  default room (no landlord). */
  ownerName: string;
  /** charaNum of the 家主 (0 = no landlord / default room). The move gate after
   *  day 1 reads this character's 信頼度 vs `requiredTrust`. */
  ownerChara: number;
  /** `居住必要信赖度` — ignored on day 1 (first-day free pick), enforced by 搬家
   *  afterwards. */
  requiredTrust: number;
  currentTrust: number;
  ascii: string;
}

/**
 * `@SET_MAINHOME` 私室候補 for the 11 player-selectable main maps.
 *
 * Faithful to the upstream mechanism (`ERB/魔改内容/qol/qol_MAP.ERB`
 * `@QOL_SET_MAINHOME` / `@QOL_SET_HIKKOSHI_ROOM` + `Chara{N}.csv フラグ,大家候補`):
 * 每个地图选 1 个默认行 (`默认初期位置` = `@DEFAULT_OWNER_{N}`), 然后每图
 * 枚举 chara 1..CHARANUM 中 `神社在住 == 1 && 大家候補 != 0 && GET_MAPID(大家候補)
 * == MAIN_MAP` 的角色, 每行一个候选, `居住必要信赖度 > 信赖度 && DAY > 1` 时
 * 上游 UI 灰条 (现代 runtime 用 `MoveHomePanel` 同款 trust gate).
 *
 * Day 1 旁路上游 `"第一天限定选项：无视必要信赖选择住的地点。"` (qol_MAP.ERB:873)
 * — modern runtime 在 newgame wizard 阶段总是 day 0, 不需显式 bypass.
 *
 * **chara 102 (神绮) 的大家候補** 跳过 — chara 102 不在 `charas.bundle.json` 中,
 * 没有 callName 可显示. 完整补齐需先扩 charas bundle (下一批再做).
 *
 * 全部 39 条目都是真实场景房间 (scenes.bundle.json 中存在的 P_ID).
 * 来源: `UNIMPLEMENTED-MAP.md` 勘察 + 上游 `ROOMSETTING_*.ERB` + `UPDATE_MAIN.ERB:431-432`.
 */
export const RESIDENCE_OPTIONS: ResidenceOption[] = [
  // ── Map 0 — 博麗神社 ──
  {
    value: "神社:倉庫",
    label: "博丽神社 · 自室",
    blurb: "栖身于神社一隅，清晨在巫女的脚步声里醒来。",
    mapName: "博麗神社",
    roomCode: 9,
    roomName: "自室（神社内部 · 默认）",
    ownerName: "—",
    ownerChara: 0,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　◇ 鳥居 ─ 参道 ─ 境内 ◇",
      "　　　　　│",
      "　　　本堂 ─ 自室",
      "　　　　　│",
      "　　　　庭・手水舎",
    ].join("\n"),
  },
  {
    value: "神社:三妖精之家・地下室",
    label: "博丽神社 · 三妖精之家",
    blurb: "借住进三妖精的家中，地下室虽小，却也算个安身之所。",
    mapName: "博麗神社",
    roomCode: 35,
    roomName: "三妖精之家・地下室",
    ownerName: "桑尼米尔克",
    ownerChara: 5,
    requiredTrust: 50,
    currentTrust: 0,
    ascii: [
      "　　境内 ─ 鎮守之森",
      "　　　　　│",
      "　　三妖精之家",
      "　　　└ 地下室",
    ].join("\n"),
  },
  {
    value: "神社:夢幻遺跡・倉庫",
    label: "博丽神社 · 夢幻遺跡",
    blurb: "在沉睡的梦幻遗迹一隅落脚，仓库的旧物间满是异世的气息。",
    mapName: "博麗神社",
    roomCode: 51,
    roomName: "夢幻遺跡・倉庫",
    ownerName: "梦美",
    ownerChara: 9,
    requiredTrust: 100,
    currentTrust: 0,
    ascii: [
      "　　夢幻遺跡前",
      "　　　│",
      "　一階通路 ─ 倉庫",
      "　　　│",
      "　研究室・艦橋",
    ].join("\n"),
  },
  // ── Map 1 — 命蓮寺 ──
  {
    value: "命蓮寺:別屋",
    label: "命莲寺 · 別屋",
    blurb: "在白莲的别院借住一隅，木鱼与梵钟常伴晨昏。",
    mapName: "命蓮寺",
    roomCode: 119,
    roomName: "別屋（命蓮寺内部 · 默认 = 白莲）",
    ownerName: "白莲",
    ownerChara: 55,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　山門 ─ 参道 ─ 本堂",
      "　　　　　│",
      "　　別屋 ─ 庫房",
    ].join("\n"),
  },
  {
    value: "霊廟:神子私室",
    label: "命莲寺 · 灵庙神子私室",
    blurb: "在灵庙深处的私室落脚，神子的气息让空气沉静几分。",
    mapName: "命蓮寺",
    roomCode: 134,
    roomName: "神子私室（灵庙内部）",
    ownerName: "神子",
    ownerChara: 56,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　本堂 ─ 庫房",
      "　　　　　│",
      "　　灵庙 ─ 神子私室",
    ].join("\n"),
  },
  // ── Map 2 — 人間の里 ──
  {
    value: "人間之里:空的部屋",
    label: "人間の里 · 空的部屋",
    blurb: "在人里租下一间空屋，烟火与商铺都近在咫尺。",
    mapName: "人間の里",
    roomCode: 230,
    roomName: "空的部屋（人里内部 · 默认）",
    ownerName: "—",
    ownerChara: 0,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　寺子屋　　　　鈴奈庵",
      "　　　＼　　　／",
      "　広場 ─ 大街 ─ 長屋街",
      "　　　／　　　＼",
      "　空的部屋　　大衆浴場",
    ].join("\n"),
  },
  // ── Map 3 — 霧之湖〜紅魔館 ──
  {
    value: "紅魔館:空的小屋",
    label: "红魔馆 · 空的小屋",
    blurb: "在湖畔空屋借住，洋馆的方向每天飘来红茶香气。",
    mapName: "霧之湖〜紅魔館",
    roomCode: 304,
    roomName: "空的小屋（红魔馆周边 · 默认 = 蕾米）",
    ownerName: "蕾米",
    ownerChara: 16,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　霧之湖 ─ 湖畔小道",
      "　　　　　│",
      "　　空的小屋 ─ 紅魔館",
    ].join("\n"),
  },
  // ── Map 4 — 迷途竹林 ──
  {
    value: "迷途竹林:空的小屋",
    label: "迷途竹林 · 空的小屋",
    blurb: "在竹林深处借住小竹屋，兔子们的脚印是唯一的问候。",
    mapName: "迷途竹林",
    roomCode: 442,
    roomName: "空的小屋（迷途竹林 · 默认）",
    ownerName: "—",
    ownerChara: 0,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　竹林入口 ─ 小径",
      "　　　　　│",
      "　　空的小屋 ─ 永远亭方向",
    ].join("\n"),
  },
  {
    value: "永遠亭:輝夜私室",
    label: "迷途竹林 · 永远亭 辉夜私室",
    blurb: "在永远亭深处借住，千年的月光穿过纸窗。",
    mapName: "迷途竹林",
    roomCode: 412,
    roomName: "辉夜私室（永远亭内部）",
    ownerName: "辉夜",
    ownerChara: 62,
    requiredTrust: 100,
    currentTrust: 0,
    ascii: [
      "　　永远亭 ─ 中庭",
      "　　　　　│",
      "　　辉夜私室 ─ 私室",
    ].join("\n"),
  },
  {
    value: "永遠亭:永琳私室",
    label: "迷途竹林 · 永远亭 永琳私室",
    blurb: "在永远亭的医务室角落借住，药香常伴枕边。",
    mapName: "迷途竹林",
    roomCode: 413,
    roomName: "永琳私室（永远亭内部）",
    ownerName: "永琳",
    ownerChara: 72,
    requiredTrust: 100,
    currentTrust: 0,
    ascii: [
      "　　永远亭 ─ 走廊",
      "　　　　　│",
      "　　永琳私室 ─ 药房",
    ].join("\n"),
  },
  {
    value: "夢幻館:幽香私室",
    label: "迷途竹林 · 梦幻馆 幽香私室",
    blurb: "在梦幻馆的花海中借住，牡丹的香气浸透了空气。",
    mapName: "迷途竹林",
    roomCode: 463,
    roomName: "幽香私室（梦幻馆内部）",
    ownerName: "幽香",
    ownerChara: 68,
    requiredTrust: 100,
    currentTrust: 0,
    ascii: [
      "　　梦幻館 ─ 庭院",
      "　　　　　│",
      "　　幽香私室 ─ 花房",
    ].join("\n"),
  },
  // ── Map 5 — 魔法之森 ──
  {
    value: "魔理沙宅:魔理沙宅・倉庫",
    label: "魔法之森 · 魔理沙宅",
    blurb: "在魔理沙家仓库的角落借住，灰尘与星尘同在。",
    mapName: "魔法之森",
    roomCode: 515,
    roomName: "魔理沙宅・倉庫（默认）",
    ownerName: "魔理沙",
    ownerChara: 71,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　魔法之森 ─ 小径",
      "　　　　　│",
      "　　魔理沙宅 ─ 倉庫",
    ].join("\n"),
  },
  {
    value: "人偶的洋馆:人偶洋館・愛麗絲的房間",
    label: "魔法之森 · 人偶洋馆 爱丽丝的房間",
    blurb: "在上海人偶的洋馆借住，人偶们在走廊静静走过。",
    mapName: "魔法之森",
    roomCode: 521,
    roomName: "爱丽丝的房间（人偶洋馆内部）",
    ownerName: "爱丽丝",
    ownerChara: 17,
    requiredTrust: 300,
    currentTrust: 0,
    ascii: [
      "　　洋館正門 ─ 走廊",
      "　　　　　│",
      "　　爱丽丝房間 ─ 工房",
    ].join("\n"),
  },
  {
    value: "轻飘飘艾伦的店:艾伦宅・倉庫",
    label: "魔法之森 · 艾伦宅",
    blurb: "借住在轻飘飘艾仑的店仓库，浮在空中的家具微微摇晃。",
    mapName: "魔法之森",
    roomCode: 536,
    roomName: "艾伦宅・倉庫（艾仑店）",
    ownerName: "艾伦",
    ownerChara: 44,
    requiredTrust: 100,
    currentTrust: 0,
    ascii: [
      "　　艾仑店 ─ 看板",
      "　　　　　│",
      "　　艾伦宅・倉庫",
    ].join("\n"),
  },
  // ── Map 6 — 冥界 ──
  {
    value: "白玉楼:空室",
    label: "冥界 · 白玉楼 空室",
    blurb: "在幽幽子的白玉楼借住，亡者的优雅与樱花一同盛开。",
    mapName: "冥界",
    roomCode: 625,
    roomName: "空室（白玉楼 · 默认 = 幽幽子）",
    ownerName: "幽幽子",
    ownerChara: 66,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　冥界入口 ─ 桜花道",
      "　　　　　│",
      "　　白玉楼 ─ 空室",
    ].join("\n"),
  },
  {
    value: "八云邸:空部屋",
    label: "冥界 · 八云邸 空部屋",
    blurb: "在紫的八云邸借住，隙间偶尔在墙角闪烁。",
    mapName: "冥界",
    roomCode: 634,
    roomName: "空部屋（八云邸 · 默认）",
    ownerName: "紫",
    ownerChara: 26,
    requiredTrust: 300,
    currentTrust: 0,
    ascii: [
      "　　冥界 ─ 桜花道",
      "　　　　　│",
      "　　八云邸 ─ 空部屋",
    ].join("\n"),
  },
  {
    value: "是非曲直厅:空的部屋",
    label: "冥界 · 是非曲直厅 空的部屋",
    blurb: "在映姬的是非曲直厅借住，阎魔的威压让空气都沉了几分。",
    mapName: "冥界",
    roomCode: 618,
    roomName: "空的部屋（是非曲直厅 · 默认）",
    ownerName: "映姬",
    ownerChara: 30,
    requiredTrust: 300,
    currentTrust: 0,
    ascii: [
      "　　彼岸 ─ 小町的房間",
      "　　　　　│",
      "　　是非曲直厅 ─ 空的部屋",
    ].join("\n"),
  },
  // ── Map 7 — 妖怪之山(山麓) ──
  {
    value: "妖怪之山・山麓:小屋",
    label: "妖怪之山(山麓) · 小屋",
    blurb: "在山麓的小屋借住，仙人的宅邸就在不远。",
    mapName: "妖怪之山(山麓)",
    roomCode: 734,
    roomName: "小屋（妖怪之山・山麓 · 默认）",
    ownerName: "—",
    ownerChara: 0,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　山麓入口 ─ 小径",
      "　　　　　│",
      "　　小屋 ─ 仙人宅邸方向",
    ].join("\n"),
  },
  {
    value: "仙人の宅邸 2-3F:仙人の宅邸・空的部屋",
    label: "妖怪之山(山麓) · 仙人宅邸",
    blurb: "借住在仙人宅邸的空屋，华扇的教养让四周井井有条。",
    mapName: "妖怪之山(山麓)",
    roomCode: 728,
    roomName: "空的部屋（仙人宅邸 2-3F）",
    ownerName: "华扇",
    ownerChara: 43,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　山麓 ─ 索道",
      "　　　　　│",
      "　　仙人宅邸 ─ 空的部屋",
    ].join("\n"),
  },
  {
    value: "秋姊妹的家:秋姉妹的家・座敷",
    label: "妖怪之山(山麓) · 秋姐妹的家",
    blurb: "借住在秋姐妹的家中，姐妹的和睦让山间都温暖。",
    mapName: "妖怪之山(山麓)",
    roomCode: 719,
    roomName: "座敷（秋姐妹的家 · 静叶）",
    ownerName: "静叶",
    ownerChara: 77,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　山麓 ─ 落叶道",
      "　　　　　│",
      "　　秋姐妹的家 ─ 座敷",
    ].join("\n"),
  },
  {
    value: "秋姉妹的家:秋姉妹的家・座敷(穣子)",
    label: "妖怪之山(山麓) · 秋姐妹的家(穣子)",
    blurb: "在秋姐妹家中另一间房借住，与穣子的红叶同住。",
    mapName: "妖怪之山(山麓)",
    roomCode: 719,
    roomName: "座敷（秋姐妹的家 · 穣子）",
    ownerName: "穣子",
    ownerChara: 78,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　山麓 ─ 落叶道",
      "　　　　　│",
      "　　秋姐妹的家 ─ 座敷",
    ].join("\n"),
  },
  {
    value: "浅间净秽山:空房间(P754)",
    label: "妖怪之山(山麓) · 浅间净秽山",
    blurb: "在浅间净秽山的空房间借住，仙道的气息弥漫在山间。",
    mapName: "妖怪之山(山麓)",
    roomCode: 754,
    roomName: "空房间（浅间净秽山 · 浅间）",
    ownerName: "维缦",
    ownerChara: 164,
    requiredTrust: 300,
    currentTrust: 0,
    ascii: [
      "　　山麓 ─ 小道",
      "　　　　　│",
      "　　浅间净秽山 ─ 空房间",
    ].join("\n"),
  },
  {
    value: "浅间净秽山:空房间(P754,阿梨夜)",
    label: "妖怪之山(山麓) · 浅间净秽山(阿梨夜)",
    blurb: "另一间浅间净秽山的空房，与阿梨夜的蛇纹同住。",
    mapName: "妖怪之山(山麓)",
    roomCode: 754,
    roomName: "空房间（浅间净秽山 · 阿梨夜）",
    ownerName: "阿梨夜",
    ownerChara: 165,
    requiredTrust: 300,
    currentTrust: 0,
    ascii: [
      "　　山麓 ─ 小道",
      "　　　　　│",
      "　　浅间净秽山 ─ 空房间",
    ].join("\n"),
  },
  // ── Map 8 — 妖怪之山(山頂) ──
  {
    value: "妖怪之山・山顶:山小屋",
    label: "妖怪之山(山頂) · 山小屋",
    blurb: "在山顶的小屋借住，云海就在窗外翻涌。",
    mapName: "妖怪之山(山頂)",
    roomCode: 810,
    roomName: "山小屋（妖怪之山・山顶 · 默认）",
    ownerName: "—",
    ownerChara: 0,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　索道 ─ 山顶",
      "　　　　　│",
      "　　山小屋 ─ 守矢神社方向",
    ].join("\n"),
  },
  {
    value: "守矢神社:空室",
    label: "妖怪之山(山頂) · 守矢神社",
    blurb: "在守矢神社借住，神签的灵气与山风同在。",
    mapName: "妖怪之山(山頂)",
    roomCode: 823,
    roomName: "空室（守矢神社 · 神奈子）",
    ownerName: "神奈子",
    ownerChara: 32,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　山顶 ─ 参道",
      "　　　　　│",
      "　　守矢神社 ─ 空室",
    ].join("\n"),
  },
  {
    value: "守矢神社:空室(诹訪子)",
    label: "妖怪之山(山頂) · 守矢神社(诹访子)",
    blurb: "在守矢神社另一间空室，与诹访子的土偶同住。",
    mapName: "妖怪之山(山頂)",
    roomCode: 823,
    roomName: "空室（守矢神社 · 诹访子）",
    ownerName: "诹访子",
    ownerChara: 33,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　山顶 ─ 参道",
      "　　　　　│",
      "　　守矢神社 ─ 空室",
    ].join("\n"),
  },
  {
    value: "比那名居邸:比那名居邸庫房",
    label: "妖怪之山(山頂) · 比那名居邸",
    blurb: "在天子的比那名居邸库房借住，地上散落着牛骨碎片。",
    mapName: "妖怪之山(山頂)",
    roomCode: 842,
    roomName: "库房（比那名居邸）",
    ownerName: "天子",
    ownerChara: 34,
    requiredTrust: 100,
    currentTrust: 0,
    ascii: [
      "　　山顶 ─ 小道",
      "　　　　　│",
      "　　比那名居邸 ─ 库房",
    ].join("\n"),
  },
  {
    value: "饭纲丸邸:龙宅客卧(P869)",
    label: "妖怪之山(山頂) · 饭纲丸邸",
    blurb: "在饭纲丸的龙宅客卧借住，鳞光在床帐间隐隐闪烁。",
    mapName: "妖怪之山(山頂)",
    roomCode: 869,
    roomName: "龙宅客卧（饭纲丸邸）",
    ownerName: "龙",
    ownerChara: 140,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　山顶 ─ 山道",
      "　　　　　│",
      "　　饭纲丸邸 ─ 龙宅客卧",
    ].join("\n"),
  },
  // ── Map 9 — 地底 ──
  {
    value: "旧都:茅屋",
    label: "地底 · 旧都茅屋",
    blurb: "在旧都的茅屋借住，地底的光线幽暗却安心。",
    mapName: "地底",
    roomCode: 943,
    roomName: "茅屋（旧都 · 默认）",
    ownerName: "—",
    ownerChara: 0,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　地底入口 ─ 旧地狱",
      "　　　　　│",
      "　　旧都 ─ 茅屋",
    ].join("\n"),
  },
  {
    value: "地灵殿:庫房",
    label: "地底 · 地灵殿 库房",
    blurb: "在地灵殿的库房借住，觉与宠物们的气息环绕。",
    mapName: "地底",
    roomCode: 916,
    roomName: "库房（地灵殿）",
    ownerName: "觉",
    ownerChara: 49,
    requiredTrust: 300,
    currentTrust: 0,
    ascii: [
      "　　地底 ─ 通道",
      "　　　　　│",
      "　　地灵殿 ─ 库房",
    ].join("\n"),
  },
  // ── Map 10 — 月 ──
  {
    value: "月之世界:闲置的房子",
    label: "月 · 闲置的房子",
    blurb: "在月之世界的闲置房借住，地上铺满桂花的清香。",
    mapName: "月",
    roomCode: 1007,
    roomName: "闲置的房子（月之世界 · 默认）",
    ownerName: "—",
    ownerChara: 0,
    requiredTrust: 0,
    currentTrust: 0,
    ascii: [
      "　　月の都 ─ 街道",
      "　　　　　│",
      "　　闲置的房子 ─ 月海方向",
    ].join("\n"),
  },
  {
    value: "绵月亭:綿月亭・空的部屋",
    label: "月 · 绵月亭",
    blurb: "在绵月亭的空房借住，竹取的气息与月光的清冷同在。",
    mapName: "月",
    roomCode: 1033,
    roomName: "空的部屋（绵月亭 · 丰姬）",
    ownerName: "丰姬",
    ownerChara: 99,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　月之世界 ─ 街道",
      "　　　　　│",
      "　　绵月亭 ─ 空的部屋",
    ].join("\n"),
  },
  {
    value: "哆来咪宅:哆来咪宅・倉庫",
    label: "月 · 哆来咪宅",
    blurb: "在哆来咪的仓库借住，七曜的徽记在箱子上闪烁。",
    mapName: "月",
    roomCode: 1052,
    roomName: "仓库（哆来咪宅）",
    ownerName: "哆来咪",
    ownerChara: 109,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　月之世界 ─ 小径",
      "　　　　　│",
      "　　哆来咪宅 ─ 仓库",
    ].join("\n"),
  },
  {
    value: "纯狐邸:純狐邸・空的部屋",
    label: "月 · 纯狐邸",
    blurb: "在纯狐邸的空房借住，纯狐的怨念让空气凝重。",
    mapName: "月",
    roomCode: 1063,
    roomName: "空的部屋（纯狐邸）",
    ownerName: "纯狐",
    ownerChara: 112,
    requiredTrust: 200,
    currentTrust: 0,
    ascii: [
      "　　月之世界 ─ 街道",
      "　　　　　│",
      "　　纯狐邸 ─ 空的部屋",
    ].join("\n"),
  },
  // ── END ──
];
