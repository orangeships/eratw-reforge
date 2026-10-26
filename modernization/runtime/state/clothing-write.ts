/**
 * CLOTHES Phase 1 (P1) — write-side clothing engine.
 *
 * Lets "undressing" actually mutate runtime state — Phase 0 (commit 1c32820 +
 * 02d099d) is read-only (showTop/Bottom/内衣); this file ships the matching
 * writer that downstream commands/H commands can call to strip a chara.
 *
 * **Upstream faithful**: this module mirrors `@DATUI_*` (COUNTER_脱衣.ERB)
 * and `@CLOTHES_SETTING_TRAIN` (CLOTHES.ERB:724-826) into a modern, pure
 * (immutable) form. Where upstream splits "intent (TCVAR:22/23/24/25) →
 * late (EQUIP write)", we collapse to one-step: `stripBottom/Top` writes
 * EQUIP and re-computes TEQUIP atomically.
 *
 * **Key correctness note** — upstream `DATUI_LATE` does NOT call
 * `CLOTHES_SETTING_TRAIN` (a quirk leaving TEQUIP stale until the next
 * CLOTHES_SETTING_TRAIN tick). Modern P1 **fixes** this: every strip call
 * runs `recomputeExposure` synchronously, so the public TEQUIP bits
 * always reflect EQUIP after a strip. Phase 0's read API is
 * TEQUIP-independent (QoL _qol reads EQUIP directly), so the read side is
 * unaffected; but P1-c (tequipMul hooks for H commands) needs the bits
 * to be live.
 *
 * **Half-undress** (`半脱` / 着衣PLAY): `TEQUIP:3` = 上半身裸露状態. The
 * upstream `CAN_半脱` gates this on "no はだけ不可 top, has a はだけ可
 * cover (上身衣服２/和服/レオタード/ボディースーツ 2/10/11)". P1 ships
 * the gate + the stripper; the actual 着衣PLAY command that triggers
 * 半脱 in CCOMF is out of scope (COUNTER改造 = Phase 5+).
 *
 * **Deferred** (documented, not in P1):
 *   - SELECT_CLOTHES / CHANGE_CLOTHES / EX_COSTUME / OKIGAE ("which set"
 *     logic depends on `CFLAG:200-230` outfit storage — Phase 2)
 *   - 玩家主动脱衣命令 (P1-b, optional by user)
 *   - 自动脱衣钩子 in `make-comf-handler.ts` (P1-d, optional by user)
 *   - COUNTER files改造 (Phase 5+)
 *   - PANTS_GET inventory transfer is implemented by the P4 collection layer
 *   - CHECK_CLO / CHECK_PANTIES / CURRENT_CLOTHES_SET (read-side, defer)
 *   - UNIQUE_UNDERWARE_* 9 functions (P1+ extension)
 */

import type { GameState, CharaSlot } from "./game-state.js";
import { cloneGameState } from "./game-state.js";
import { CFLAG_ID, EQUIP_SLOT, TEQUIP_ID } from "./settlement.js";
import { charaOutfit } from "./clothing-outfits.js";
import { clothingIdByName } from "./clothing-catalog.js";
import { acquirePants } from "./panty-collection.js";
import { readTequip, writeTequip } from "./tequip.js";

// ---------------------------------------------------------------------------
// Mode enums — mirror upstream `@DATUI_BOTTOM` case arms (0/1/2) and
// `@DATUI_TOP` case arms (0/1). Numbers are load-bearing — they flow into
// `datuiOptimizeBottom` and the slot-group pickers below.
// ---------------------------------------------------------------------------

/** `@DATUI_BOTTOM` mode: 0=全脱 / 1=内衣脱 / 2=外套脱. */
export type BottomStripMode = 0 | 1 | 2;
/** `@DATUI_TOP` mode: 0=全脱 / 1=はだけ. */
export type TopStripMode = 0 | 1;
/** Which side is being undressed — gates `TEQUIP:5` write (DATUI_TOP_T_LATE). */
export type StripSide = "master" | "target";

// ---------------------------------------------------------------------------
// Slot groupings — mirror the CASE arms of `@DATUI_BOTTOM_LATE:67-97`,
// `@DATUI_TOP_LATE:132-149`, `@DATUI_TOP_T_LATE:152-171`.
// Each list = the EQUIP slot ids that get zeroed for that mode.
// ---------------------------------------------------------------------------

