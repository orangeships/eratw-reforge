/**
 * `@DATE_EVENT` (ERB/イベント関連/DATE_CMN.ERB:99-236) — the date settlement.
 *
 * This is the part of a date that actually changes the world. Upstream runs it
 * per partner from `从外面回家` **before** the date mirrors are cleared, scored by
 * `@DATE_EVENT_CHECKSUM`, whose result selects one of five mutually exclusive
 * branches:
 *
 *   1. `SP_EVENT 1` + `ADD_KISS` — first kiss on a date (mutual-virgin gate);
 *      `TCVAR:中止接吻` lets the kojo veto it.
 *   2. 反感刻印 decrement — needs `DATE_SCORE > 50` plus half of what the next
 *      亲密 level demands in 宝珠/経験.
 *   3. `@DATE_EVENT_CONFESSION` — 告白 → 恋人 (master has no lover, 告白禁止 off,
 *      `CAN_MAKE_恋人()` passes).
 *   4. `@GIFT` (Christmas present) / `@GIFT_DATE_EVENT` (post-date gift).
 *   5. Fallback `SP_EVENT 3`.
 *
 * Documented deviations (not silent):
 *   - `EGG_GIFT_DATE_EVENT` returns immediately unless
 *     `FLAG:USE_EXPANDED_PREGNANCY_OPTIONS` (Add_PregnancyTypes.ERB) — an
 *     option the modern runtime does not have, so the egg arm is inert here for
 *     the same reason it is inert upstream without that DLC.
 *   - `GIFT_DATE_EVENT` is ported (`./date-gift.ts`), including the
 *     `@CREATE_GIFT_FROM_CHARA` score-window retry and the chara → master
 *     record direction; its bounded-retry divergence is documented there.
 *   - `DATE_EVENT_CONFESSION` answers its `ASK_YN` deterministically. Upstream
 *     offers 接受/拒绝; the modern runtime's synchronous command shape has no
 *     mid-handler input, so the accepted arm settles here and the refusal arm is
 *     reachable through the refusal kojo (`SP_EVENT 2` arg 2) when the partner
 *     is hostile.
 *   - The forced-end path (`デート終了タイムアップ処理`) calls `SET_DATE`
 *     **without** `DATE_EVENT`, so it must not call {@link runDateEvent}.
 */

import type { GameState, CharaSlot, CharaSlotState } from "../state/game-state.js";
import { createGiftFromChara, dateGiftNarration, recordCharaGift } from "./date-gift.js";
import type { Rng } from "../command/types.js";
import type { ObservationEvent } from "../../schemas/types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  MARK_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../state/settlement.js";
import { getPalamLv } from "../state/palam-level.js";
import { expDemandPattern0, juelDemandPattern0, juelOf } from "../state/juel.js";
import { addKiss } from "../state/kiss.js";
import { applyRelationshipDelta } from "../state/relationship.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";
import { canMakeLover } from "../state/lover.js";
import { hasItem, ITEM_ID, removeItem } from "../state/items.js";
import { getTflag, TFLAG_ID } from "../state/tflag.js";

/** `CFLAG:约会後イベントフラグ` (ERB/Headers/AutoConst_CFLAG.ERH:13). */
const DATE_AFTER_EVENT_FLAG = 13;

/** `CFLAG:既成事実` bit 2 = 恋人 (kojo symbol `合意_恋人`). */
const LOVER_BIT = 1 << 2;

/** Upstream enumerates `JUEL_DEMAND(9, pattern, …)` for patterns 0..3. Only the
 *  pattern-0 ladder is modeled (`juelDemandPattern0`); patterns 1..3 return the
 *  -1 "unsupported pattern" sentinel, which upstream treats as `CONTINUE` and
 *  which {@link meetsHalfDemand} therefore folds into a single pass. */

export interface DateEventContext {
  now: () => number;
  rng: Rng;
  dialogueRouter?: {
    resolveSpEventKojo?: (
      charaNum: number,
      subid: number,
      state: Readonly<GameState>,
      rng: Rng,
      extra: number[],
    ) => Array<{ text: string; form?: string }> | undefined;
  };
}

const talent = (st: CharaSlotState, id: number): number => st.TALENT[id] ?? 0;
const mark = (st: CharaSlotState, id: number): number => st.MARK[id] ?? 0;
const base = (st: CharaSlotState, id: number): number => st.BASE[id] ?? 0;
const exp = (st: CharaSlotState, id: number): number => st.EXP[id] ?? 0;
const abl = (st: CharaSlotState, id: number): number => st.ABL[id] ?? 0;
const palam = (st: CharaSlotState, id: number): number => st.PALAM[id] ?? 0;

/**
 * `@DATE_EVENT_CHECKSUM` (DATE_CMN.ERB:201-217) — the "good atmosphere" score
 * that selects the settlement branch. Pure function of the partner's state.
 */
