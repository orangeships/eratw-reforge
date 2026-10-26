/** Current H state adapter. TEQUIP/TCVAR remain the saved authority; history
 * and TrainingSession booleans are never used to infer a live relation. */
import type { GameState } from "./game-state.js";
import { CFLAG_ID, TALENT_ID, TCVAR_ID, TEQUIP_ID } from "./settlement.js";
import { readTequip, readTequipOptional } from "./tequip.js";
import { getHBodyStats } from "./h-body-stats.js";
import { showTop, showBottom } from "./clothing.js";
import { listTouches, readCurrentTouchPose, TOUCH_COMPONENT, TOUCH_PART } from "./touch-state.js";
import { hPoseLabel } from "./h-pose-label.js";

export type HInsertionSite = "v" | "a";
export const H_INSERTION_FIELDS = {
  v: { tequip: TEQUIP_ID.Ｖ性交, tcvar: TCVAR_ID.V挿入管理 },
  a: { tequip: TEQUIP_ID.Ａ性交, tcvar: TCVAR_ID.A挿入管理 },
} as const;

export type HInsertionRelation =
  | { status: "none" }
  | { status: "unknown" }
  | { status: "active"; actor_id: number; receiver_id: number; bilateral: boolean };

/** Explicit -1 is withdrawal, explicit 0 is PLAYER. Missing is not zero.
 * Old one-sided links are readable, but only bilateral links can settle a
 * continuation. Contradictory or unsupported multi-character links fail closed. */
export function readHInsertionRelation(
  state: Readonly<GameState>, target: number, site: HInsertionSite,
): HInsertionRelation {
  const slot = state.charas[target];
  if (!slot || target <= 0) return { status: "unknown" };
  const { tequip, tcvar } = H_INSERTION_FIELDS[site];
  const receiver = slot.state.TCVAR[tcvar];
  const playerReceiver = state.master.state.TCVAR[tcvar];
  const link = readTequipOptional(slot, tequip);
  const reciprocal = readTequipOptional(state.master, tequip);
  const bilateral = reciprocal === target && (link === 0 || receiver === target && link === target);
  const forward = (): HInsertionRelation => ({ status: "active", actor_id: 0, receiver_id: target, bilateral });
  const reverse = (): HInsertionRelation => ({ status: "active", actor_id: target, receiver_id: 0, bilateral });
  const unknown = (): HInsertionRelation => ({ status: "unknown" });

  // Bounded reverse writer: retain the pre-existing target-side actor marker
  // for authored predicates. The player-side receiver marker is explicit in
  // new writes, and missing in old saves. Other positive actors are unsupported.
  if (receiver === target && link === target && reciprocal === target &&
      (playerReceiver === undefined || playerReceiver === target)) {
    return reverse();
  }
  if (receiver !== undefined && receiver !== -1 && receiver !== 0) return unknown();
  if (playerReceiver === target) {
    if (receiver === 0 || link !== undefined && link !== 0 || reciprocal !== undefined && reciprocal !== target) return unknown();
    return reverse();
  }
  if (receiver === 0) {
    if (link !== undefined && link !== 0 || reciprocal !== undefined && reciprocal !== target) return unknown();
    return forward();
  }
  if (receiver === -1) {
    return link === 0 || reciprocal === target ? unknown() : { status: "none" };
  }
  if (link === 0) return reciprocal !== undefined && reciprocal !== target ? unknown() : forward();
  if (link !== undefined && link >= 0) return unknown();
  if (reciprocal === target) return link === undefined ? forward() : unknown();
  return { status: "none" };
}

export function isPlayerHInsertionActive(state: Readonly<GameState>, target: number, site: HInsertionSite): boolean {
  const relation = readHInsertionRelation(state, target, site);
  return relation.status === "active" && relation.actor_id === 0 && relation.receiver_id === target;
}

/** Compatibility mirrors are outputs of the authority, never inputs. */
export function refreshHInsertionSession(state: GameState): void {
  const session = state.training;
  if (!session) return;
  session.vInserted = isPlayerHInsertionActive(state, session.target, "v");
  session.aInserted = isPlayerHInsertionActive(state, session.target, "a");
}

/** Import the old booleans-only envelope once, only when all relation fields
 * are missing. A withdrawal sentinel or conflicting link must never resurrect. */
