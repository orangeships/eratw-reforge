/**
 * Phase 7 — `COMF63 後背位アナル` (doggy-style anal), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM63`
 * (`ERB/コマンド関連/COMF/COMF63 後背位アナル.ERB`).
 *
 * **Positions family sibling (体位系 60-71, anal twin of 61).** 63 differs
 * from 61 in:
 *   - target SOURCE: 快Ａ 400 (replaces 快Ｖ 450) + 情愛 100, 苦痛 900
 *     (vs 400), 露出 80 (vs 70, no TFLAG arm), 逸脱 200, 反感 500
 *   - master SOURCE: 快Ｃ 400 (vs 61's 450)
 *   - master DOWNBASE same (40/40); target DOWNBASE 80/80 (vs 50/60)
 *   - EXP: target Ａ経験 +1 (replaces Ｖ経験), Ａ性交経験 +1,
 *     愛情経験 += 恋慕 (×1, not ×2)
 *
 * **Faithful target-side core (ERB ELSE branch 60-82 + 95-117):**
 *   - master DOWNBASE 体力/気力 +40 each (ERB 48-49, always)
 *   - target DOWNBASE 体力 +80 / 気力 +80 (ERB 62-63)
 *   - master SOURCE 快Ｃ 400 (ERB 65) — via `buildMasterSources`
 *   - target SOURCE 快Ａ 400, 情愛 100, 苦痛 900, 露出 80, 逸脱 200,
 *     反感 500 (ERB 65-71)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +500 (ERB 79-80)
 *   - EXP: master 挿入経験 +1, target Ａ経験 +1, Ａ性交経験 +1,
 *     愛情経験 += 恋慕 (ERB 95-115)
 *
 * **DEFERRED (documented):**
 *   - STAIN_肛門Ｐ挿入 / PAIN_CHECK_A / 特殊ソース処理 (ERB 84/90/97).
 *   - Time-stop branch (FLAG:70) incl. 苦痛 450 (ERB 55-58).
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
 * `@COM_ABLE63` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ａ経験<50 + 禁断的知識),
 * A経験阈值 (EXP:2 < EXPLV:3, time-stop skip), 浣腸(21)/バルーン(22)/電極(23)
 * TEQUIP slots (未建模), ASSIPLAY+潤滑 従順/百合属性, 処女+PALAM:潤滑 (time-stop
 * skip), TEQUIP:体位==4 (姿势状态), NOITEM debug flag.
 */
const com63Check: ExecCheck = (ctx) => {
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

export const comf63Def: ComfDef = {
  commandNo: 63,
  label: "後背位アナル",

  canExecute: com63Check,
  hModeMenuCheck: com63Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 48-49: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 40 },
  targetDownbase: { [BASE_ID.体力]: 80, [BASE_ID.気力]: 80 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      // ERB 65-71, normal branch (target-side).
      [SOURCE_ID.快Ａ]: 400,
      [SOURCE_ID.情愛]: 100,
      [SOURCE_ID.苦痛]: 900,
      [SOURCE_ID.露出]: 80,
      [SOURCE_ID.逸脱]: 200,
      [SOURCE_ID.反感]: 500,
    };
    // ERB 79-80: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 500;
    }
    return sources;
  },

  // ERB 65: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // EXP grants (ERB 95-115, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 96
    grant(c.t, EXP_ID.Ａ経験, 1); //         ERB 95
    grant(c.t, EXP_ID.Ａ性交経験, 1); //     ERB 113
    // ERB 115-116: 愛情経験 += 恋慕.
    grant(c.t, EXP_ID.愛情経験, c.tTalent(TALENT_ID.恋慕));
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET%维持肛门后背位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf63HandlerEntry: HandlerEntry = makeComfHandler(comf63Def);