/** CASE 1: 全脱 (all 9 bottom-related slots). */
const BOTTOM_SLOTS_ALL: readonly number[] = [
  EQUIP_SLOT.下半身内衣１, EQUIP_SLOT.下半身内衣２, EQUIP_SLOT.裤子,
  EQUIP_SLOT.下身衣服, EQUIP_SLOT.裙子, EQUIP_SLOT.ボディースーツ,
  EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服, EQUIP_SLOT.レオタード,
];
/** CASE 2: 内衣だけ脱がす (inner layers + pants/bsuit/leotard; keeps skirt/kimono/one-piece). */
const BOTTOM_SLOTS_UNDERWEAR_ONLY: readonly number[] = [
  EQUIP_SLOT.下半身内衣１, EQUIP_SLOT.下半身内衣２, EQUIP_SLOT.裤子,
  EQUIP_SLOT.下身衣服, EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.レオタード,
];
/** CASE 3: 外套だけ脱がす (outer layers; keeps panties). */
const BOTTOM_SLOTS_OUTER_ONLY: readonly number[] = [
  EQUIP_SLOT.裤子, EQUIP_SLOT.下身衣服, EQUIP_SLOT.裙子,
  EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服,
  EQUIP_SLOT.レオタード,
];

/** Top CASE 1: 全脱 (all 8 top-related slots). */
const TOP_SLOTS_ALL: readonly number[] = [
  EQUIP_SLOT.上半身内衣１, EQUIP_SLOT.上半身内衣２,
  EQUIP_SLOT.上身衣服１, EQUIP_SLOT.上身衣服２,
  EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服,
  EQUIP_SLOT.レオタード,
];
/** Top CASE 2: はだけ (strips はだけ不可 only — keeps 上半身内衣２ / 上身衣服２ / 和服). */
const TOP_SLOTS_HADAKAKE: readonly number[] = [
  EQUIP_SLOT.上半身内衣１, EQUIP_SLOT.上身衣服１,
  EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.連衣裙, EQUIP_SLOT.レオタード,
];

// ---------------------------------------------------------------------------
// TEQUIP:0 / TEQUIP:1 bit constants — match `CLOTHES_SETTING_TRAIN` 760-762
// + 792-793 CSV comments.
// ---------------------------------------------------------------------------

/** TEQUIP:0 (下半身) bits. */
const T0_SKIRT = 0b0001;       // bit 0 = 裙子
const T0_ZURASHI_OK = 0b0010;  // bit 1 = ずらし可
const T0_ZURASHI_NG = 0b0100;  // bit 2 = ずらし不可
const T0_PANTS_NG = 0b1000;    // bit 3 = 下身衣服ずらし不可
const T0_TSUKKOMI_NG = 0b10000;// bit 4 = 突っ込み不可 (BodySuit / Leotard)
/** TEQUIP:1 (上半身) bits. */
const T1_HADAKAKE_OK = 0b0001; // bit 0 = はだけ可
const T1_HADAKAKE_NG = 0b0010; // bit 1 = はだけ不可
const T1_TSUKKOMI_NG = 0b0100; // bit 2 = 突っ込み不可

// ---------------------------------------------------------------------------
// `DATUI_BOTTOM_OPTIMIZE` — upgrade mode when the target layer isn't there.
// Pure function. Upstream: COUNTER_脱衣.ERB:42-60.
// ---------------------------------------------------------------------------

/**
 * `@DATUI_BOTTOM_OPTIMIZE(ARG, ARG:1)` — if you ask to strip only the
 * underwear but the chara is wearing pants (TEQUIP:0 & 8) or no underwear
 * (TEQUIP:0 & 6 == 0), the request collapses to 全脱. Same with
 * 外套-only when there's no outer (TEQUIP:0 & 9 == 0).
 *
 * Reads TEQUIP:0 (下半身着衣状況) which is the bitmask recomputed from
 * EQUIP — so this is fully pure on `chara.state`.
 */
export function datuiOptimizeBottom(chara: CharaSlot, mode: BottomStripMode): BottomStripMode {
  if (mode === 1) {
    const t0 = readTequip(chara, TEQUIP_ID.下半身着衣状況);
    // 裤子を履いていた場合は全部脱がす
    if (t0 & T0_PANTS_NG) return 0;
    // 内衣を履いていなかった場合も全部脱がす
    if ((t0 & (T0_ZURASHI_OK | T0_ZURASHI_NG)) === 0) return 0;
  } else if (mode === 2) {
    const t0 = readTequip(chara, TEQUIP_ID.下半身着衣状況);
    // 外套を着ていない場合は全部脱がす
    if ((t0 & (T0_SKIRT | T0_TSUKKOMI_NG)) === 0) return 0;
  }
  return mode;
}

// ---------------------------------------------------------------------------
// `recomputeExposure` — re-derive TEQUIP:0/1 from current EQUIP. Mirrors
// `@CLOTHES_SETTING_TRAIN` (CLOTHES.ERB:724-826). Mutates the passed slot
// in place (caller is responsible for clone).
// ---------------------------------------------------------------------------

