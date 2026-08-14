/**
 * Phase 7 — `COMF41 Ｅマッサージャ` (electric massager), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM41`
 * (`ERB/コマンド関連/COMF/COMF41 Ｅマッサージャ.ERB`).
 *
 * Toys family sibling (道具系 40-49). Differs from the exemplar COMF40
 * (ローター) only in 快感 values + 反感/逸脱 multipliers — the same
 * 自己愛<0 / 抵抗 → 鬱屈 branch + master DOWNBASE + 道具使用経験 grant.
 *
 * **Faithful normal-mode core captured (ERB 25-45, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +30 / 気力 +120 (ERB 31-32)
 *   - SOURCE 快Ｃ 500, 露出 40, 逸脱 60, 反感 60 (ERB 34-37)
 *   - +鬱屈 60 if the target has 自己愛<0 or 抵抗 (ERB 43-44)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 60)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -150, only 快Ｃ 500) — time-stop isn't modeled in the playable slice.
 *   - **HETEROSEX 同性愛 EXP** (`EXP:(50+HETEROSEX(…))`, ERB 50-58) — needs
 *     the gender-pair helper.
 *   - H-scene action markers `TCVAR:TARGET:2=10` (射精部位=道具),
 *     `TCVAR:TARGET:4=1000` (強度), `TCVAR:116=PLAYER` (行為者), and the
 *     扶她 `CSTR` append — mid-scene chaining state, not single-action
 *     settlement.
 *   - **ITEM:1 gate** (ERB 77, 道具を持っているか) — ITEM inventory not
 *     modeled in the runtime yet.
 *   - **ASSIPLAY 技巧 gate** (ERB 80-83) and 室内 only (ERB 88-89) —
 *     gated by the COMABLE layer, not the def.
 *
 * **No outcome roll, no TIME** — factory pinned to 通常; timeCost 0.
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  SOURCE_ID,
  TALENT_ID,
  EXP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { hasItem } from "../../../state/items.js";

const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
  ok: false,
  reason: { kind: "precondition", message },
});

// COM_ABLE41: TFLAG:100 → target present; ITEM:1 owned. ASSIPLAY 技巧<3,
// TEQUIP:32 淋浴中, 室内限定 (INROOM) — 不可建模/位置相关 → deferred.
const com41Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 1)) return block("需要Ｅマッサージャ。");
  return { ok: true };
};

export const comf41Def: ComfDef = {
  commandNo: 41,
  label: "Ｅマッサージャ",

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // Slice C: 需要道具 1.
  requiresItem: 1,

  // P1-14: H 命令菜单门控 — 显示需要道具 1.
  hModeMenuCheck: com41Check,

  // ERB 31-32 (normal branch).
  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 120 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 500, // ERB 34
      [SOURCE_ID.露出]: 40, //  ERB 35
      [SOURCE_ID.逸脱]: 60, //  ERB 36
      [SOURCE_ID.反感]: 60, //  ERB 37
    };
    // ERB 43-44: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 60;
    }
    return sources;
  },

  body: (c) => {
    // ERB 60: EXP:PLAYER:道具使用経験 ++ (HETEROSEX 同性愛 EXP deferred).
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了电动按摩器；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf41HandlerEntry: HandlerEntry = makeComfHandler(comf41Def);