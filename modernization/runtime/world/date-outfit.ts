/**
 * Date outfit lifecycle — modern port of the two upstream costume hooks that
 * `SET_DATE` (ERB/SET_CMN.ERB:302-312, 243-248) calls around a date.
 *
 * Upstream:
 *   - start:  `EX_COSTUME(C_ID, "人里デート")` for MAPID 2, otherwise
 *             `EX_COSTUME(C_ID, "デート")` (SET_CMN.ERB:303-312).
 *             `EX_COSTUME` (衣服/CLOTHES.ERB:833-847) reads the character's
 *             `{TYPE}衣装` chara-data field and returns 0 when the character
 *             has no such outfit — nothing happens for most characters.
 *   - change: `@OKIGAE(C_ID, EX_COS)` (CLOTHES.ERB:851-884) saves
 *             `TCVAR:本来の服装 = CFLAG:基本服装セット` (only if unset), then
 *             sets `CFLAG:基本服装セット = COS_ID` and dispatches on
 *             `CASE 1 TO 套装范围` → `CTRL_CLOTHES_SET(C_ID, "便装の変更_衣装セット", COS_ID)`.
 *   - end:    `IF TCVAR:本来の服装 → OKIGAE(...)` + "换回了原本的衣装"
 *             (SET_CMN.ERB:243-248). Note upstream restores **by set id**, not
 *             by snapshotting the worn pieces — `基本服装セット` is always a set
 *             id, so that is the whole of what `@OKIGAE` preserves.
 *
 * ## Applying a set is a FULL 23-slot replace
 *
 * `@EVENT_设置暂时变更套装` (fromEN/QOL/QOL_CLOTHES_MISC.ERB) shows the write
 * shape shared by every set applier:
 *
 *   FOR LOCAL, 1, 23
 *       EQUIP:C_ID:(LOCAL) = GETMETH_INT(C_ID, "衣装セット", SET_ID, EQUIPNAME:LOCAL)
 *   NEXT
 *   CALL CLOTHES_SETTING_TRAIN(C_ID)
 *
 * `GETMETH_INT` returns 0 for a slot the set does not declare, so every
 * unspecified slot is **cleared**, not left alone. A partial overlay would
 * leave a yukata set wearing the character's everyday hat.
 *
 * ## Per-character F-function variants
 *
 * `GETMETH` dispatches to `@F衣装セットN(ARG, …)` when that function exists
 * (`fromEN/QOL/QOL_CLOTHES_MISC.ERB:52` passes the character through), and to
 * the plain `@衣装セットN` — the table `outfit-sets.generated.ts` holds —
 * when it does not. All 122 sets ship an F function but only three of the
 * twelve reachable from a date actually *branch*; those are ported in
 * `./outfit-f-variants.ts` and merged in by {@link applyOutfitSet}.
 */

import type { GameState } from "../state/game-state.js";
import { CFLAG_ID, TCVAR_ID } from "../state/settlement.js";
import { charaDataOf } from "../state/chara-data.js";
import { recomputeExposure } from "../state/clothing-write.js";
import { OUTFIT_SETS } from "../state/outfit-sets.generated.js";
import { fVariantPieces } from "./outfit-f-variants.js";
import {
  resolveConditionalDateOutfit,
  type DateOutfitKind,
  type DateOutfitRng,
} from "./date-outfit-resolvers.js";

/** Upstream MAPID 2 = 人間之里, the one date map with its own outfit field. */
const VILLAGE_DATE_MAP_ID = 2;

/** `FOR LOCAL, 1, 23` — the widest EQUIP slot id in CSV/Equip.csv. Applying a
 *  set walks the whole range so unspecified slots clear (see file header). */
const MAX_EQUIP_SLOT = 23;

/**
 * Resolve the 套装 id a character wears for a date on `mapId`, or `undefined`
 * when they declare no date outfit — the common upstream case, since the vast
 * majority of `Chara_data_*.ERB` files have no `デート衣装` arm.
 *
 * Two sources, in upstream order: the folded `chara-data.bundle.json` field
 * first, then `date-outfit-resolvers.ts` for the three characters whose
 * declaration is a branch. The bundle wins when both exist, which is why the
 * build script emits no field for those three.
 */
