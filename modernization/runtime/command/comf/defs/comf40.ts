/**
 * Phase 7 — `COMF40 ローター` (rotor/vibrator toy), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM40`
 * (`ERB/コマンド関連/COMF/COMF40 ローター.ERB`).
 *
 * **Toys family exemplar (道具系 40-49).** This is the first intimate
 * H-scene family port — the genuinely A/B, factory-shaped bulk (~88
 * commands across toys/positions/oral/SM/drugs are this same shape). A
 * toy command is: target-directed transient SOURCE (a 快感 type + a few
 * 露出/逸脱/反感 quanta) + master BASE drain + a 道具使用経験 grant. No
 * outcome roll, no TIME advance (H-scene actions don't tick the clock).
 * Siblings (44 バイブ, 45 アナルバイブ, 48 搾乳器…) differ only in which
 * 快感 type (快Ｃ/快Ａ/快Ｂ), the base values, and the drain.
 *
 * **Faithful normal-mode core captured (ERB 33-63, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +10 / 気力 +80 (ERB 35-36)
 *   - SOURCE 快Ｃ 250, 露出 20, 逸脱 30, 反感 30 (ERB 38-41)
 *   - +鬱屈 30 if the target has 自己愛<0 or 抵抗 (ERB 46-47)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 63)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -80, only 快Ｃ 250) — time-stop isn't modeled in the playable slice
 *     and CFLAG:344's exact semantics are unconfirmed. The normal branch
 *     is the reachable one.
 *   - **HETEROSEX 同性愛 EXP** (`EXP:(50+HETEROSEX(…))`, ERB 54-61) — needs
 *     the gender-pair helper.
 *   - H-scene action markers `TCVAR:TARGET:2=10` (射精部位=道具),
 *     `TCVAR:TARGET:4=1000` (強度), `TCVAR:116=PLAYER` (行為者), and the
 *     扶她 `CSTR` append — mid-scene chaining state, not single-action
 *     settlement.
 *
 * **No outcome roll, no TIME** — factory pinned to 通常; timeCost 0.
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  SOURCE_ID,
  TALENT_ID,
  EXP_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { hasItem } from "../../../state/items.js";
import { readTequip } from "../../../state/tequip.js";

const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
  ok: false,
  reason: { kind: "precondition", message },
});

// COM_ABLE40: TFLAG:100 → target present; ITEM:0 owned; TEQUIP:0 & 8
// (下半身着衣 ずらし不可 bit 3) blocks.
const com40Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 0)) return block("需要跳蛋。");
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) & 8) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  // deferred: NOITEM 道具無設定模式, GLOBAL_COMABLE.
  return { ok: true };
};

export const comf40Def: ComfDef = {
  commandNo: 40,
  label: "ローター",

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // Slice C: 需要道具 0.
  requiresItem: 0,

  // P1-14: H 命令菜单门控 — 显示需要道具 0 且对象下半身衣着不阻碍.
  hModeMenuCheck: com40Check,

  // ERB 35-36 (normal branch).
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 250, // ERB 38
      [SOURCE_ID.露出]: 20, //  ERB 39
      [SOURCE_ID.逸脱]: 30, //  ERB 40
      [SOURCE_ID.反感]: 30, //  ERB 41
    };
    // ERB 46-47: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 30;
    }
    return sources;
  },

  body: (c) => {
    // ERB 63: EXP:PLAYER:道具使用経験 ++ (HETEROSEX 同性愛 EXP deferred).
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了跳蛋；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf40HandlerEntry: HandlerEntry = makeComfHandler(comf40Def);
