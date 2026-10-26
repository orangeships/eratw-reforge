/**
 * Phase 7 — `COMF60 正常位` (missionary), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM60`
 * (`ERB/コマンド関連/COMF/COMF60 正常位.ERB`).
 *
 * **Positions family exemplar (体位系 60-71).** Reading 60 shows the
 * intercourse positions are MORE entangled than the toys family: they
 * produce SOURCE for BOTH participants (`SOURCE:PLAYER:快Ｃ` + the target's
 * 快Ｖ/苦痛/…) and call into the STAIN / PAIN / 処女 / 特殊ソース
 * subsystems. The current factory + `applySourceCheck` settle the TARGET
 * only (which is what drives 好感度). So this exemplar ports the
 * target-side settlement faithfully and documents the rest — the same
 * "faithful core + documented defers" bar as the daily ports.
 *
 * **Faithful target-side core (ERB normal ELSE branch, 90-118 + 130-154):**
 *   - master DOWNBASE 体力/気力 +40 each (ERB 68-69, always)
 *   - target DOWNBASE 体力 +50 / 気力 +60 (ERB 92-93)
 *   - target SOURCE 快Ｖ 300, 情愛 150, 苦痛 500, 露出 50, 反感 300 (ERB 95-102)
 *   - master SOURCE 快Ｃ 400 (ERB 95) — now settled into master PALAM via
 *     `buildMasterSources` (B1b dual-participant settlement; was deferred).
 *   - EXP: master 挿入経験 +1 (ERB 130); target Ｖ経験 +1 (131),
 *     Ｖ性交経験 +1 (148), 愛情経験 += 恋慕*2 (150)
 *
 * **DEFERRED (documented):**
 *   - STAIN_膣内Ｐ挿入 / PAIN_CHECK_V / 特殊ソース処理 subsystems (ERB 117/120/125).
 *   - 不潔 = Y*10+60 (ERB 116) — Y is computed in the display function.
 *   - 正常位補正 (ERB 106-113: BEDROOM + TEQUIP:50 → 快Ｖ/TCVAR bonus).
 *   - standing-sex variant (`TFLAG:193` → 露出 50→300, ERB 100-101).
 *   - the time-stop branch (FLAG:70) incl. 処女 苦痛 +1000/+250 (ERB 74-88).
 *   - HETEROSEX 同性愛 EXP, 童貞喪失, ASSIPLAY, TCVAR action markers.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
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
 * `@COM_ABLE60` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ｖ経験<50 + 禁断的知識),
 * 処女+ASSIPLAY 従順/百合属性, TFLAG:192, 処女+PALAM:潤滑 (time-stop skip),
 * TEQUIP:体位==5 (姿势状态), NOITEM debug flag.
 */
const com60Check: ExecCheck = (ctx) => {
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
  return { ok: true };
};

export const comf60Def: ComfDef = {
  commandNo: 60,
  label: "正常位",

  canExecute: com60Check,
  hModeMenuCheck: com60Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 68-69: master's own BASE drain (always). Target drain is in body.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 40 },
  targetDownbase: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 60 },

  buildSources: (): Record<number, number> => ({
    // ERB 95-102, normal branch (target-side).
    [SOURCE_ID.快Ｖ]: 300,
    [SOURCE_ID.情愛]: 150,
    [SOURCE_ID.苦痛]: 500,
    [SOURCE_ID.露出]: 50,
    [SOURCE_ID.反感]: 300,
  }),

  // ERB 95: the master's own pleasure (B1b — now settled into master PALAM).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // EXP grants (ERB 130-150, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 130
    grant(c.t, EXP_ID.Ｖ経験, 1); //        ERB 131
    grant(c.t, EXP_ID.Ｖ性交経験, 1); //    ERB 148
    grant(c.t, EXP_ID.愛情経験, c.tTalent(TALENT_ID.恋慕) * 2); // ERB 150
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 正常位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf60HandlerEntry: HandlerEntry = makeComfHandler(comf60Def);
