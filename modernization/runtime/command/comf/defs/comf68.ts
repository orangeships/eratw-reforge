/**
 * Phase 7 — `COMF68 背面座位` (rear seated / reverse lotus), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM68`
 * (`ERB/コマンド関連/COMF/COMF68 背面座位.ERB`).
 *
 * **Positions family sibling (体位系 60-71, rear-twin of 67).** 68 differs
 * from 67 in:
 *   - target SOURCE: 快Ｂ 250 (added — rear position stimulates Ｂ), 露出
 *     200 (added — back faces), 恭順 absent, 逸脱 400 (vs 100), 反感 800
 *     (vs 400), 苦痛 400 (vs 500)
 *   - master SOURCE: 快Ｃ 400 (same as 67)
 *   - EXP: 愛情経験 += 恋慕*2 (+5 if 処女+恋慕, vs 67's +7)
 *
 * **Faithful target-side core (ERB ELSE branch 69-89 + 102-122):**
 *   - master DOWNBASE 体力/気力 +40/+50 (ERB 44-45, always)
 *   - target DOWNBASE 体力 +50 / 気力 +60 (ERB 71-72)
 *   - master SOURCE 快Ｃ 400 (ERB 73) — via `buildMasterSources`
 *   - target SOURCE 快Ｖ 350, 快Ｂ 250, 情愛 350, 苦痛 400, 露出 200,
 *     逸脱 400, 反感 800 (ERB 76-82)
 *   - 不潔 = Y*10+60 (ERB 85) — Y computed in display
 *   - EXP: master 挿入経験 +1, target Ｖ経験 +1, Ｖ性交経験 +1,
 *     愛情経験 += 恋慕*2 (+5 if 処女+恋慕) (ERB 102-121)
 *
 * **DEFERRED (documented):**
 *   - STAIN_膣内Ｐ挿入 / PAIN_CHECK_V / 特殊ソース処理 (ERB 87/92/98).
 *   - 不潔 = Y*10+60 — Y computed in display (deferred).
 *   - Time-stop branch (FLAG:70) incl. 処女 苦痛 +1000/+250 (ERB 51-66).
 *   - HETEROSEX 同性愛 EXP, 童貞喪失, ASSIPLAY, TCVAR action markers.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { ITEM_ID, hasItem } from "../../../state/items.js";
import { readTequip } from "../../../state/tequip.js";

const block = (message: string) =>
  ({ ok: false, reason: { kind: "precondition", message } }) as const;

/**
 * `@COM_ABLE68` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ｖ経験<50 + 禁断的知識),
 * 処女+ASSIPLAY 従順/百合属性, 処女+PALAM:潤滑, TEQUIP:体位==4||1 (姿势状态),
 * CAN_STANDING_SEX/CAN_NORMAL_SEX 室内 location gate, NOITEM debug flag.
 */
const com68Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 毒人形 (TALENT:196 == 99) — 性器が付いていないので不可.
  if ((target.state.TALENT[TALENT_ID.人形] ?? 0) === 99) {
    return block("对方的身体条件不符。");
  }
  // 目标必须女性: `!(TALENT:性別 & 1) → RETURN 0`.
  if (((target.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0) {
    return block("对方的身体条件不符。");
  }
  // 停止中は不可 (FLAG:70 == 1 && CFLAG:TARGET:344 == 0).
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) {
    return block("冻结的对象无法配合。");
  }
  // 调教者必须能插入: 男/扶她 (`TALENT:PLAYER:性別 & 2`) → BASE:PLAYER:勃起 >= 1000;
  // 非男/扶她 → 上游要求 ITEM:PBAND 穿戴式假陰茎 — PBAND 未建模, 女性主控暂不可用体位.
  const masterGender = ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0;
  if (masterGender & 2) {
    if ((ctx.state.master.state.BASE[BASE_ID.勃起] ?? 0) < 1000) {
      return block("自己还没有充分勃起。");
    }
  } else {
    return block("调教者需要能插入的条件。");
  }
  // 振動棒挿入中は不可 (TEQUIP:13).
  if (readTequip(target, TEQUIP_ID.振動棒)) {
    return block("振動棒使用中无法进行。");
  }
  // 下半身着衣 (TEQUIP:0 & 4).
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) & 4) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  // 浴室PLAY中は塑料地墊が無いとダメ (TEQUIP:31 && ITEM:20 == 0 && NOITEM == 0).
  if (
    readTequip(target, TEQUIP_ID.浴室PLAY) &&
    !hasItem(ctx.state, ITEM_ID.プレイマット)
  ) {
    return block("浴室PLAY中需要塑料地墊。");
  }
  // 睡眠姦中 (CFLAG:恶作剧 > 1).
  if ((target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) > 1) {
    return block("睡眠侵犯中无法进行。");
  }
  return { ok: true };
};

export const comf68Def: ComfDef = {
  commandNo: 68,
  label: "背面座位",

  canExecute: com68Check,
  hModeMenuCheck: com68Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 44-45: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 50 },
  targetDownbase: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 60 },

  buildSources: (): Record<number, number> => ({
    // ERB 76-82, normal branch (target-side).
    [SOURCE_ID.快Ｖ]: 350,
    [SOURCE_ID.快Ｂ]: 250,
    [SOURCE_ID.情愛]: 350,
    [SOURCE_ID.苦痛]: 400,
    [SOURCE_ID.露出]: 200,
    [SOURCE_ID.逸脱]: 400,
    [SOURCE_ID.反感]: 800,
  }),

  // ERB 73: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // EXP grants (ERB 102-121, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 103
    grant(c.t, EXP_ID.Ｖ経験, 1); //        ERB 102
    grant(c.t, EXP_ID.Ｖ性交経験, 1); //    ERB 115
    // ERB 116-121: 愛情経験 += 恋慕*2 (+5 if 処女+恋慕).
    const renbo = c.tTalent(TALENT_ID.恋慕);
    grant(c.t, EXP_ID.愛情経験, renbo * 2);
    if (c.tTalent(TALENT_ID.処女) && renbo) grant(c.t, EXP_ID.愛情経験, 5);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 背面座位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf68HandlerEntry: HandlerEntry = makeComfHandler(comf68Def);
