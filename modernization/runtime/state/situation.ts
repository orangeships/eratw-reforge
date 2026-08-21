/**
 * `@INFO_SITUATION` — the master's current 处境 tag row (INFO.ERB:1649-1711).
 *
 * The upstream status bar (`@SHOW_STATUS`, INFO.ERB:129) prints one line of
 * short colored tags describing the MASTER's immediate situation before the
 * numeric base rows. Every quantity read here is the master's own, so these
 * tags are master-exclusive:
 *
 *   - `<挑逗中>`            TEQUIP:挑逗モード (id 80)
 *   - `<已锁门>`            FLAG:自室施錠 (id 1021)
 *   - `<和X约会中>`         FLAG:约会的对象 (玩水 variant when SWIMMING)
 *   - `<游泳中>`            TEQUIP:MASTER:SWIMMING (id 900)
 *   - 睡意阶梯              NEMUKE() 两套阈值 (约会中 vs 就寝)
 *   - `<清醒剂・弱/中/强/极>` CFLAG:清醒劑 (id 385) tiers
 *   - `<酒醉・微醺/醉酒/不省人事>` live BASE:酒气 face
 *
 * The modern runtime reads the same state through the established helpers
 * (`nemuke`, `activeDatePartner`/`isDateActive`, `isEquipped`). Deferred
 * (documented, not faked): MOREDATE group dates, OMANEKIBEYA 私人服务/拜访
 * 细分, `自室施錠` write-side (主角自锁房 mechanism not modeled → the tag
 * stays dormant until then).
 */

import type { GameState } from "./game-state.js";
import { nemuke } from "./nemuke.js";
import { CFLAG_ID, FLAG_ID, TEQUIP_ID } from "./settlement.js";
import { isEquipped } from "./tequip.js";
import { activeDatePartner, isDateActive } from "../world/date-session.js";
import { alcoholFace } from "./alcohol.js";

/** Tone for a sleepy tag — maps to a `status-bar__rel--*` color. */
export type SleepinessTone = "orange" | "yellow" | "pale-yellow" | "red";

export type SituationTagKind = "tease" | "lock" | "date" | "swim" | "sleepy" | "coffee" | "alcohol";

export interface SituationTag {
  text: string;
  kind: SituationTagKind;
  /** Present only for `sleepy` tags; drives the tag color. */
  tone?: SleepinessTone;
}

/** `CoffeeEffectCheck` — 清醒剂 effect tier (INFO.ERB:1713-1725). Thresholds
 *  `>240 极 / >180 强 / >120 中 / else 弱`, absent (≤0) → null. */
export function coffeeEffectTier(state: GameState): "弱" | "中" | "强" | "极" | null {
  const v = state.master.state.CFLAG[CFLAG_ID.清醒劑] ?? 0;
  if (v <= 0) return null;
  if (v > 240) return "极";
  if (v > 180) return "强";
  if (v > 120) return "中";
  return "弱";
}

/**
 * `@INFO_SITUATION` 睡意阶梯 (INFO.ERB:1690-1708). Two mutually exclusive
 * ladders with different thresholds:
 *   - on a date away from base (`デート中 != MAIN_MAP`): `>690 马上就得回去了`
 *     (orange) / `>660 非常疲惫了` (yellow) / `>600 累了` (pale-yellow);
 *   - otherwise only past `>720`: `>960 要睡眠` (red) / `>840 睡眠可` (yellow)
 *     / `>720 睡眠可` (pale-yellow).
 */
export function sleepinessSituation(state: GameState): SituationTag | null {
  const n = nemuke(state);
  const onDate = isDateActive(state) && (state.dateSession?.mapId ?? 0) !== 0;
  if (onDate) {
    if (n > 690) return { text: "马上就得回去了", kind: "sleepy", tone: "orange" };
    if (n > 660) return { text: "非常疲惫了", kind: "sleepy", tone: "yellow" };
    if (n > 600) return { text: "累了", kind: "sleepy", tone: "pale-yellow" };
    return null;
  }
  if (n > 720) {
    if (n > 960) return { text: "要睡眠", kind: "sleepy", tone: "red" };
    if (n > 840) return { text: "睡眠可", kind: "sleepy", tone: "yellow" };
    return { text: "睡眠可", kind: "sleepy", tone: "pale-yellow" };
  }
  return null;
}

/** `@INFO_SITUATION` — the master's situation tag row, in upstream order. */
export function situationTags(state: GameState): SituationTag[] {
  const tags: SituationTag[] = [];
  const master = state.master;

  if (isEquipped(master, TEQUIP_ID.挑逗モード)) tags.push({ text: "挑逗中", kind: "tease" });
  if (state.flagStore[FLAG_ID.自室施錠]) tags.push({ text: "已锁门", kind: "lock" });

  const partner = activeDatePartner(state);
  if (partner != null) {
    const name = state.charas[partner]?.callName ?? `#${partner}`;
    const swimming = isEquipped(master, TEQUIP_ID.SWIMMING);
    tags.push({ text: swimming ? `和${name}约会中玩水` : `和${name}约会中`, kind: "date" });
  } else if (isEquipped(master, TEQUIP_ID.SWIMMING)) {
    // 上游 `@INFO_SITUATION` ELSEIF 的 ComPartner 名字细分 defer — plain 游泳中.
    tags.push({ text: "游泳中", kind: "swim" });
  }

  const sleepy = sleepinessSituation(state);
  if (sleepy) tags.push(sleepy);
  const coffee = coffeeEffectTier(state);
  if (coffee) tags.push({ text: `清醒剂・${coffee}`, kind: "coffee" });
  const alcohol = alcoholFace(state, 0);
  if (alcohol !== "清醒") tags.push({ text: `酒醉・${alcohol}`, kind: "alcohol" });
  return tags;
}
