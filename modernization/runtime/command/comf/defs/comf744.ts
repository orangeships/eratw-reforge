/**
 * Phase 7 — COMF744 バイブ(慰) (self-pleasure vibrator-dildo, toggle).
 * ERB ref: COMF744.ERB
 * DEFERRED: TEQUIP toggle (振動棒), PAIN_CHECK_V, EQUIP_COM744 continuation.
 * Modeled: INITIAL activation only + virgin penalty sources/body.
 *
 * Virgin penalty (master scope, self-pleasure):
 *   - 処女==1: 苦痛 += 2000, 反感 += 3000 (buildSources)
 *   - 処女==2 (再生処女): 苦痛 += 500, 反感 += 1000 (buildSources)
 *   - 処女==1 && CFLAG[3] bit 3 not set: EXP[異常経験]++, SETBIT CFLAG[3] bit 3 (body)
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
 * `@COM_ABLE744` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, ASSIPLAY 処女/潤滑 従順・百合属性 gates.
 */
const com744Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除臂: 已装备时显示以便取下 (上游 SIF TEQUIP:13 → RETURN 1).
  if (isEquipped(ctx.state.master, TEQUIP_ID.振動棒)) return { ok: true };
  // 男人だとダメ (!(TALENT:性別 & 1) → RETURN 0) — 需女性/扶她.
  if (((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0) {
    return block("男性无法使用。");
  }
  if (!hasItem(ctx.state, 4)) return block("需要持有振动棒。");
  if (readTequip(ctx.state.master, TEQUIP_ID.下半身着衣状況) & 4) {
    return block("下半身衣着妨碍了动作。");
  }
  return { ok: true };
};

export const comf744Def: ComfDef = {
  commandNo: 744,
  label: "バイブ(慰)",

  requiresItem: 4,

  canExecute: com744Check,
  hModeMenuCheck: com744Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 5,
  requiresTarget: false,
  settleSourcesOnMaster: true,
  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 100 },
  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｖ]: 250,
      [SOURCE_ID.苦痛]: 50,
      [SOURCE_ID.露出]: 20,
      [SOURCE_ID.逸脱]: 40,
      [SOURCE_ID.反感]: 40,
    };

    // Virgin penalty — master scope (self-pleasure)
    if (c.master.state.TALENT[TALENT_ID.処女] === 1) {
      sources[SOURCE_ID.苦痛] = (sources[SOURCE_ID.苦痛] ?? 0) + 2000;
      sources[SOURCE_ID.反感] = (sources[SOURCE_ID.反感] ?? 0) + 3000;
    } else if (c.master.state.TALENT[TALENT_ID.処女] === 2) {
      // 再生処女
      sources[SOURCE_ID.苦痛] = (sources[SOURCE_ID.苦痛] ?? 0) + 500;
      sources[SOURCE_ID.反感] = (sources[SOURCE_ID.反感] ?? 0) + 1000;
    }

    // 鬱屈 from 自己愛<0 or 抵抗
    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 40;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 40;
    }

    return sources;
  },
  body: (c) => {
    c.master.state.CFLAG[347] = (c.master.state.CFLAG[347] ?? 0) + 1;
    c.master.state.EXP[EXP_ID.道具使用経験] = (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
    c.master.state.EXP[EXP_ID.Ｖ経験] = (c.master.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 1;

    // Virgin anomaly: first insertion while virgin sets異常経験 + CFLAG[3] bit 3
    if (
      c.master.state.TALENT[TALENT_ID.処女] === 1 &&
      !((c.master.state.CFLAG[3] ?? 0) & (1 << 3))
    ) {
      c.master.state.EXP[EXP_ID.異常経験] = (c.master.state.EXP[EXP_ID.異常経験] ?? 0) + 1;
      c.master.state.CFLAG[3] = (c.master.state.CFLAG[3] ?? 0) | (1 << 3);
    }
  },
  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对自己使用了振动棒 — バイブ(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf744HandlerEntry: HandlerEntry = makeComfHandler(comf744Def);
