/**
 * Phase 7 — `COMF65 騎乗位` (cowgirl / target on top), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM65`
 * (`ERB/コマンド関連/COMF/COMF65 騎乗位.ERB`).
 *
 * **Positions family sibling (体位系 60-71).** 65 differs from 60 in:
 *   - target is on top — SOURCE reflects the dominant posture
 *   - target SOURCE: 快Ｖ 500 (vs 60's 300), 情愛 250, 性行動 250,
 *     達成 250, 苦痛 500, 露出 120, 逸脱 600, 反感 800
 *   - master SOURCE: 快Ｃ 400 (same as 60)
 *   - master DOWNBASE 体力 20/気力 40 (vs 60's 40/40) — target does work
 *   - target DOWNBASE 体力 80/気力 50 (vs 60's 50/60)
 *   - EXP: target Ｖ経験, Ｖ性交経験, 愛情経験 += 恋慕*2 (+5 if 処女+恋慕)
 *   - 異常経験 +2 (or +3 if ASSIPLAY + 主人 has penis) on 処女 loss —
 *     DEFERRED (異常経験 tracked elsewhere)
 *
 * **Faithful target-side core (ERB ELSE branch 58-77 + 90-118):**
 *   - master DOWNBASE 体力 20 / 気力 40 (ERB 34-35, always)
 *   - target DOWNBASE 体力 +80 / 気力 +50 (ERB 60-61)
 *   - master SOURCE 快Ｃ 400 (ERB 62) — via `buildMasterSources`
 *   - target SOURCE 快Ｖ 500, 情愛 250, 性行動 250, 達成 250, 苦痛 500,
 *     露出 120, 逸脱 600, 反感 800 (ERB 64-71)
 *   - EXP: master 挿入経験 +1, target Ｖ経験 +1, Ｖ性交経験 +1,
 *     愛情経験 += 恋慕*2 (+5 if 処女+恋慕) (ERB 90-118)
 *
 * **DEFERRED (documented):**
 *   - STAIN_膣内Ｐ挿入 / PAIN_CHECK_V / 特殊ソース処理 (ERB 75/78/84).
 *   - 不潔 = Y*10+60 (ERB 74) — Y computed in display (deferred).
 *   - 異常経験 +2 / +3 on 処女 loss (ERB 99-106) — 異常経験 slot exists
 *     but the ASSIPLAY branch logic is deferred.
 *   - Time-stop branch (FLAG:70) incl. 処女 苦痛 +1000/+250 (ERB 41-56).
 *   - HETEROSEX 同性愛 EXP, 童貞喪失, ASSIPLAY, TCVAR action markers.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
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
 * `@COM_ABLE65` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ｖ経験<50 + 禁断的知識),
 * 処女+ASSIPLAY 従順/百合属性, 処女+PALAM:潤滑 (time-stop skip), 縄 gate's
 * time-stop relaxation (FLAG:70 && CFLAG:344==0 时跳过 — 建模为普通 block),
 * TEQUIP:体位, IS_STANDING_SEX 立位 location gate, NOITEM debug flag.
 */
const com65Check: ExecCheck = (ctx) => {
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
  // 调教者必须能插入: 男/扶她 (`TALENT:PLAYER:性別 & 2`) → BASE:PLAYER:勃起 >= 1000;
  // 非男/扶她 → 上游 `!(TALENT:PLAYER:2 & 2) → RETURN 0` (骑乘位无 PBAND 例外).
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
  // 縄使用中は不可 (TEQUIP:縄; upstream 在 time-stop 非跳过时).
  if (readTequip(target, TEQUIP_ID.縄)) {
    return block("绳索使用中无法进行。");
  }
  // 睡眠姦中 (CFLAG:恶作剧 > 1).
  if ((target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) > 1) {
    return block("睡眠侵犯中无法进行。");
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
  return { ok: true };
};

export const comf65Def: ComfDef = {
  commandNo: 65,
  label: "騎乗位",

  canExecute: com65Check,
  hModeMenuCheck: com65Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 34-35: master's own BASE drain (target does the work).
  downbase: { [BASE_ID.体力]: 20, [BASE_ID.気力]: 40 },

  buildSources: (): Record<number, number> => ({
    // ERB 64-71, normal branch (target-side).
    [SOURCE_ID.快Ｖ]: 500,
    [SOURCE_ID.情愛]: 250,
    [SOURCE_ID.性行動]: 250,
    [SOURCE_ID.達成]: 250,
    [SOURCE_ID.苦痛]: 500,
    [SOURCE_ID.露出]: 120,
    [SOURCE_ID.逸脱]: 600,
    [SOURCE_ID.反感]: 800,
  }),

  // ERB 62: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // ERB 60-61: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 80;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // EXP grants (ERB 90-118, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 90
    grant(c.t, EXP_ID.Ｖ経験, 1); //        ERB 91
    grant(c.t, EXP_ID.Ｖ性交経験, 1); //    ERB 112
    // ERB 113-117: 愛情経験 += 恋慕*2 (+5 if 処女+恋慕).
    const renbo = c.tTalent(TALENT_ID.恋慕);
    grant(c.t, EXP_ID.愛情経験, renbo * 2);
    if (c.tTalent(TALENT_ID.処女) && renbo) grant(c.t, EXP_ID.愛情経験, 5);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 騎乗位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf65HandlerEntry: HandlerEntry = makeComfHandler(comf65Def);
