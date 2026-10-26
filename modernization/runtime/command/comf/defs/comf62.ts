/**
 * Phase 7 — `COMF62 正常位アナル` (missionary anal), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM62`
 * (`ERB/コマンド関連/COMF/COMF62 正常位アナル.ERB`).
 *
 * **Positions family sibling (体位系 60-71, anal twin of 60).** 62 differs
 * from 60 in:
 *   - target SOURCE: 快Ａ 400 (replaces 快Ｖ 300) + 情愛 100, 苦痛 800,
 *     露出 60, 逸脱 200, 反感 500
 *   - master SOURCE: 快Ｃ 400 (same as 60)
 *   - master DOWNBASE same (40/40); target DOWNBASE 80/80 (vs 50/60)
 *   - 性技補正: LOCAL = 1 + (ABL:PLAYER:腰 - 2) / 10 → × on 快Ａ + 情愛
 *     (ERB 80-82) — DEFERRED (腰 ABL not modeled)
 *   - EXP: target Ａ経験 +1 (replaces Ｖ経験), Ａ性交経験 +1, 愛情経験
 *     += 恋慕 (×1, not ×2)
 *
 * **Faithful target-side core (ERB ELSE branch 61-89 + 103-126):**
 *   - master DOWNBASE 体力/気力 +40 each (ERB 48-49, always)
 *   - target DOWNBASE 体力 +80 / 気力 +80 (ERB 63-64)
 *   - master SOURCE 快Ｃ 400 (ERB 66) — via `buildMasterSources`
 *   - target SOURCE 快Ａ 400, 情愛 100, 苦痛 800, 露出 60, 逸脱 200,
 *     反感 500 (ERB 66-74)
 *   - 露出 60→300 when standing (TFLAG:193 arm, ERB 71-72) — outcomeMul
 *   - 自己愛<0 / 抵抗 → 鬱屈 +500 (ERB 87-88)
 *   - EXP: master 挿入経験 +1, target Ａ経験 +1, Ａ性交経験 +1,
 *     愛情経験 += 恋慕 (ERB 103-124)
 *
 * **DEFERRED (documented):**
 *   - STAIN_肛門Ｐ挿入 / PAIN_CHECK_A / 特殊ソース処理 (ERB 91/98/106).
 *   - 性技補正 (LOCAL = 1 + (ABL:PLAYER:腰 - 2) / 10, ERB 80-82) — 腰
 *     ABL is not modeled.
 *   - 露出 60→300 standing-sex arm (TFLAG:193) — captured as outcomeMul.
 *   - Time-stop branch (FLAG:70) incl. 苦痛 400 (ERB 55-59).
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
 * `@COM_ABLE62` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ａ経験<50 + 禁断的知識),
 * A経験阈值 (EXP:2 < EXPLV:3, time-stop skip), 浣腸(21)/バルーン(22)/電極(23)
 * TEQUIP slots (未建模), ASSIPLAY+潤滑 従順/百合属性, 処女+PALAM:潤滑 (time-stop
 * skip), TEQUIP:体位==5 (姿势状态), NOITEM debug flag.
 */
const com62Check: ExecCheck = (ctx) => {
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
  // 非男/扶她 → 上游要求 ITEM:PBAND 穿戴式假陰茎 — PBAND 未建模, 女性主控暂不可用体位.
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

export const comf62Def: ComfDef = {
  commandNo: 62,
  label: "正常位アナル",

  canExecute: com62Check,
  hModeMenuCheck: com62Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 48-49: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 40 },
  targetDownbase: { [BASE_ID.体力]: 80, [BASE_ID.気力]: 80 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      // ERB 66-74, normal branch (target-side).
      [SOURCE_ID.快Ａ]: 400,
      [SOURCE_ID.情愛]: 100,
      [SOURCE_ID.苦痛]: 800,
      [SOURCE_ID.露出]: 60,
      [SOURCE_ID.逸脱]: 200,
      [SOURCE_ID.反感]: 500,
    };
    // ERB 87-88: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 500;
    }
    return sources;
  },

  // ERB 66: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  // Standing-sex arm: 露出 60→300 (TFLAG:193).
  outcomeMul: {
    [SOURCE_ID.露出]: { great: 300 / 60, fail: 1.0 },
  },

  body: (c) => {
    // EXP grants (ERB 103-124, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 104
    grant(c.t, EXP_ID.Ａ経験, 1); //         ERB 103
    grant(c.t, EXP_ID.Ａ性交経験, 1); //     ERB 121
    // ERB 123-124: 愛情経験 += 恋慕.
    grant(c.t, EXP_ID.愛情経験, c.tTalent(TALENT_ID.恋慕));
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET%维持肛门正常位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf62HandlerEntry: HandlerEntry = makeComfHandler(comf62Def);
