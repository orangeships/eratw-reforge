/**
 * Phase 7 — `COMF66 騎乗位アナル` (cowgirl anal / target on top), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM66`
 * (`ERB/コマンド関連/COMF/COMF66 騎乗位アナル.ERB`).
 *
 * **Positions family sibling (体位系 60-71, anal twin of 65).** 66 differs
 * from 65 in:
 *   - target SOURCE: 快Ａ 500 (replaces 快Ｖ 500), 苦痛 800 (vs 500),
 *     逸脱 700 (vs 600), 反感 900 (vs 800)
 *   - master SOURCE: 快Ｃ 400 (same as 65)
 *   - master DOWNBASE same (20/40); target DOWNBASE 90/50 (vs 80/50)
 *   - EXP: target Ａ経験 +1 (replaces Ｖ経験), Ａ性交経験 +1 (replaces
 *     Ｖ性交経験), 愛情経験 += 恋慕 (×1, not ×2)
 *
 * **Faithful target-side core (ERB ELSE branch 49-74 + 87-108):**
 *   - master DOWNBASE 体力 20 / 気力 40 (ERB 35-36, always)
 *   - target DOWNBASE 体力 +90 / 気力 +50 (ERB 51-52)
 *   - master SOURCE 快Ｃ 400 (ERB 53) — via `buildMasterSources`
 *   - target SOURCE 快Ａ 500, 情愛 250, 性行動 250, 達成 250, 苦痛 800,
 *     露出 120, 逸脱 700, 反感 900 (ERB 55-62)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +900 (ERB 71-72)
 *   - EXP: master 挿入経験 +1, target Ａ経験 +1, Ａ性交経験 +1,
 *     愛情経験 += 恋慕 (ERB 87-107)
 *
 * **DEFERRED (documented):**
 *   - STAIN_肛門Ｐ挿入 / PAIN_CHECK_A / 特殊ソース処理 (ERB 76/82/89).
 *   - Time-stop branch (FLAG:70) incl. 苦痛 400 (ERB 42-47).
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
 * `@COM_ABLE66` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ａ経験<50 + 禁断的知識),
 * A経験阈值 (EXP:2 < EXPLV:3, time-stop skip), 浣腸(21)/バルーン(22)/電極(23)
 * TEQUIP slots (未建模), ASSIPLAY+潤滑 従順/百合属性, 縄 gate's time-stop
 * relaxation (FLAG:70 && CFLAG:344==0 时跳过 — 建模为普通 block), TEQUIP:体位,
 * IS_STANDING_SEX 立位 location gate, NOITEM debug flag.
 */
const com66Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 毒人形 (TALENT:196 == 99) — 肛門が付いていないので不可.
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
  // 肛用振動棒挿入中は不可 (TEQUIP:14).
  if (readTequip(target, TEQUIP_ID.肛用振動棒)) {
    return block("肛门用振動棒使用中无法进行。");
  }
  // 後庭拉珠使用中は不可 (TEQUIP:15).
  if (readTequip(target, TEQUIP_ID.後庭拉珠)) {
    return block("后庭拉珠使用中无法进行。");
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

export const comf66Def: ComfDef = {
  commandNo: 66,
  label: "騎乗位アナル",

  canExecute: com66Check,
  hModeMenuCheck: com66Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 35-36: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 20, [BASE_ID.気力]: 40 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      // ERB 55-62, normal branch (target-side).
      [SOURCE_ID.快Ａ]: 500,
      [SOURCE_ID.情愛]: 250,
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.達成]: 250,
      [SOURCE_ID.苦痛]: 800,
      [SOURCE_ID.露出]: 120,
      [SOURCE_ID.逸脱]: 700,
      [SOURCE_ID.反感]: 900,
    };
    // ERB 71-72: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 900;
    }
    return sources;
  },

  // ERB 53: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // ERB 51-52: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 90;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // EXP grants (ERB 87-107, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 92
    grant(c.t, EXP_ID.Ａ経験, 1); //         ERB 88
    grant(c.t, EXP_ID.Ａ性交経験, 1); //     ERB 104
    // ERB 106-107: 愛情経験 += 恋慕.
    grant(c.t, EXP_ID.愛情経験, c.tTalent(TALENT_ID.恋慕));
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 騎乗位アナル；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf66HandlerEntry: HandlerEntry = makeComfHandler(comf66Def);