export function dateEventChecksum(state: Readonly<GameState>, partnerNum: number): number {
  const st = state.charas[partnerNum]?.state;
  if (!st) return 0;
  let local = mark(st, MARK_ID.不埒刻印) * 10 + mark(st, MARK_ID.快楽刻印) * 10;
  if (talent(st, TALENT_ID.恋慕) !== 0) {
    local += Math.min(abl(st, ABL_ID.親密) * 10, 100)
      + Math.min(abl(st, ABL_ID.欲望) * 10, 100)
      + Math.min(abl(st, ABL_ID.奉仕精神) * 10, 100);
    local += Math.min(exp(st, EXP_ID.デート経験), 100)
      + Math.min(exp(st, EXP_ID.愛情経験), 100);
  } else if (talent(st, TALENT_ID.思慕) !== 0) {
    local += Math.min(abl(st, ABL_ID.親密) * 10, 50)
      + Math.min(abl(st, ABL_ID.欲望) * 10, 50)
      + Math.min(abl(st, ABL_ID.奉仕精神) * 10, 50);
    local += Math.min(exp(st, EXP_ID.デート経験), 50);
  }
  local += getPalamLv(palam(st, PALAM_ID.欲情), 10) * 5
    + getPalamLv(palam(st, PALAM_ID.好意), 10) * 5
    + getPalamLv(palam(st, PALAM_ID.恭順), 10) * 5;
  local += Math.trunc(base(st, BASE_ID.ムード) / 50)
    + Math.trunc((1000 - base(st, BASE_ID.理性)) / 30);
  local += talent(st, TALENT_ID.度胸) * 10
    + talent(st, TALENT_ID.性的興味) * 10
    - talent(st, TALENT_ID.自制心) * 10
    - talent(st, TALENT_ID.無関心) * 10;
  return local;
}

/**
 * `GIFT_DATE_CHECK` (イベント関連/贈り物関連/贈り物.ERB:684-724). The gate is
 * ported faithfully so branch selection matches upstream even though the gift
 * generator behind it is deferred.
 */
function giftDateCheck(
  state: Readonly<GameState>,
  partnerNum: number,
  rng: Rng,
  festival: boolean,
): boolean {
  const st = state.charas[partnerNum]?.state;
  if (!st) return false;
  const cap = festival ? 100 : 80;
  if (talent(st, TALENT_ID.路人) !== 0) return false;
  if (mark(st, MARK_ID.反発刻印) !== 0) return false;
  if (talent(st, TALENT_ID.心情) < 0) return false;
  if ((st.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0) return false;
  if (base(st, BASE_ID.情緒) < 1200) return false;
  let rate = (abl(st, ABL_ID.親密) - 4) * 5;
  if (festival) rate = Math.trunc(rate * 1.5);
  if (talent(st, TALENT_ID.恋人) !== 0) rate = Math.trunc(rate * 1.5);
  return Math.min(rate, cap) > rng.int(100);
}

/**
 * Upstream reads the 宝珠 bank with `JUEL:(ARG):(LOCAL:1)`, and
 * `JUEL_DEMAND_9` (親密) prices its level in `PALAM_ID.好意` — i.e. upstream
 * slot 20 of `JUEL` *is* 好感度. This runtime keeps `JUEL` and `PALAM` in
 * separate namespaces, so the demand check has to read 好意 from the `PALAM`
 * side to observe the same quantity.
 */
function demandValue(st: CharaSlotState, juelId: number): number {
  if (juelId === PALAM_ID.好意) return palam(st, PALAM_ID.好意);
  return juelOf(st, juelId);
}

/**
 * Half-of-demand check for the 反感刻印 branch (DATE_CMN.ERB:138-168): the
 * partner must hold at least half of every 宝珠 and 経験 the next 亲密 level
 * asks for. Upstream iterates demand patterns 0..3; only pattern 0 is modeled
 * and the others return the -1 sentinel that upstream `CONTINUE`s on.
 */
function meetsHalfDemand(st: CharaSlotState): boolean {
  const gate = juelDemandPattern0(st, false, ABL_ID.親密, 0);
  if (gate === -2) return false;
  if (gate < 0) return false;
  for (let juelId = 0; juelId < 100; juelId += 1) {
    const need = juelDemandPattern0(st, false, ABL_ID.親密, juelId);
    if (need > 0 && demandValue(st, juelId) < need / 2) return false;
  }
  for (let expId = 0; expId < 100; expId += 1) {
    const need = expDemandPattern0(st, ABL_ID.親密, abl(st, ABL_ID.親密), expId);
    if (need > 0 && exp(st, expId) < need / 2) return false;
  }
  return true;
}

function spEvent(
  ctx: DateEventContext,
  partnerNum: number,
  state: Readonly<GameState>,
  subid: number,
  extra: number[],
): ObservationEvent[] {
  const lines = ctx.dialogueRouter?.resolveSpEventKojo?.(partnerNum, subid, state, ctx.rng, extra);
  if (!lines || lines.length === 0) return [];
  const now = ctx.now();
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: now,
    charaNum: partnerNum,
    text: line.text,
    form: line.form,
  }));
}

