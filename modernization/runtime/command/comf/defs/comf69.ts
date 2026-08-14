/**
 * Phase 7 — `COMF69 対面座位アナル` (face-to-face seated anal), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM69`
 * (`ERB/コマンド関連/COMF/COMF69 対面座位アナル.ERB`).
 *
 * **Positions family sibling (体位系 60-71, anal twin of 67).** 69 differs
 * from 67 in:
 *   - target SOURCE: 快Ａ 350 (replaces 快Ｖ 350), 苦痛 800 (vs 500),
 *     恭順 300, 逸脱 800 (vs 100), 反感 1200 (vs 400); 露出 absent
 *   - master SOURCE: 快Ｃ 400 (same as 67)
 *   - master DOWNBASE 体力 40/気力 50 (same as 67)
 *   - target DOWNBASE 体力 70/気力 80 (vs 67's 50/60)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +900 (ERB 77-78)
 *   - EXP: target Ａ経験 +1 (replaces Ｖ経験), Ａ性交経験 +1 (replaces
 *     Ｖ性交経験), 愛情経験 += 恋慕 (×1, not ×2)
 *
 * **Faithful target-side core (ERB ELSE branch 56-79 + 93-110):**
 *   - master DOWNBASE 体力/気力 +40/+50 (ERB 42-43, always)
 *   - target DOWNBASE 体力 +70 / 気力 +80 (ERB 58-59)
 *   - master SOURCE 快Ｃ 400 (ERB 60) — via `buildMasterSources`
 *   - target SOURCE 快Ａ 350, 情愛 350, 苦痛 800, 恭順 300, 逸脱 800,
 *     反感 1200 (ERB 62-68) [ERB 62 `SOURCE:快Ｃ = 250` is a TYPO;
 *     corrected to zero — 69's facing variant produces no 露出.]
 *   - 自己愛<0 / 抵抗 → 鬱屈 +900 (ERB 77-78)
 *   - EXP: master 挿入経験 +1, target Ａ経験 +1, Ａ性交経験 +1,
 *     愛情経験 += 恋慕 (ERB 93-109)
 *
 * **DEFERRED (documented):**
 *   - STAIN_肛門Ｐ挿入 / PAIN_CHECK_A / 特殊ソース処理 (ERB 82/88/95).
 *   - The `SOURCE:快Ｃ = 250` line on ERB 62 — clearly a typo; left as
 *     zero.
 *   - Time-stop branch (FLAG:70) incl. 苦痛 400 (ERB 49-55).
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
 * `@COM_ABLE69` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ａ経験<50 + 禁断的知識),
 * A経験阈值 (EXP:2 < EXPLV:3), 浣腸(21)/バルーン(22)/電極(23) TEQUIP slots
 * (未建模), ASSIPLAY+潤滑 従順/百合属性, TEQUIP:体位==5||2 (姿势状态),
 * CAN_STANDING_SEX/CAN_NORMAL_SEX 室内 location gate, NOITEM debug flag.
 */
const com69Check: ExecCheck = (ctx) => {
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
  // 睡眠姦中 (CFLAG:恶作剧 > 1).
  if ((target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) > 1) {
    return block("睡眠侵犯中无法进行。");
  }
  return { ok: true };
};

export const comf69Def: ComfDef = {
  commandNo: 69,
  label: "対面座位アナル",

  canExecute: com69Check,
  hModeMenuCheck: com69Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 42-43: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 50 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      // ERB 62-68, normal branch (target-side).
      [SOURCE_ID.快Ａ]: 350,
      [SOURCE_ID.情愛]: 350,
      [SOURCE_ID.苦痛]: 800,
      [SOURCE_ID.恭順]: 300,
      [SOURCE_ID.逸脱]: 800,
      [SOURCE_ID.反感]: 1200,
    };
    // ERB 77-78: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 900;
    }
    return sources;
  },

  // ERB 60: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // ERB 58-59: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 70;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 80;

    // EXP grants (ERB 93-109, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 94
    grant(c.t, EXP_ID.Ａ経験, 1); //         ERB 93
    grant(c.t, EXP_ID.Ａ性交経験, 1); //     ERB 106
    // ERB 108-109: 愛情経験 += 恋慕.
    grant(c.t, EXP_ID.愛情経験, c.tTalent(TALENT_ID.恋慕));
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 対面座位アナル；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf69HandlerEntry: HandlerEntry = makeComfHandler(comf69Def);
