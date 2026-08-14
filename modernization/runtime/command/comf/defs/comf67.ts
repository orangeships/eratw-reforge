/**
 * Phase 7 — `COMF67 対面座位` (face-to-face seated / lotus), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM67`
 * (`ERB/コマンド関連/COMF/COMF67 対面座位.ERB`).
 *
 * **Positions family sibling (体位系 60-71).** 67 differs from 60 in:
 *   - target SOURCE: 快Ｖ 350 (vs 60's 300), 情愛 350, 恭順 300,
 *     逸脱 100, 反感 400
 *   - master SOURCE: 快Ｃ 400 (same as 60)
 *   - 露出 absent (67 is face-to-face)
 *   - master DOWNBASE 体力 40/気力 50 (vs 60's 40/40)
 *   - target DOWNBASE 体力 50/気力 60 (same as 60)
 *   - EXP: 愛情経験 += 恋慕*2 (+7 if 処女+恋慕, vs 60's +5)
 *
 * **Faithful target-side core (ERB ELSE branch 64-83 + 98-118):**
 *   - master DOWNBASE 体力/気力 +40/+50 (ERB 41-42, always)
 *   - target DOWNBASE 体力 +50 / 気力 +60 (ERB 66-67)
 *   - master SOURCE 快Ｃ 400 (ERB 68) — via `buildMasterSources`
 *   - target SOURCE 快Ｖ 350, 情愛 350, 恭順 300, 逸脱 100, 反感 400
 *     (ERB 70-76) [ERB 71 `SOURCE:快Ｃ = 250` is a TYPO; corrected to
 *     zero — 67's facing position produces no 露出.]
 *   - 不潔 = Y*10+60 (ERB 79) — Y computed in display
 *   - EXP: master 挿入経験 +1, target Ｖ経験 +1, Ｖ性交経験 +1,
 *     愛情経験 += 恋慕*2 (+7 if 処女+恋慕) (ERB 98-116)
 *
 * **DEFERRED (documented):**
 *   - STAIN_膣内Ｐ挿入 / PAIN_CHECK_V / 特殊ソース処理 (ERB 81/86/93).
 *   - 不潔 = Y*10+60 — Y computed in CAN_COM67's display (deferred).
 *   - The `SOURCE:快Ｃ = 250` line on ERB 71 — clearly a typo for
 *     露出 (which is absent in 67's facing variant); left as zero,
 *     not affecting settlement.
 *   - Time-stop branch (FLAG:70) incl. 処女 苦痛 +1000/+250 (ERB 48-62).
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
 * `@COM_ABLE67` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ｖ経験<50 + 禁断的知識),
 * 処女+ASSIPLAY 従順/百合属性, 処女+PALAM:潤滑, TEQUIP:体位==5||2 (姿势状态),
 * CAN_STANDING_SEX/CAN_NORMAL_SEX 室内 location gate, NOITEM debug flag.
 */
const com67Check: ExecCheck = (ctx) => {
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

export const comf67Def: ComfDef = {
  commandNo: 67,
  label: "対面座位",

  canExecute: com67Check,
  hModeMenuCheck: com67Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 41-42: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 50 },

  buildSources: (): Record<number, number> => ({
    // ERB 70-76, normal branch (target-side).
    [SOURCE_ID.快Ｖ]: 350,
    [SOURCE_ID.情愛]: 350,
    [SOURCE_ID.恭順]: 300,
    [SOURCE_ID.逸脱]: 100,
    [SOURCE_ID.反感]: 400,
  }),

  // ERB 68: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // ERB 66-67: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 60;

    // EXP grants (ERB 98-116, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 99
    grant(c.t, EXP_ID.Ｖ経験, 1); //        ERB 98
    grant(c.t, EXP_ID.Ｖ性交経験, 1); //    ERB 111
    // ERB 112-116: 愛情経験 += 恋慕*2 (+7 if 処女+恋慕).
    const renbo = c.tTalent(TALENT_ID.恋慕);
    grant(c.t, EXP_ID.愛情経験, renbo * 2);
    if (c.tTalent(TALENT_ID.処女) && renbo) grant(c.t, EXP_ID.愛情経験, 7);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 対面座位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf67HandlerEntry: HandlerEntry = makeComfHandler(comf67Def);