/**
 * `@CLOTHES_SETTING_TRAIN(ARG)` TEQUIP rebuild (CLOTHES.ERB:727-826). Reads
 * `state.EQUIP`, writes the two exposure bitmasks back to `state.TEQUIP`.
 *
 * **Quirk fixed**: upstream also handles 靴/襪子 + 全裸 reset + room-in
 * 飾品 reset in the same function — those side effects depend on
 * CFLAG:現在位置 + CFLAG:201/601/603 (out of scope for Phase 1). P1
 * ships only the pure EQUIP→TEQUIP derivation; clothing writers must
 * call this directly after every EQUIP mutation.
 *
 * Half-undress override (CLOTHES.ERB:823-824): `TEQUIP:3` (上半身裸露状態)
 * clears `TEQUIP:1` bit 1 (はだけ不可). The `TEQUIP:4` branch (line 825)
 * is dead code per `Tequip.csv` (id 4 is unregistered) — skipped.
 */
export function recomputeExposure(chara: CharaSlot): void {
  const e = chara.state.EQUIP;
  let t0 = 0;
  let t1 = 0;

  // ---- 下半身 (CLOTHES.ERB:763-790) ----
  if (e[EQUIP_SLOT.下半身内衣１]) t0 |= T0_ZURASHI_NG;
  if (e[EQUIP_SLOT.下半身内衣２]) t0 |= T0_ZURASHI_OK;
  if (e[EQUIP_SLOT.裤子]) {
    t0 |= T0_ZURASHI_NG;
    t0 |= T0_PANTS_NG;
  }
  if (e[EQUIP_SLOT.下身衣服]) t0 |= T0_ZURASHI_OK;
  if (e[EQUIP_SLOT.裙子]) t0 |= T0_SKIRT;
  if (e[EQUIP_SLOT.ボディースーツ]) {
    t0 |= T0_ZURASHI_NG;
    t0 |= T0_PANTS_NG;
    t0 |= T0_TSUKKOMI_NG;
  }
  if (e[EQUIP_SLOT.連衣裙]) t0 |= T0_SKIRT;
  if (e[EQUIP_SLOT.和服]) t0 |= T0_SKIRT;
  if (e[EQUIP_SLOT.レオタード]) {
    t0 |= T0_ZURASHI_OK;
    t0 |= T0_TSUKKOMI_NG;
  }

  // ---- 上半身 (CLOTHES.ERB:794-820) ----
  if (e[EQUIP_SLOT.上半身内衣１]) {
    t1 |= T1_HADAKAKE_NG;
    t1 |= T1_TSUKKOMI_NG;
  }
  if (e[EQUIP_SLOT.上半身内衣２]) t1 |= T1_HADAKAKE_OK;
  if (e[EQUIP_SLOT.上身衣服１]) {
    t1 |= T1_HADAKAKE_NG;
    t1 |= T1_TSUKKOMI_NG;
  }
  if (e[EQUIP_SLOT.上身衣服２]) t1 |= T1_HADAKAKE_OK;
  if (e[EQUIP_SLOT.ボディースーツ]) {
    t1 |= T1_HADAKAKE_NG;
    t1 |= T1_TSUKKOMI_NG;
  }
  if (e[EQUIP_SLOT.連衣裙]) t1 |= T1_HADAKAKE_NG;
  if (e[EQUIP_SLOT.和服]) t1 |= T1_HADAKAKE_OK;
  if (e[EQUIP_SLOT.レオタード]) {
    t1 |= T1_HADAKAKE_NG;
    t1 |= T1_TSUKKOMI_NG;
  }

  // ---- 半脱 / 上衣脱衣完毕 adjustment (CLOTHES.ERB:822-826) ----
  if (readTequip(chara, TEQUIP_ID.上半身裸露状態)) {
    t1 &= ~T1_HADAKAKE_NG;
  }
  // TEQUIP:4 (line 825) is dead code — Tequip.csv has no id=4 — skipped.

  writeTequip(chara, TEQUIP_ID.下半身着衣状況, t0);
  writeTequip(chara, TEQUIP_ID.上半身着衣状況, t1);
}

// ---------------------------------------------------------------------------
// Public strip API — each function clones GameState, mutates the chara's
// EQUIP/TEQUIP, runs recomputeExposure, returns the new state. No-op if
// the chara doesn't exist (returns the input unchanged).
// ---------------------------------------------------------------------------

/**
 * `@DATUI_BOTTOM_LATE(ARG, ARG:1)` — strip the chara's lower body. The
 * raw mode is first passed through `datuiOptimizeBottom` so callers can
 * pass user-friendly intent (e.g. "strip underwear only") and the engine
 * will collapse to 全脱 if the target layer isn't there.
 *
 * **TEQUIP:0/1 always re-derived** (call site doesn't need to recompute).
 */