function narration(ctx: DateEventContext, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: ctx.now(), text };
}

/**
 * `@GIFT` (DATE_CMN.ERB:238-278) — the Christmas present arm. Fires on Dec 24
 * while the partner was 好感度-positive before the date and ITEM:94 is held.
 */
function runChristmasGift(
  state: GameState,
  partner: CharaSlot,
  ctx: DateEventContext,
): { events: ObservationEvent[]; given: boolean } {
  const st = partner.state;
  const name = partner.callName ?? `#${partner.charaNum}`;
  const before = getTflag(state, TFLAG_ID.约会前好感度);
  const favorRise = (st.CFLAG[CFLAG_ID.好感度] ?? 0) - before;
  if (!hasItem(state, ITEM_ID.聖誕禮物) || favorRise <= 0) {
    return { events: [], given: false };
  }
  const events: ObservationEvent[] = [
    narration(ctx, `要送出圣诞礼物吗？把礼物送给了${name}。`),
  ];
  let rating: number;
  if (talent(st, TALENT_ID.恋人) !== 0) {
    events.push(narration(ctx, `能看见${name}的变得一片通红`));
    events.push(narration(ctx, "……得到了对脸颊的一吻作为回礼"));
    rating = 10;
  } else if (talent(st, TALENT_ID.恋慕) !== 0) {
    events.push(narration(ctx, `能看见${name}的变得一片通红`));
    events.push(narration(ctx, `受到礼物的${name}感觉非常幸福`));
    rating = 7;
  } else if (talent(st, TALENT_ID.思慕) !== 0) {
    events.push(narration(ctx, `${name}惊讶之余很开心的接受了`));
    events.push(narration(ctx, `面对表示好意的礼物、更加在意起${state.master.callName ?? "你"}了`));
    rating = 5;
  } else {
    events.push(narration(ctx, `${name}因为受到的高价礼物显得有些不知所措、不过并没有讨厌`));
    rating = 2;
  }
  removeItem(state, ITEM_ID.聖誕禮物, 1);
  applyRelationshipDelta(state, partner.charaNum, (favorRise * rating) / 5, (favorRise * rating) / 10);
  return { events, given: true };
}

/**
 * `@GIFT_DATE_EVENT` (贈り物.ERB:728-780) — the partner hands the player a
 * gift on the way home. Falls back to `SP_EVENT 3` when
 * `@CREATE_GIFT_FROM_CHARA` exhausts its retries (upstream's `RESULT == -1`).
 */
function runPostDateGift(
  state: GameState,
  partner: CharaSlot,
  ctx: DateEventContext,
): ObservationEvent[] {
  const gift = createGiftFromChara(state, partner.charaNum, ctx.rng);
  if (!gift) return spEvent(ctx, partner.charaNum, state, 3, [0]);
  recordCharaGift(state, partner.charaNum, gift, state.time.dayIndex, 0);
  return [
    narration(ctx, dateGiftNarration(partner)),
    narration(ctx, `得到了「${gift.name}」。`),
  ];
}

/** `@DATE_EVENT_CONFESSION` (DATE_CMN.ERB:219-236). */
function runConfession(
  state: GameState,
  partner: CharaSlot,
  ctx: DateEventContext,
): ObservationEvent[] {
  const name = partner.callName ?? `#${partner.charaNum}`;
  const events = spEvent(ctx, partner.charaNum, state, 2, [0]);
  events.push(narration(ctx, `对${name}的告白…`));
  const authority = deriveRelationshipAuthority(partner, state.master, state);
  if (authority.angry) {
    events.push(...spEvent(ctx, partner.charaNum, state, 2, [2]));
    return events;
  }
  partner.state.CFLAG[CFLAG_ID.既成事実] =
    (partner.state.CFLAG[CFLAG_ID.既成事実] ?? 0) | LOVER_BIT;
  state.master.state.CFLAG[CFLAG_ID.既成事実] =
    (state.master.state.CFLAG[CFLAG_ID.既成事実] ?? 0) | LOVER_BIT;
  state.master.state.TALENT[TALENT_ID.恋人] = partner.charaNum;
  partner.state.TALENT[TALENT_ID.恋人] = 1;
  partner.state.CFLAG[DATE_AFTER_EVENT_FLAG] =
    (partner.state.CFLAG[DATE_AFTER_EVENT_FLAG] ?? 0) | 1;
  events.push(...spEvent(ctx, partner.charaNum, state, 2, [1]));
  events.push(narration(ctx, `与${name}成为了恋人`));
  return events;
}