export function restoreLegacyHInsertionSession(state: GameState): void {
  const session = state.training;
  const slot = session && state.charas[session.target];
  if (!session || !slot) return;
  for (const site of ["v", "a"] as const) {
    const { tequip, tcvar } = H_INSERTION_FIELDS[site];
    if (!(site === "v" ? session.vInserted : session.aInserted)) continue;
    if ([slot.state.TEQUIP[tequip], state.master.state.TEQUIP[tequip],
      slot.state.TCVAR[tcvar], state.master.state.TCVAR[tcvar]].some((value) => value !== undefined)) continue;
    slot.state.TEQUIP[tequip] = 0;
    state.master.state.TEQUIP[tequip] = session.target;
    slot.state.TCVAR[tcvar] = 0;
    state.master.state.TCVAR[tcvar] = -1;
  }
  refreshHInsertionSession(state);
}

const DEVICES = [
  [TEQUIP_ID.陰蒂夾, "clitoral-clip", "c"],
  [TEQUIP_ID.乳頭夾, "nipple-clips", "b"],
  [TEQUIP_ID.搾乳機, "milker", "b"],
  [TEQUIP_ID.振動棒, "vibrator", "v"],
  [TEQUIP_ID.肛用振動棒, "anal-vibrator", "a"],
  [TEQUIP_ID.後庭拉珠, "anal-beads", "a"],
  [TEQUIP_ID.浣腸, "enema", "a"],
  [TEQUIP_ID.拡張氣球, "dilation-balloon", "a"],
  [TEQUIP_ID.肛門電極, "anal-electrode", "a"],
] as const;
const COMPONENT_NAMES = new Map<number, string>(Object.entries(TOUCH_COMPONENT).map(([name, id]) => [id, name]));
const PART_NAMES = new Map<number, string>(Object.entries(TOUCH_PART).map(([name, id]) => [id, name]));

/** Read-only snapshot shared with L1. Equipment occupancy, human relations,
 * current contacts and physiological residue are separate facts. */
export function readHCurrentBodyState(state: Readonly<GameState>, target: number) {
  const slot = state.charas[target];
  if (!slot) return undefined;
  const present = slot.location === state.master.location;
  const stats = getHBodyStats(slot.state);
  const pose = readCurrentTouchPose(slot);
  return {
    subject_id: target,
    present,
    insertions: {
      v: present ? readHInsertionRelation(state, target, "v") : { status: "unknown" as const },
      a: present ? readHInsertionRelation(state, target, "a") : { status: "unknown" as const },
    },
    devices: present ? DEVICES.filter(([id]) => readTequip(slot, id) !== 0)
      .map(([equipment_id, kind, site]) => ({ equipment_id, kind, site })) : "unknown" as const,
    sustained_contact: present ? {
      kissing: readTequip(slot, TEQUIP_ID.継続接吻) !== 0,
      nipple_sucking: readTequip(slot, TEQUIP_ID.吸乳头) !== 0,
      breast_rubbing: readTequip(slot, TEQUIP_ID.揉胸) !== 0,
    } : "unknown" as const,
    contacts: present ? listTouches(slot).filter((touch) => touch.depth === 0 && touch.component !== TOUCH_COMPONENT.体位)
      .map(({ component, part }) => ({ subject_part: COMPONENT_NAMES.get(component), other_part: PART_NAMES.get(part) })) : "unknown" as const,
    ...(present && pose > 0 ? { position: { id: pose, label: hPoseLabel(pose) } } : {}),
    clothing: {
      upper: { garment: showTop(slot), displaced: readTequip(slot, TEQUIP_ID.上半身裸露状態) !== 0 },
      lower: { garment: showBottom(slot), displaced: readTequip(slot, TEQUIP_ID.下半身ずらし状態) !== 0 },
    },
    cavities: {
      v: { residue: stats.vaginalSemen, fill_percent: stats.fillV },
      a: { residue: stats.analSemen, fill_percent: stats.fillA },
      uterus: { residue: stats.uterineSemen },
    },
    abdomen: {
      fill_percent: stats.fillTotal,
      pregnant: (slot.state.TALENT[TALENT_ID.妊娠] ?? 0) > 0,
      pregnancy_days: slot.state.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0,
    },
  };
}

export type HCurrentBodyState = NonNullable<ReturnType<typeof readHCurrentBodyState>>;