export function stripBottom(
  state: GameState,
  charaNum: number,
  rawMode: BottomStripMode,
): GameState {
  const next = cloneGameState(state);
  const chara = charaNum === 0 ? next.master : next.charas[charaNum];
  if (!chara) return state;
  const mode = datuiOptimizeBottom(chara, rawMode);
  const slots =
    mode === 0 ? BOTTOM_SLOTS_ALL
    : mode === 1 ? BOTTOM_SLOTS_UNDERWEAR_ONLY
    : BOTTOM_SLOTS_OUTER_ONLY;
  for (const slotId of slots) chara.state.EQUIP[slotId] = 0;
  if (mode !== 2 && hasUniqueUnderwear(charaNum, false) &&
    (chara.state.CFLAG[CFLAG_ID.没穿内裤] ?? 0) === 0) {
    // 固有胖次 is stored in CHARA_OUTFITS rather than EQUIP. Keep its
    // state-bound read path in sync with this DATUI commit.
    chara.state.CFLAG[CFLAG_ID.没穿内裤] = 1;
  }
  recomputeExposure(chara);
  return next;
}

/**
 * `@DATUI_TOP_LATE` + `@DATUI_TOP_T_LATE` — strip the chara's upper body.
 * `targetSide="target"` mirrors `@DATUI_TOP_T_LATE` and sets `TEQUIP:5`
 * (上衣脱衣完毕); `targetSide="master"` mirrors `@DATUI_TOP_LATE` (no flag).
 * `TEQUIP:3` records the half-open mode so the outfit-backed upper-underwear
 * reader can distinguish it from a full strip.
 *
 * Mode 0 = 全脱; mode 1 = はだけ (keeps はだけ可 layer + 和服).
 */
export function stripTop(
  state: GameState,
  charaNum: number,
  mode: TopStripMode,
  targetSide: StripSide = "target",
): GameState {
  const next = cloneGameState(state);
  const chara = charaNum === 0 ? next.master : next.charas[charaNum];
  if (!chara) return state;
  const slots = mode === 0 ? TOP_SLOTS_ALL : TOP_SLOTS_HADAKAKE;
  for (const slotId of slots) chara.state.EQUIP[slotId] = 0;
  writeTequip(chara, TEQUIP_ID.上半身裸露状態, mode === 0 ? 0 : 1);
  if (targetSide === "target") {
    writeTequip(chara, TEQUIP_ID.上衣脱衣完毕, 1);
  }
  recomputeExposure(chara);
  return next;
}

/**
 * `@DATUI_SHOES(ARG, ARG:1)` — ARG:1=0 strips 靴 only; ARG:1=1 strips
 * 靴 + 襪子. Upstream ends with `CALL CLOTHES_SETTING_TRAIN(ARG)`,
 * which we approximate by `recomputeExposure`.
 */
export function stripShoes(
  state: GameState,
  charaNum: number,
  withSocks: boolean,
): GameState {
  const next = cloneGameState(state);
  const chara = next.charas[charaNum];
  if (!chara) return state;
  chara.state.EQUIP[EQUIP_SLOT.靴] = 0;
  if (withSocks) chara.state.EQUIP[EQUIP_SLOT.襪子] = 0;
  recomputeExposure(chara);
  return next;
}

/**
 * 半脱 — `TEQUIP:3 = 1` + clear `上半身内衣１` (mirrors `@CTRL_CLOTHES_SET
 * ..._半脱` (CLOTHES.ERB:1416-1420) + the upstream semantics in
 * `qol_脱衣.ERB:5-26`). Does NOT zero 上半身内衣２ / 上身衣服２ / 和服 —
 * those are はだけ可 cover, kept in place per `@CAN_半脱`.
 *
 * Callers MUST gate on `canHalfStrip(chara)` first — the API itself
 * performs the gate and no-ops (returns input state) if the chara can't
 * be half-stripped. This matches the upstream convention where the
 * 着衣PLAY command calls `CAN_半脱` before dispatching.
 */
export function stripPartialTop(state: GameState, charaNum: number): GameState {
  const next = cloneGameState(state);
  const chara = next.charas[charaNum];
  if (!chara) return state;
  if (!canHalfStrip(chara)) return state;
  // Mirror CTRL_CLOTHES_SET "..._半脱" (CLOTHES.ERB:1416-1420):
  //   EQUIP:上半身内衣１ = 0
  //   TEQUIP:上半身裸露状態 = 1
  //   if pants: EQUIP:裤子 = 0
  chara.state.EQUIP[EQUIP_SLOT.上半身内衣１] = 0;
  writeTequip(chara, TEQUIP_ID.上半身裸露状態, 1);
  const hasPants = (chara.state.EQUIP[EQUIP_SLOT.裤子] ?? 0) !== 0;
  if (hasPants) chara.state.EQUIP[EQUIP_SLOT.裤子] = 0;
  recomputeExposure(chara);
  return next;
}

