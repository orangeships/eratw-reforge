/**
 * Phase 7 — `COMF46 ビーズ` (anal beads), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM46`
 * (`ERB/コマンド関連/COMF/COMF46 アナルビーズ.ERB`).
 *
 * Toys family sibling (道具系 40-49). Like COMF45 this is an anal toy
 * with a strong 屈従 / 反感 / 苦痛 signature — and uniquely the SOURCE
 * for 快Ａ varies depending on whether the toy is being inserted or
 * removed (×0.80 on insert, ×3.00 on removal). At the def level we
 * capture the BASE rate; the TEQUIP-aware multiplier is deferred (the
 * def runs as a single settlement, but the actual command toggles the
 * equipment state mid-run).
 *
 * **Faithful normal-mode core captured (ERB 33-72, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +60 / 気力 +150 (ERB 48-49)
 *   - SOURCE 快Ａ 150, 苦痛 200, 露出 50, 屈従 50, 逸脱 60, 反感 80
 *     (ERB 51-56) — the TEQUIP-gated ×0.80 / ×3.00 multipliers on
 *     快Ａ (ERB 59-64) are DEFERRED (see below).
 *   - +鬱屈 70 if the target has 自己愛<0 or 抵抗 (ERB 70-71)
 *   - EXP:Ａ経験 +2 (when removing — TEQUIP-state gated; ERB 84-85)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 97)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -150, 快Ａ 150, 苦痛 100) — time-stop isn't modeled in the playable
 *     slice.
 *   - **TEQUIP-gated 快Ａ multipliers** (ERB 59-64: ×0.80 when inserting,
 *     ×3.00 when removing) — these branch on the equipment toggle state,
 *     which the def cannot easily express without a separate
 *     `equipmentState` field. Need a factory extension (state-machine
 *     toggle) or a deferred flag.
 *   - **PAIN_CHECK_A(TARGET)** (ERB 74) — pre-settlement ABL/PALAM pain
 *     gating from `SOURCE_CHECK.ERB` is not yet modeled at the def level.
 *   - **STAIN:7 |= STAIN:4 / STAIN:4 |= STAIN:7** (ERB 79-80) — body-fluid
 *     stain propagation is not modeled.
 *   - **EXP:Ａ経験 +2 only on removal** (ERB 84-85) — same TEQUIP-toggle
 *     gating problem as the 快Ａ multiplier; we grant the +1 default
 *     (matching other anal toys) but the real ERB gives +2 only when
 *     removing. Documented as drift from upstream.
 *   - **HETEROSEX 同性愛 EXP** (ERB 86-95) — needs the gender-pair helper.
 *   - The equipping DISPLAY label (ERB 14) — the `toggleTequip` field flips
 *     the slot; the prose label isn't rendered separately.
 *   - H-scene action markers `TCVAR:TARGET:2=12` (Ａ責め),
 *     `TCVAR:TARGET:4=800` (強度), `TCVAR:116=PLAYER` (行為者),
 *     `TCVAR:Ａ喪失発生=1`, and the 扶她 `CSTR` append — mid-scene
 *     chaining state.
 *   - TEQUIP conflict gates (肛用振動棒 TEQUIP:14, 浣腸 TEQUIP:21,
 *     バルーン TEQUIP:22, 電極 TEQUIP:23, 新妻PLAY TEQUIP:33) — gated by
 *     the COMABLE layer. `ITEM:6` gate is now the def's `requiresItem`.
 *
 * **No outcome roll, no TIME** — factory pinned to 通常; timeCost 0.
 *
 * **C-tier drift (documented, NOT fixing):** the def grants a flat
 * `EXP:Ａ経験 += 1` in `body`. Upstream grants `+= 2` only when
 * removing the beads (ERB 84-85); the insert path grants 0. Until the
 * equipment-toggle state machine is added to the factory, this is the
 * best we can do without forcing a bespoke handler. The pinned test
 * asserts the +1 default so the drift is explicit.
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
import { isEquipped, readTequip } from "../../../state/tequip.js";

const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
  ok: false,
  reason: { kind: "precondition", message },
});

// COM_ABLE46: TFLAG:100 → target present; TEQUIP:15 (already equipped)
// → allow to display so it can be unequipped; ITEM:6 owned; TEQUIP:0 > 1
// 下半身着衣; conflicts TEQUIP:14 肛用振動棒 / 33 新妻PLAY. TALENT:196
// 毒人形, TEQUIP:21 浣腸 / 22 バルーン / 23 電極 — deferred.
const com46Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 6) && !isEquipped(target, TEQUIP_ID.後庭拉珠)) {
    return block("需要アナルビーズ。");
  }
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) > 1) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  if (isEquipped(target, TEQUIP_ID.肛用振動棒)) {
    return block("肛用振动棒使用中无法进行。");
  }
  if (isEquipped(target, TEQUIP_ID.新妻PLAY)) {
    return block("新妻PLAY中无法进行。");
  }
  return { ok: true };
};

export const comf46Def: ComfDef = {
  commandNo: 46,
  label: "アナルビーズ",

  // Equip-toggle core (COMF46.ERB:14 `TEQUIP:後庭拉珠 = !TEQUIP:後庭拉珠`).
  // Requires 後庭拉珠 (ITEM:6, COMF46.ERB:192 `SIF ITEM:6 == 0 → RETURN 0`).
  // The conflict gates (肛用振動棒 TEQUIP:14 / 浣腸 21 / バルーン 22 / 電極 23 /
  // 新妻PLAY 33) stay on the COMABLE layer (deferred, matching other toys).
  toggleTequip: TEQUIP_ID.後庭拉珠,
  requiresItem: 6,

  // P1-14: H 命令菜单门控 — 持有 後庭拉珠 或 已装备; 下半身着衣>1, 肛用振動棒/
  // 新妻PLAY 使用中 不可.
  hModeMenuCheck: com46Check,

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // ERB 48-49 (normal branch).
  downbase: { [BASE_ID.体力]: 60, [BASE_ID.気力]: 150 },

  buildSources: (c): Record<number, number> => {
    // 快Ａ base value (ERB 51); the ×0.80/×3.00 multipliers from
    // TEQUIP state (ERB 59-64) are DEFERRED — see header.
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: 150, // ERB 51
      [SOURCE_ID.苦痛]: 200, // ERB 52
      [SOURCE_ID.露出]: 50, //  ERB 53
      [SOURCE_ID.屈従]: 50, //  ERB 54
      [SOURCE_ID.逸脱]: 60, //  ERB 55
      [SOURCE_ID.反感]: 80, //  ERB 56
    };
    // ERB 70-71: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 70;
    }
    return sources;
  },

  body: (c) => {
    // ERB 84-85: EXP:Ａ経験 += 2 only on removal — DEFERRED; we grant
    // +1 default for the def-level single settlement (see header).
    c.t.state.EXP[EXP_ID.Ａ経験] = (c.t.state.EXP[EXP_ID.Ａ経験] ?? 0) + 1;
    // ERB 97: EXP:PLAYER:道具使用経験 ++ (HETEROSEX 同性愛 EXP deferred).
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了肛门拉珠；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf46HandlerEntry: HandlerEntry = makeComfHandler(comf46Def);