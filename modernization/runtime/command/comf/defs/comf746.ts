/**
 * Phase 7 — `COMF746 アナルビーズ(慰)` (self-pleasure anal beads), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM746` (`ERB/コマンド関連/COMF/700 自慰系/COMF746 アナルビーズ(慰).ERB`).
 *
 * **Self/auto toy family (自慰系 740-749).** Toggle command (TEQUIP:PLAYER:後庭拉珠).
 * We model the INITIAL activation (equipping) only. On equip, 快Ａ gets ×0.80.
 *
 * **Faithful normal-mode core (ERB lines 17-63):**
 *   - DOWNBASE: master 体力 60 / 気力 150 (ERB 18-19)
 *   - SOURCE master: 快Ａ 150 (×0.80 on equip → 120), 苦痛 200, 露出 50, 屈従 50, 逸脱 60, 反感 80 (ERB 21-26)
 *   - 鬱屈 +70 if 自己愛<0 || 抵抗 (ERB 39-41)
 *   - Body: 自慰过了 PLAYER++, 道具使用経験 PLAYER++ (ERB 59,61)
 *   - On REMOVAL (!TEQUIP): EXP:Ａ経験 += 2 — DEFERRED (we model equip only)
 *
 * **DEFERRED:**
 *   - TEQUIP toggle management (着脱)
 *   - STAIN 腸内/Ａ swap (ERB 48-49)
 *   - PAIN_CHECK_A (ERB 44)
 *   - EQUIP_COM746 continuation effects (ERB 67-125)
 *   - A経験 +2 on removal (ERB 55-56)
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
import { hasItem } from "../../../state/items.js";
import { isEquipped, readTequip } from "../../../state/tequip.js";

const block = (message: string) =>
  ({ ok: false, reason: { kind: "precondition", message } }) as const;

/**
 * `@COM_ABLE746` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, TEQUIP:21/22/23 (浣腸/バルーン/電極 使用中).
 */
const com746Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除臂: 已装备时显示以便取下 (上游 SIF TEQUIP:15 → RETURN 1).
  if (isEquipped(ctx.state.master, TEQUIP_ID.後庭拉珠)) return { ok: true };
  if (!hasItem(ctx.state, 6)) return block("需要持有后庭拉珠。");
  if (readTequip(ctx.state.master, TEQUIP_ID.下半身着衣状況) > 1) {
    return block("下半身衣着妨碍了动作。");
  }
  if (isEquipped(ctx.state.master, TEQUIP_ID.肛用振動棒)) {
    return block("肛用振动棒使用中无法使用。");
  }
  if (isEquipped(ctx.state.master, TEQUIP_ID.新妻PLAY)) {
    return block("新妻PLAY中无法使用。");
  }
  return { ok: true };
};

export const comf746Def: ComfDef = {
  commandNo: 746,
  label: "アナルビーズ(慰)",

  requiresItem: 6,

  canExecute: com746Check,
  hModeMenuCheck: com746Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,
  requiresTarget: false,

  downbase: { [BASE_ID.体力]: 60, [BASE_ID.気力]: 150 },

  buildSources: (c) => {
    // ERB 21: 快Ａ 150; ERB 29: on equip, ×0.80.
    const kaiA = Math.trunc(150 * 0.8);
    const kutsu = 200;
    const roshutsu = 50;
    const kujyu = 50;
    const itsudev = 60;
    const hankan = 80;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.苦痛]: kutsu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.屈従]: kujyu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };

    // ERB 39-41: 鬱屈 +70 if 自己愛<0 || 抵抗.
    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 70;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 70;
    }

    return sources;
  },

  body: (c) => {
    // ERB 59: 自慰过了 PLAYER++.
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    // ERB 61: 道具使用経験 PLAYER++.
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对自己使用了肛门拉珠 — アナルビーズ(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf746HandlerEntry: HandlerEntry = makeComfHandler(comf746Def);