/**
 * `@CAN_半脱(ARG)` (qol_脱衣.ERB:5-26) — chara can be half-undressed
 * (着衣PLAY eligible) when:
 *   - not already stripped (`TEQUIP:5` / `TEQUIP:3` / 全裸 check)
 *   - no はだけ不可 top (`EQUIP:上身衣服１` == 0)
 *   - has a はだけ可 cover: 上身衣服２ / 和服 / レオタード / BodySuit 2/10/11
 *
 * **Catalog caveat**: subset catalog has no BodySuit entries, so the
 * BodySuit 2/10/11 arm is dormant in P1 — the practical half-undress
 * targets are 上身衣服２ + 和服 (currently 0 bundle charas wear 和服,
 * `女式衬衫` covers upper-2).
 */
export function canHalfStrip(chara: CharaSlot): boolean {
  // Already-stripped guards
  if (readTequip(chara, TEQUIP_ID.上衣脱衣完毕) === 1) return false;
  if (readTequip(chara, TEQUIP_ID.上半身裸露状態) === 1) return false;
  // 全裸 guard (全裸 = EQUIP:0 == 0; in our model = no worn non-deco slots).
  // We approximate via "no body-clothes" — at minimum one of {上半身内衣, 上身衣服,
  // ボディースーツ, 連衣裙, 和服, レオタード} should be present.
  const hasAnyUpper = [
    EQUIP_SLOT.上半身内衣１, EQUIP_SLOT.上半身内衣２,
    EQUIP_SLOT.上身衣服１, EQUIP_SLOT.上身衣服２,
    EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服,
    EQUIP_SLOT.レオタード,
  ].some((s) => (chara.state.EQUIP[s] ?? 0) !== 0);
  if (!hasAnyUpper) return false;
  // はだけ不可 top blocks
  if ((chara.state.EQUIP[EQUIP_SLOT.上身衣服１] ?? 0) !== 0) return false;
  // Need a はだけ可 cover
  const had =
    (chara.state.EQUIP[EQUIP_SLOT.上身衣服２] ?? 0) !== 0 ||
    (chara.state.EQUIP[EQUIP_SLOT.和服] ?? 0) !== 0 ||
    (chara.state.EQUIP[EQUIP_SLOT.レオタード] ?? 0) !== 0 ||
    BODY_SUIT_HALF_OPEN.has(chara.state.EQUIP[EQUIP_SLOT.ボディースーツ] ?? 0);
  return had;
}

/**
 * `@IS_半脱(ARG, ARG:1)` (qol_脱衣.ERB:27-49).
 *   strict=true  → narrow check (TEQUIP:3 == 1; post-着衣PLAY only).
 *   strict=false → broad check (also CAN_半脱 when 诶嘿嘿).
 *
 * P1 only ships the narrow path — the broad path needs upstream state
 * (PREVCOM/SELECTCOM/TFLAG:103-104) which modern runtime doesn't track
 * for H commands yet (Phase 5+ for COMABLE/H hooks).
 */
export function isHalfDressed(chara: CharaSlot, strict = true): boolean {
  if (strict) {
    return readTequip(chara, TEQUIP_ID.上半身裸露状態) === 1;
  }
  if (isHalfDressed(chara, true)) return true;
  // Broad path DEFERRED — needs 诶嘿嘿 + PREVCOM/SELECTCOM tracking.
  return false;
}

/**
 * BodySuit catalog ids eligible for half-undress (qol_脱衣.ERB:21):
 *   "連体紧身衣胯部有扣 / 搜查官胶衣和骑行服胯部有拉链"
 * Upstream ids 2/10/11. P1 catalog has no BodySuit entries (deferred P3),
 * so the BODY_SUIT_HALF_OPEN set is empty in practice — but the gate
 * stays in place so the check doesn't reject valid future catalog entries.
 */
const BODY_SUIT_HALF_OPEN: ReadonlySet<number> = new Set([2, 10, 11]);

// ---------------------------------------------------------------------------
// Panty removal — `@PANTS_GET(ARG, "drop")` from PANTS.ERB:59.
//
// Strips EQUIP[下半身内衣２], sets CFLAG:没穿内裤, and optionally places the
// removed piece in PANTS_TEMP for the P4 collection pipeline.
// ---------------------------------------------------------------------------

/**
 * `@PANTS_GET(ARG, ARGS)` — remove the chara's panties.
 *
 * `drop` leaves them behind (`CFLAG:291 = 1`); `stolen` carries them while
 * keeping the same marker; `gift` mirrors upstream `ARGS == "もらう"`
 * (`CFLAG:291 = 2`). `collect` is a backwards-compatible alias for `gift`.
 */