/**
 * Run the upstream date settlement for one partner. Mutates `state` in place
 * and returns the events to append to the command transcript.
 */
export function runDateEvent(
  state: GameState,
  partnerNum: number,
  ctx: DateEventContext,
): ObservationEvent[] {
  const partner = state.charas[partnerNum];
  if (!partner) return [];
  const st = partner.state;
  const name = partner.callName ?? `#${partnerNum}`;
  const score = dateEventChecksum(state, partnerNum);
  const afterEvent = st.CFLAG[DATE_AFTER_EVENT_FLAG] ?? 0;
  const festival = false; // `FESTIVAL()` — no festival calendar is modeled yet.

  // ── arm 1: Christmas present (`CALL GIFT` + `RESULT == 1`) ────────────────
  const christmas = runChristmasGift(state, partner, ctx);
  if (christmas.given) return christmas.events;

  // ── arm 2: first kiss on a date ──────────────────────────────────────────
  if (talent(st, TALENT_ID.キス未経験) !== 0 && (afterEvent & 1) === 0) {
    const line = 220
      + talent(st, TALENT_ID.一線越えない) * 30
      + Math.abs(talent(st, TALENT_ID.キス未経験) * 20);
    // Upstream reads `CFLAG:ARG:合意判定` directly; this runtime treats that
    // slot as derived, so read it through the canonical authority accessor.
    const consent = deriveRelationshipAuthority(partner, state.master, state).consentJudgement;
    const eligible = score > line
      && consent > 180
      && (talent(st, TALENT_ID.恋慕) !== 0 || talent(st, TALENT_ID.思慕) !== 0);
    const events: ObservationEvent[] = [];
    if (eligible) {
      events.push(...spEvent(ctx, partnerNum, state, 1, [score]));
      if ((st.TCVAR[TCVAR_ID.中止接吻] ?? 0) === 0) {
        addKiss(state, partner, 1);
        st.CFLAG[DATE_AFTER_EVENT_FLAG] = (st.CFLAG[DATE_AFTER_EVENT_FLAG] ?? 0) & ~1;
      }
    } else if (mark(st, MARK_ID.反発刻印) === 0) {
      events.push(...spEvent(ctx, partnerNum, state, 3, [0]));
    }
    st.EXP[EXP_ID.愛情経験] = (st.EXP[EXP_ID.愛情経験] ?? 0) + 10;
    return events;
  }

  // ── arm 3: 反感刻印 decrement ───────────────────────────────────────────
  if (mark(st, MARK_ID.反発刻印) !== 0 && score > 50) {
    if (meetsHalfDemand(st)) {
      const before = mark(st, MARK_ID.反発刻印);
      st.MARK[MARK_ID.反発刻印] = before - 1;
      const events = spEvent(ctx, partnerNum, state, 3, [before, score]);
      events.push(narration(
        ctx,
        before - 1 > 0
          ? `${name}的反感刻印LV下降为${before - 1}了`
          : `${name}失去了反感刻印LV1`,
      ));
      return events;
    }
    return [];
  }

  // ── arm 4: confession ────────────────────────────────────────────────────
  const canConfess = ((state.master.state.CFLAG[CFLAG_ID.既成事実] ?? 0) & LOVER_BIT) === 0
    && (afterEvent & 2) === 0
    && (state.flagStore[FLAG_ID.告白禁止] ?? 0) === 0
    && canMakeLover(state);
  if (canConfess) {
    if (score > 530 + talent(st, TALENT_ID.一線越えない) * 20) {
      return runConfession(state, partner, ctx);
    }
    // `GIFT_DATE_EVENT` — confession-capable but below the threshold.
    if (giftDateCheck(state, partnerNum, ctx.rng, festival)) {
      return runPostDateGift(state, partner, ctx);
    }
    // `EGG_GIFT_DATE_EVENT` needs `FLAG:USE_EXPANDED_PREGNANCY_OPTIONS`
    // (Add_PregnancyTypes.ERB), an option the modern runtime does not have, so
    // the egg arm is inert here for the same reason it is inert upstream
    // without that DLC; execution falls through to `ELSEIF !反発刻印`.
    if (mark(st, MARK_ID.反発刻印) === 0) {
      return spEvent(ctx, partnerNum, state, 3, [0]);
    }
    return [];
  }

  // ── arm 5: post-date gift, else fallback ────────────────────────────────
  if (giftDateCheck(state, partnerNum, ctx.rng, festival)) {
    return runPostDateGift(state, partner, ctx);
  }
  return spEvent(ctx, partnerNum, state, 3, [0]);
}