export function dateOutfitSetFor(
  charaNum: number,
  mapId: number,
  state?: Readonly<GameState>,
  rng?: DateOutfitRng,
): number | undefined {
  const kind: DateOutfitKind = mapId === VILLAGE_DATE_MAP_ID ? "village" : "date";
  const field = kind === "village" ? "villageDateOutfitSet" : "dateOutfitSet";

  const declared = charaDataOf(charaNum)?.[field];
  if (typeof declared === "number" && Number.isInteger(declared) && declared > 0) {
    return declared;
  }
  if (state && rng) return resolveConditionalDateOutfit(charaNum, kind, state, rng);
  return undefined;
}

/**
 * Write a 套装's pieces into `EQUIP`, clearing every slot the set does not
 * declare, then rebuild the TEQUIP exposure bitmasks
 * (`@CLOTHES_SETTING_TRAIN`, mirrored by `recomputeExposure`).
 *
 * `@F衣装セットN` variants (see `./outfit-f-variants.ts`) are merged over the
 * base table first, matching `GETMETH`'s F-then-plain dispatch.
 *
 * Returns false for an unknown set id — an unmodelled set must not silently
 * strip the character.
 */
export function applyOutfitSet(state: GameState, charaNum: number, setId: number): boolean {
  const chara = state.charas[charaNum];
  const set = OUTFIT_SETS[setId];
  if (!chara || !set) return false;
  const overrides = fVariantPieces(setId, state);
  for (let slot = 1; slot <= MAX_EQUIP_SLOT; slot++) {
    const piece = overrides?.[slot] ?? set.pieces[slot] ?? 0;
    chara.state.EQUIP[slot] = piece;
  }
  recomputeExposure(chara);
  return true;
}

/**
 * Upstream `EX_COSTUME` on date start. Returns true when the character's
 * outfit actually changed, so callers can emit the upstream
 * "%CALLNAME 为约会专门打扮了" line.
 */
export function applyDateOutfit(
  state: GameState,
  partnerNum: number,
  mapId: number,
  rng?: DateOutfitRng,
): boolean {
  const partner = state.charas[partnerNum];
  if (!partner) return false;
  const setId = dateOutfitSetFor(partnerNum, mapId, state, rng);
  // Upstream `SIF !EX_COS / RETURN` — characters without a date outfit are
  // left alone and never enter the 本来の服装 restore path.
  if (setId === undefined) return false;
  const current = partner.state.CFLAG[CFLAG_ID.基本服装SET] ?? 0;
  if (current === setId) return false;
  // `@OKIGAE` records the pre-change set so the end-of-date branch can undo it.
  if ((partner.state.TCVAR[TCVAR_ID.本来の服装] ?? 0) === 0) {
    partner.state.TCVAR[TCVAR_ID.本来の服装] = current;
  }
  if (!applyOutfitSet(state, partnerNum, setId)) return false;
  partner.state.CFLAG[CFLAG_ID.基本服装SET] = setId;
  return true;
}

/**
 * Upstream end-of-date restore. Returns true when an outfit was restored, so
 * callers can emit "换回了原本的衣装". Clearing `TCVAR:本来の服装` matches
 * upstream and keeps a later re-date from restoring a stale set.
 */
export function restoreDateOutfit(state: GameState, partnerNum: number): boolean {
  const partner = state.charas[partnerNum];
  if (!partner) return false;
  const original = partner.state.TCVAR[TCVAR_ID.本来の服装] ?? 0;
  if (original === 0) return false;
  if (original > 0) {
    if (!applyOutfitSet(state, partnerNum, original)) return false;
    partner.state.CFLAG[CFLAG_ID.基本服装SET] = original;
  }
  partner.state.TCVAR[TCVAR_ID.本来の服装] = 0;
  return true;
}