export function pantyGet(
  state: GameState,
  charaNum: number,
  mode: "drop" | "stolen" | "gift" | "collect",
): GameState {
  const next = cloneGameState(state);
  const chara = next.charas[charaNum];
  if (!chara) return state;
  const pieceId = chara.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0;
  chara.state.EQUIP[EQUIP_SLOT.下半身内衣２] = 0;
  // CFLAG:没穿内裤 (291): 1=removed/stolen, 2=received as a gift.
  const gifted = mode === "gift" || mode === "collect";
  chara.state.CFLAG[CFLAG_ID.没穿内裤] = gifted ? 2 : 1;
  recomputeExposure(chara);
  // Both theft and gift enter PANTS_TEMP; a plain drop does not.
  const hasAuthoredUnderwear = Boolean(charaOutfit(charaNum)?.lowerUnderwear);
  if (mode !== "drop" && (pieceId > 0 || hasAuthoredUnderwear)) {
    acquirePants(next, charaNum, pieceId);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Convenience predicates — useful for downstream H-command gates and for
// the `IS_HALF_DRESSED`/`IS_TOPLESS`/`IS_BOTTOMLESS` read API. These DO NOT
// mutate; they're pure reads over TEQUIP/EQUIP.
// ---------------------------------------------------------------------------

/** `@CHECK_CHARA(ARG, "全裸")` — no worn body clothes at all. */
export function isNaked(chara: CharaSlot): boolean {
  const slots = [
    EQUIP_SLOT.下半身内衣１, EQUIP_SLOT.下半身内衣２,
    EQUIP_SLOT.裤子, EQUIP_SLOT.下身衣服,
    EQUIP_SLOT.上半身内衣１, EQUIP_SLOT.上半身内衣２,
    EQUIP_SLOT.上身衣服１, EQUIP_SLOT.上身衣服２,
    EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服,
    EQUIP_SLOT.レオタード,
  ];
  return slots.every((s) => (chara.state.EQUIP[s] ?? 0) === 0);
}

/** Upper body fully exposed: no tops + no full-body covers. */
export function isTopless(chara: CharaSlot): boolean {
  const slots = [
    EQUIP_SLOT.上半身内衣１, EQUIP_SLOT.上半身内衣２,
    EQUIP_SLOT.上身衣服１, EQUIP_SLOT.上身衣服２,
    EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服,
    EQUIP_SLOT.レオタード,
  ];
  return slots.every((s) => (chara.state.EQUIP[s] ?? 0) === 0);
}

/** Lower body fully exposed: no bottoms + no full-body covers. */
export function isBottomless(chara: CharaSlot): boolean {
  const slots = [
    EQUIP_SLOT.下半身内衣１, EQUIP_SLOT.下半身内衣２,
    EQUIP_SLOT.裤子, EQUIP_SLOT.下身衣服,
    EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服,
    EQUIP_SLOT.レオタード,
  ];
  return slots.every((s) => (chara.state.EQUIP[s] ?? 0) === 0);
}

// ---------------------------------------------------------------------------
// `setEquip` / `getEquip` — small typed accessor pair for downstream code
// (P1-c tequipMul hooks, future P2 换装). Always mutates `EQUIP[slotId]`
// directly; callers needing TEQUIP refresh should call `recomputeExposure`.
// ---------------------------------------------------------------------------

/** Read the piece id in a slot (0 = nothing). Slot name → id via EQUIP_SLOT. */
export function getEquip(chara: CharaSlot, slot: keyof typeof EQUIP_SLOT): number {
  return chara.state.EQUIP[EQUIP_SLOT[slot]] ?? 0;
}

/**
 * Write a piece id into a slot. Positive underwear writes clear the matching
 * removal marker; callers doing a meaningful clothing change should also
 * chain `recomputeExposure(chara)` (exposed separately for batch writers).
 */
export function setEquip(
  chara: CharaSlot,
  slot: keyof typeof EQUIP_SLOT,
  pieceId: number,
): void {
  const slotId = EQUIP_SLOT[slot];
  chara.state.EQUIP[slotId] = pieceId;
  if (pieceId <= 0) return;

  if (slotId === EQUIP_SLOT.下半身内衣１ || slotId === EQUIP_SLOT.下半身内衣２) {
    chara.state.CFLAG[CFLAG_ID.没穿内裤] = 0;
  }
  if (slotId === EQUIP_SLOT.上半身内衣１ || slotId === EQUIP_SLOT.上半身内衣２) {
    writeTequip(chara, TEQUIP_ID.上半身裸露状態, 0);
    writeTequip(chara, TEQUIP_ID.上衣脱衣完毕, 0);
  }
}

// ---------------------------------------------------------------------------
// Internal: `_resolveUnderwearSlot` — for the two 固有 underwear slots, the
// EQUIP entry is always 0 (they're name-on-chara, not catalog pieces — see
// Phase 0 S5 plan). Helpers downstream (e.g. CAN_半脱 cross-checks) can
// inspect the static outfit for a truth signal. Exported as `hasUnderwear`.
// ---------------------------------------------------------------------------

/** True iff the chara has a unique lower-underwear definition (静的). */
export function hasUniqueUnderwear(charaNum: number, top: boolean): boolean {
  const outfit = charaOutfit(charaNum);
  if (!outfit) return false;
  return top ? Boolean(outfit.upperUnderwear) : Boolean(outfit.lowerUnderwear);
}

// ---------------------------------------------------------------------------
// P2-a: changeClothes — single-slot dress/undress with recompute.
// Wraps setEquip + recomputeExposure in a state-cloning API matching the
// stripBottom/Top pattern. For bulk outfit changes, callers should batch
// setEquip calls and recompute once at the end.
// ---------------------------------------------------------------------------

/**
 * Change one EQUIP slot to `pieceId` (0 = remove). Clones state, writes
 * EQUIP, recomputes TEQUIP:0/1, and returns the new state. For the
 * master's slots, the caller should use `setEquip` + `recomputeExposure`
 * directly (no state.charas[] wrapper).
 */
export function changeClothes(
  state: GameState,
  charaNum: number,
  slot: keyof typeof EQUIP_SLOT,
  pieceId: number,
): GameState {
  const next = cloneGameState(state);
  const chara = next.charas[charaNum];
  if (!chara) return state;
  setEquip(chara, slot, pieceId);
  recomputeExposure(chara);
  return next;
}

// ---------------------------------------------------------------------------
// P2-b: okigaeRestore — restore the chara's default outfit (便装に戻す).
// Reads CHARA_OUTFITS, writes every wear slot back to EQUIP, recomputes
// TEQUIP. No-op for unbundled charas (no outfit data).
// This matches the upstream `@CTRL_CLOTHES_SET "現在衣装の変更_便装"`
// flow: clear all EQUIP → write outfit.wear → CLOTHES_SETTING_TRAIN.
// ---------------------------------------------------------------------------

/**
 * Restore a chara's default outfit (便装). Zeros all current EQUIP slots,
 * then seeds each slot from `CHARA_OUTFITS[charaNum].wear`. No-op for the
 * master (charaNum 0 has no outfit). Returns a new GameState.
 */
export function okigaeRestore(state: GameState, charaNum: number): GameState {
  const next = cloneGameState(state);
  const chara = next.charas[charaNum];
  if (!chara) return state;
  const outfit = charaOutfit(charaNum);
  if (!outfit) return state;

  chara.state.CFLAG[CFLAG_ID.没穿内裤] = 0;
  writeTequip(chara, TEQUIP_ID.上半身裸露状態, 0);
  writeTequip(chara, TEQUIP_ID.上衣脱衣完毕, 0);

  // Clear all known EQUIP slots (22 slots from Equip.csv)
  const allSlots = Object.values(EQUIP_SLOT) as number[];
  for (const slotId of allSlots) {
    chara.state.EQUIP[slotId] = 0;
  }

  // Re-seed from outfit.wear
  for (const [slotName, pieceName] of Object.entries(outfit.wear)) {
    const slotId = EQUIP_SLOT[slotName as keyof typeof EQUIP_SLOT];
    if (slotId === undefined) continue;
    const pieceId = clothingIdByName(slotId, pieceName);
    if (pieceId !== undefined) {
      chara.state.EQUIP[slotId] = pieceId;
    }
  }

  recomputeExposure(chara);
  return next;
}

// ---------------------------------------------------------------------------
// P2-c: equipUnderwear — strip to underwear only (着衣→下着姿).
// Keeps 下半身内衣１/２ and 上半身内衣１/２ (including 固有 underwear),
// strips all outer layers. Mirrors upstream CTRL_CLOTHES_SET "下着姿".
// ---------------------------------------------------------------------------

/** Slots that represent outerwear (stripped when going to underwear-only).
 *  Underwear slots (下半身内衣１/２, 上半身内衣１/２) are implicitly kept. */
const OUTERWEAR_SLOTS: readonly number[] = [
  EQUIP_SLOT.裤子,
  EQUIP_SLOT.下身衣服,
  EQUIP_SLOT.裙子,
  EQUIP_SLOT.上身衣服１,
  EQUIP_SLOT.上身衣服２,
  EQUIP_SLOT.ボディースーツ,
  EQUIP_SLOT.連衣裙,
  EQUIP_SLOT.和服,
  EQUIP_SLOT.レオタード,
];

/**
 * Strip a chara to underwear-only (下着姿). Zeros outerwear slots,
 * keeps underwear. No-op for the master. Returns a new GameState.
 */
export function equipUnderwear(state: GameState, charaNum: number): GameState {
  const next = cloneGameState(state);
  const chara = next.charas[charaNum];
  if (!chara) return state;
  for (const slotId of OUTERWEAR_SLOTS) {
    chara.state.EQUIP[slotId] = 0;
  }
  // This command restores the authored unique underwear along with any
  // catalog underwear retained in EQUIP.
  chara.state.CFLAG[CFLAG_ID.没穿内裤] = 0;
  writeTequip(chara, TEQUIP_ID.上半身裸露状態, 0);
  writeTequip(chara, TEQUIP_ID.上衣脱衣完毕, 0);
  recomputeExposure(chara);
  return next;
}

// ---------------------------------------------------------------------------
// P2-d: Coordinate outfit presets — save/load/clear EQUIP snapshots.
// Mirrors upstream COORDINATE1-99 system (CFLAG:200-230).
// ---------------------------------------------------------------------------

const MAX_COORD = 99;

function ensureCoord(
  state: GameState,
  charaNum: number,
): Record<number, Record<number, number>> {
  let os = (state as any).outfitSets as Record<number, Record<number, Record<number, number>>> | undefined;
  if (!os) os = (state as any).outfitSets = {};
  if (!os[charaNum]) os[charaNum] = {};
  return os[charaNum]!;
}

/** Save current EQUIP to coordinate slot (1-99). Stores only non-zero entries. */
export function saveCoordinate(
  state: GameState,
  charaNum: number,
  coordId: number,
): GameState {
  if (coordId < 1 || coordId > MAX_COORD) return state;
  const next = cloneGameState(state);
  const chara = next.charas[charaNum];
  if (!chara) return state;
  const coords = ensureCoord(next, charaNum);
  const snap: Record<number, number> = {};
  for (const [k, v] of Object.entries(chara.state.EQUIP)) {
    if (v !== 0 && v !== undefined) snap[Number(k)] = v;
  }
  coords[coordId] = snap;
  return next;
}

/** Restore EQUIP from coordinate slot. Zeros current, writes saved, recomputes TEQUIP. */
export function loadCoordinate(
  state: GameState,
  charaNum: number,
  coordId: number,
): GameState {
  const next = cloneGameState(state);
  const chara = next.charas[charaNum];
  if (!chara) return state;
  const os = (next as any).outfitSets as Record<number, Record<number, Record<number, number>>> | undefined;
  const snap = os?.[charaNum]?.[coordId];
  if (!snap) return state;
  for (const k of Object.keys(chara.state.EQUIP)) chara.state.EQUIP[Number(k)] = 0;
  for (const [k, v] of Object.entries(snap)) chara.state.EQUIP[Number(k)] = v;
  recomputeExposure(chara);
  return next;
}

/** Delete a coordinate slot. No-op if empty. */
export function clearCoordinate(
  state: GameState,
  charaNum: number,
  coordId: number,
): GameState {
  const next = cloneGameState(state);
  const os = (next as any).outfitSets as Record<number, Record<number, Record<number, number>>> | undefined;
  if (os?.[charaNum]) delete os[charaNum]![coordId];
  return next;
}

// ---------------------------------------------------------------------------
// SHOP [161] 重置服装 — modern equivalent of `RESET_ALL_CLOTHES`
// (`eratw-sub-modding-main/ERB/衣服/CLOTHES.ERB:707-718`). For every NPC,
// call `okigaeRestore` (P2-b: clear EQUIP + re-seed from CHARA_OUTFITS +
// recomputeExposure), then wipe all stored coordinate 1-99 snapshots.
//
// **Master is excluded** (charaNum 0 has no `CHARA_OUTFITS` entry —
// `load-chara.ts:121` returns empty equip/tequip for unbundled chara). Per
// `CLOTHES-PLAN.md` Phase 0 posture, master outfit data is deferred to P3
// (全角色全目录). The upstream FOR loop includes charaNum 0; modern
// intentionally deviates and UI labels "主角不参与重置".
// ---------------------------------------------------------------------------

/** Reset every NPC's outfit to default + clear all coordinate snapshots.
 *  Returns the cloned state plus counts (master excluded). */
export function resetAllClothes(
  state: GameState,
): { next: GameState; resetNpcs: number; resetCoords: number } {
  let next = state;
  let resetNpcs = 0;
  for (const charaNum of Object.keys(state.charas).map(Number)) {
    if (charaNum <= 0) continue; // master excluded
    next = okigaeRestore(next, charaNum);
    resetNpcs += 1;
  }
  const os = (next as any).outfitSets as
    | Record<number, Record<number, Record<number, number>>>
    | undefined;
  let resetCoords = 0;
  if (os) {
    for (const charaNum of Object.keys(os).map(Number)) {
      if (charaNum <= 0) continue;
      for (const _coordId of Object.keys(os[charaNum]!)) resetCoords += 1;
      os[charaNum] = {};
    }
    (next as any).outfitSets = os;
  }
  return { next, resetNpcs, resetCoords };
}
