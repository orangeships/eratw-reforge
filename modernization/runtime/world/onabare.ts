/**
 * ONABARE — masturbation-exposure event (`@ONABARE`, NASIKUZUSI.ERB).
 *
 * Fired from COMF697 部屋を訪ねる when the 积攒度 gate rolls true: the master
 * catches a chara masturbating and picks one of three reactions. This is the
 * full three-branch port:
 *
 *   失礼了 (away)     — apologize + leave; the chara's 被掌握把柄 (leverage)
 *                       is caught. オナバレ=1, TIME += 5.
 *   继续看 (watch)    — keep watching to the end; オナバレ=3, favor/trust
 *                       deltas, 露出快楽/自慰 EXP, 恥情/欲情 jewels,
 *                       TIME += 27.
 *   两个人一起 (join) — propose doing it together; gated on 合意判定 vs
 *                       無崩し必要値. Success → NASIKUZUSI consensual H
 *                       (オナバレ=2, 积攒度=0, TIME += 回数*20). Refusal →
 *                       被赶出去 (オナバレ=1, 被掌握把柄=1, GET_ANGRY, TIME+5).
 *
 * The three-way menu is a player choice (the 697 handler's stagedPrompt), so
 * this module takes the chosen branch and only uses `rng` for internal rolls
 * (NASIKUZUSI 回数/前戯/体位 selection). No rng is consumed for the branch.
 *
 * **Deferred (documented, faithful to plan)**:
 *   - ONABARE_HOLE / ONABARE / EVENT 26 personal kojo (`KOJO_MESSAGE_SEND`) is
 *     dispatched through the EVENT 26 arm via `resolveEventKojoAndApply` when
 *     a router is present; the dedicated `ONABARE` kojo function type is NOT
 *     parsed yet (falls back to canned narration).
 *   - `PrintOnanismImage` / `SHOW_LOVEPOWER` / `SHOW_REASONWALL` visual layers.
 *   - ASK_DIARY diary writes.
 *   - `PANTS_GET` panty souvenir (master-date home).
 *   - NASIKUZUSI's per-position authored prose + SET_HISTORY_LOST_V/A virgin
 *     loss *histories* (the 处女/尻穴喪失記念日 stamps are written).
 *   - `どうぞそのまま好感度上昇値` 恋慕/性格別 prose ladder is condensed.
 */
import type { GameState, CharaSlot } from "../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  EXP_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
} from "../state/settlement.js";
import type { Rng } from "../command/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import type { ObservationEvent } from "../../schemas/types.js";
import { computeAttitude, deriveRelationshipAuthority, isOtokoGirai } from "../state/attitude.js";
import { juelUpSpecial } from "../state/juel.js";
import { getAngry } from "../command/source-check.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";
import { dateOf } from "./calendar.js";
import { depositEjaculate, ejaculateAmount } from "./semen-residue.js";
import { setTflagBit, TFLAG_ID } from "../state/tflag.js";

export type OnabareChoice = "away" | "watch" | "join";

/** Router only drives EVENT-26 kojo; `undefined` (legacy/test) falls back to
 *  canned narration events. */
export interface OnabareDeps {
  rng: Rng;
  dialogueRouter?: DialogueRouter;
}

/** `HAS_PENIS(slot)` — TALENT:性別 bit 1 (same test as daily-event.ts:163). */
function hasPenis(slot: CharaSlot): boolean {
  return ((slot.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
}

function narration(state: GameState, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: state.time.tickValue, text };
}

/** Small structured replacement for SET_FIRSTKISS(ARG, MASTER, 2|6). The
 * full prose/history writer is shared with daily events, but ONABARE needs to
 * update the canonical talent + CFLAG fields immediately so later consent and
 * virginity gates observe the kiss in the same turn. */
function recordFirstKiss(
  state: GameState,
  slot: CharaSlot,
  partner: number,
  throughPenis: boolean,
): void {
  if ((slot.state.TALENT[TALENT_ID.キス未経験] ?? 0) <= 0) return;
  slot.state.TALENT[TALENT_ID.キス未経験] = 0;
  slot.state.CFLAG[CFLAG_ID.初吻喪失記念日] = state.time.dayIndex;
  slot.state.CFLAG[CFLAG_ID.初吻喪失对手] = partner;
  slot.state.CFLAG[CFLAG_ID.初吻喪失対象] = throughPenis ? 1 : 0;
  if (slot.charaNum !== 0) {
    slot.state.CFLAG[CFLAG_ID.既成事実] =
      (slot.state.CFLAG[CFLAG_ID.既成事実] ?? 0) | 1;
  }
  state.firstKissHistory ??= {};
  state.firstKissHistory[slot.charaNum] = {
    dayIndex: state.time.dayIndex,
    location: slot.location,
    partner: { kind: "character", charaNum: partner },
    situation: throughPenis ? "penis" : "ordinary",
  };
}

/** `抱き寄せ必要値(ARG)` (ATTITUDE.ERB:344-369) — the consent wall. */
export function hugResistance(
  target: CharaSlot,
  state: Readonly<GameState>,
): number {
  const t = target.state;
  const talent = t.TALENT;
  const established = t.CFLAG[CFLAG_ID.既成事実] ?? 0;
  let required = 350;
  required += (talent[TALENT_ID.一線越えない] ?? 0) * 50;
  required += (talent[TALENT_ID.自尊心] ?? 0) * 30;
  required += computeAttitude(target, state.master, state as GameState) * 20;
  required -= (talent[TALENT_ID.性的兴趣] ?? 0) * 20;
  required += (talent[TALENT_ID.貞操] ?? 0) * 50;
  if ((established & 1) === 0) required += 20;
  if (isOtokoGirai(target, state.master)) required += 50;
  if ((talent[TALENT_ID.思慕] ?? 0) === 0 &&
      (talent[TALENT_ID.恋慕] ?? 0) === 0 &&
      (talent[TALENT_ID.愛欲] ?? 0) === 0) required += 50;
  if ((talent[TALENT_ID.無知] ?? 0) !== 0) required -= 50;
  if ((t.CFLAG[CFLAG_ID.被掌握把柄] ?? 0) > 0) required -= 50;
  required -= Math.trunc((t.CFLAG[CFLAG_ID.溜まってる度] ?? 0) / 20);
  // 寸止め count × 20 (EX:Ｃ寸止め .. Ｍ寸止め).
  const edging =
    (t.EX[EX_ID.Ｃ寸止め] ?? 0) +
    (t.EX[EX_ID.Ｖ寸止め] ?? 0) +
    (t.EX[EX_ID.Ａ寸止め] ?? 0) +
    (t.EX[EX_ID.Ｂ寸止め] ?? 0) +
    (t.EX[EX_ID.Ｍ寸止め] ?? 0);
  required -= edging * 20;
  if (isOtokoGirai(target, state.master)) required += 50;
  return required;
}

/** The displayed/used watch wall from NASIKUZUSI.ERB:80. The default modern
 * branch still permits choosing “继续看” (upstream custom kojo may veto it),
 * but keeping the calculation available prevents the UI/runtime from losing
 * the authored gate when a custom route is added. */
export function resolveWatchRequirement(
  target: CharaSlot,
  state: Readonly<GameState>,
): number {
  const t = target.state;
  let requirement =
    hugResistance(target, state) -
    50 +
    (t.TALENT[TALENT_ID.羞恥心] ?? 0) * 50 -
    (t.ABL[ABL_ID.露出癖] ?? 0) * 30 -
    Math.trunc((t.CFLAG[CFLAG_ID.溜まってる度] ?? 0) / 20);
  if ((t.TALENT[TALENT_ID.自尊心] ?? 0) > 0) requirement += 100;
  if (((t.CFLAG[CFLAG_ID.既成事実] ?? 0) & 2) !== 0) requirement -= 50;
  if ((t.TALENT[TALENT_ID.胆量] ?? 0) < 0) requirement -= 200;
  return requirement;
}

/** `無崩し必要値` — the ONABARE-specific consent wall (NASIKUZUSI.ERB:80). */
export function resolveMubushiRequirement(
  target: CharaSlot,
  state: Readonly<GameState>,
): number {
  const t = target.state;
  let requirement =
    hugResistance(target, state) -
    150 +
    (t.TALENT[TALENT_ID.羞恥心] ?? 0) * 30 -
    Math.trunc((t.CFLAG[CFLAG_ID.溜まってる度] ?? 0) / 20);
  if ((t.TALENT[TALENT_ID.自尊心] ?? 0) > 0) requirement += 50;
  if (((t.CFLAG[CFLAG_ID.既成事実] ?? 0) & 2) !== 0) requirement -= 50;
  if ((t.TALENT[TALENT_ID.胆量] ?? 0) < 0) requirement -= 200;
  return requirement;
}

/** 本番はどっちか — V (0) vs A (1) hole preference (NASIKUZUSI.ERB:8-12). */
function holePreference(target: CharaSlot): number {
  const t = target.state;
  if ((t.TALENT[TALENT_ID.処女] ?? 0) === 0 &&
      (t.ABL[ABL_ID.Ａ感覚] ?? 0) >= (t.ABL[ABL_ID.Ｖ感覚] ?? 0)) {
    return 1;
  }
  return 0;
}

/** `回数 = MAX(MIN(ABL:欲望/2,5) + 积攒度/200, 1)` (NASIKUZUSI.ERB:275). */
function roundCount(target: CharaSlot): number {
  const t = target.state;
  const desire = t.ABL[ABL_ID.欲望] ?? 0;
  const frustration = t.CFLAG[CFLAG_ID.溜まってる度] ?? 0;
  return Math.max(1, Math.min(Math.trunc(desire / 2), 5) + Math.trunc(frustration / 200));
}

/** 失礼了 — apologize + flee; catch the chara's leverage. */
function branchAway(
  state: GameState,
  target: CharaSlot,
  deps: OnabareDeps,
): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const name = target.callName ?? `#${target.charaNum}`;
  if (state.master.location === target.location) {
    events.push(narration(state, `${name}沉浸在自慰中…${state.master.callName ?? "主人公"}急忙钻进了被窝。`));
  } else {
    events.push(narration(state, `${state.master.callName ?? "主人公"}把眼前的景象深深印在脑海里、在动摇的${name}清醒前道了一声歉、离开了。`));
  }
  if ((target.state.CFLAG[CFLAG_ID.被掌握把柄] ?? 0) === 0) {
    target.state.CFLAG[CFLAG_ID.被掌握把柄] = 1;
    events.push(narration(state, `掌握了${name}的【把柄】`));
  } else {
    const expGain =
      (target.state.ABL[ABL_ID.露出癖] ?? 0) * 10 +
      (target.state.ABL[ABL_ID.欲望] ?? 0);
    target.state.EXP[EXP_ID.自慰経験] =
      (target.state.EXP[EXP_ID.自慰経験] ?? 0) + expGain;
    target.state.EXP[EXP_ID.露出快楽経験] =
      (target.state.EXP[EXP_ID.露出快楽経験] ?? 0) + expGain;
  }
  target.state.CFLAG[CFLAG_ID.オナバレ] = 1;
  // EVENT 26 arm 1 — "caught" personal kojo (when a router is present).
  if (deps.dialogueRouter) {
    const lines = resolveEventKojoAndApply(deps.dialogueRouter, state, target.charaNum, 1, deps.rng);
    events.push(...lines.map((l) => ({ kind: "DIALOGUE_LINE" as const, timestamp: state.time.tickValue, charaNum: target.charaNum, text: l.text })));
  }
  events.push(...advanceTimeTicks(state, 5));
  return events;
}

/** 继续看 — watch to the end; exposure-pleasure + frustration drain. */
function branchWatch(
  state: GameState,
  target: CharaSlot,
  deps: OnabareDeps,
): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const t = target.state;
  const frustration = t.CFLAG[CFLAG_ID.溜まってる度] ?? 0;
  const exposure = t.ABL[ABL_ID.露出癖] ?? 0;
  const intimacy = t.ABL[ABL_ID.親密] ?? 0;
  // どうぞそのまま好感度上昇値 (NASIKUZUSI.ERB:216).
  const favorUp = Math.trunc((intimacy * frustration) / 250) * Math.min(exposure, 10);
  t.CFLAG[CFLAG_ID.好感度] = Math.max(0, (t.CFLAG[CFLAG_ID.好感度] ?? 0) + favorUp);
  t.CFLAG[CFLAG_ID.信頼度] = Math.max(0, (t.CFLAG[CFLAG_ID.信頼度] ?? 0) - Math.trunc(favorUp / 20));
  juelUpSpecial(t, false, PALAM_ID.恥情, ABL_ID.自慰中毒, 30, state.flagStore);
  juelUpSpecial(t, false, PALAM_ID.欲情, ABL_ID.自慰中毒, 30, state.flagStore);
  const expGain = Math.trunc((frustration / 200) * exposure);
  t.EXP[EXP_ID.露出快楽経験] = (t.EXP[EXP_ID.露出快楽経験] ?? 0) + expGain;
  t.EXP[EXP_ID.自慰経験] = (t.EXP[EXP_ID.自慰経験] ?? 0) + expGain;
  t.CFLAG[CFLAG_ID.オナバレ] = 3;
  const name = target.callName ?? `#${target.charaNum}`;
  events.push(narration(state, `没能察觉到自己被偷窥、${name}沉溺于自慰…就这样把中指插入身体里的样子让${state.master.callName ?? "主人公"}垂涎欲滴。`));
  if (deps.dialogueRouter) {
    const lines = resolveEventKojoAndApply(deps.dialogueRouter, state, target.charaNum, 2, deps.rng);
    events.push(...lines.map((l) => ({ kind: "DIALOGUE_LINE" as const, timestamp: state.time.tickValue, charaNum: target.charaNum, text: l.text })));
  }
  events.push(...advanceTimeTicks(state, 27));
  return events;
}

/** 两个人一起 — consensual NASIKUZUSI H (condensed faithful port). */
function branchJoin(
  state: GameState,
  target: CharaSlot,
  deps: OnabareDeps,
): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const t = target.state;
  const name = target.callName ?? `#${target.charaNum}`;
  const judgment = deriveRelationshipAuthority(target, state.master, state).consentJudgement;
  const requirement = resolveMubushiRequirement(target, state);
  const masterEnergy = state.master.state.BASE[BASE_ID.精力] ?? 0;
  const masterEnergyMax = state.master.state.MAXBASE[BASE_ID.精力] ?? 0;
  if (hasPenis(state.master) && masterEnergyMax > 0 && masterEnergy <= masterEnergyMax / 5) {
    return [narration(state, "主人公的精力不足，无法加入。")];
  }
  if (judgment <= requirement) {
    // 被赶出去 (NASIKUZUSI.ERB:242-253).
    events.push(narration(state, `${name}不讲理地把${state.master.callName ?? "主人公"}赶了出去。`));
    if ((t.CFLAG[CFLAG_ID.被掌握把柄] ?? 0) === 0) {
      t.CFLAG[CFLAG_ID.被掌握把柄] = 1;
      events.push(narration(state, `掌握了${name}的【把柄】`));
    }
    t.CFLAG[CFLAG_ID.オナバレ] = 1;
    getAngry(target, 1);
    if (deps.dialogueRouter) {
      const lines = resolveEventKojoAndApply(deps.dialogueRouter, state, target.charaNum, 3, deps.rng);
      events.push(...lines.map((l) => ({ kind: "DIALOGUE_LINE" as const, timestamp: state.time.tickValue, charaNum: target.charaNum, text: l.text })));
    }
    events.push(...advanceTimeTicks(state, 5));
    return events;
  }
  // NASIKUZUSI consensual H (NASIKUZUSI.ERB:260-535).
  const hole = holePreference(target);
  const rounds = roundCount(target);
  const foreplay = 1 + deps.rng.int(3); // 前戯１ 1..3 (V爱抚/Ｂ爱抚/Ｍ爱抚)
  const anal = hole === 1;
  const masterPenis = hasPenis(state.master);
  const masterTalent = state.master.state.TALENT;
  const wasVDeflowered = (t.TCVAR[TCVAR_ID.破瓜] ?? 0) !== 0;
  // Master stamina drain (DOWNBASE).
  state.master.state.BASE[BASE_ID.体力] = Math.max(0, (state.master.state.BASE[BASE_ID.体力] ?? 0) - rounds * 100);
  state.master.state.BASE[BASE_ID.気力] = Math.max(0, (state.master.state.BASE[BASE_ID.気力] ?? 0) - rounds * 150);
  // 好感度上昇量 = 回数 * 親密 * 5; 信頼低下量 = /5 then talent-halved.
  const favorUp = rounds * (t.ABL[ABL_ID.親密] ?? 0) * 5;
  let trustDown = Math.trunc(favorUp / 5);
  if ((masterTalent[TALENT_ID.謎之魅力] ?? 0) !== 0 || (masterTalent[TALENT_ID.魅惑] ?? 0) !== 0) {
    trustDown = Math.trunc(trustDown / 2);
  }
  if ((t.TALENT[TALENT_ID.思慕] ?? 0) !== 0 || (t.TALENT[TALENT_ID.炮友] ?? 0) !== 0) {
    trustDown = Math.trunc(trustDown / 2);
    if ((t.TALENT[TALENT_ID.快感応答] ?? 0) === 1) trustDown = Math.trunc(trustDown / 2);
  }
  if ((t.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 || (t.TALENT[TALENT_ID.愛欲] ?? 0) !== 0) {
    trustDown = Math.trunc(trustDown / 4);
    if ((t.TALENT[TALENT_ID.快感応答] ?? 0) === 1) trustDown = 0;
  }
  t.CFLAG[CFLAG_ID.好感度] = Math.max(0, (t.CFLAG[CFLAG_ID.好感度] ?? 0) + favorUp);
  if (trustDown > 0) {
    t.CFLAG[CFLAG_ID.信頼度] = Math.max(0, (t.CFLAG[CFLAG_ID.信頼度] ?? 0) - trustDown);
  }
  t.CFLAG[CFLAG_ID.溜まってる度] = 0; // 积攒度 drained by the H itself.
  t.TCVAR[TCVAR_ID.破瓜] = 0;
  t.CFLAG[CFLAG_ID.オナバレ] = 2;
  t.CFLAG[CFLAG_ID.ヤラせちゃった] = 1;

  const addExp = (slot: CharaSlot, id: number, amount: number): void => {
    if (amount <= 0) return;
    slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + amount;
  };

  // NASIKUZUSI's experience vector. Keep the authored locations/round scaling
  // while using the canonical EXP ids shared by ordinary H handlers.
  if (foreplay === 1) {
    const gain = deps.rng.int(Math.max(rounds * 2, 1));
    addExp(target, EXP_ID.Ｃ経験, gain);
    addExp(target, EXP_ID.Ｃ絶頂経験, Math.trunc(gain / 2));
    addExp(target, EXP_ID.絶頂経験, Math.trunc(gain / 2));
  } else if (foreplay === 2) {
    const gain = deps.rng.int(Math.max(rounds * 2, 1));
    addExp(target, EXP_ID.Ｂ経験, gain);
    addExp(target, EXP_ID.Ｂ絶頂経験, Math.trunc(gain / 2));
    addExp(target, EXP_ID.絶頂経験, Math.trunc(gain / 2));
  } else {
    const gain = 3 + (t.ABL[ABL_ID.Ｍ感覚] ?? 0) * 2;
    addExp(target, EXP_ID.Ｍ経験, gain);
    addExp(target, EXP_ID.キス経験, gain);
    addExp(target, EXP_ID.奉仕快楽経験, gain);
    addExp(state.master, EXP_ID.Ｍ経験, gain);
    addExp(state.master, EXP_ID.キス経験, gain);
    addExp(state.master, EXP_ID.口淫経験, gain);
    if ((t.TALENT[TALENT_ID.キス未経験] ?? 0) !== 0) {
      recordFirstKiss(state, target, state.master.charaNum, masterPenis);
    }
    if ((state.master.state.TALENT[TALENT_ID.キス未経験] ?? 0) !== 0) {
      recordFirstKiss(state, state.master, target.charaNum, masterPenis);
    }
  }
  if (anal) {
    addExp(target, EXP_ID.Ａ経験, rounds * 2);
    addExp(target, EXP_ID.Ａ性交経験, rounds);
    addExp(target, EXP_ID.Ａ絶頂経験, 2 * rounds);
    if (masterPenis) addExp(target, EXP_ID.肛射経験, rounds);
  } else {
    addExp(target, EXP_ID.Ｖ経験, rounds * 2);
    addExp(target, EXP_ID.Ｖ性交経験, rounds);
    addExp(target, EXP_ID.Ｖ絶頂経験, 2 * rounds);
    if (masterPenis) addExp(target, EXP_ID.膣射経験, rounds);
  }
  addExp(target, EXP_ID.絶頂経験, rounds);
  if (masterPenis) {
    addExp(state.master, EXP_ID.挿入経験, rounds);
    addExp(state.master, EXP_ID.射精経験, rounds);
    addExp(state.master, EXP_ID.絶頂経験, rounds);
    setTflagBit(state, TFLAG_ID.一日一回, 8);
    const amount = Math.min(ejaculateAmount(state.master.state), masterEnergy);
    depositEjaculate(state, {
      sender: state.master.charaNum,
      receiver: target.charaNum,
      site: anal ? 2 : 1,
      amount,
    });
    state.master.state.BASE[BASE_ID.精力] = Math.max(0, masterEnergy - amount);
  }
  addExp(state.master, EXP_ID.清掃経験, 1);
  juelUpSpecial(t, false, PALAM_ID.欲情, ABL_ID.欲望, 20, state.flagStore);
  if (foreplay === 1) {
    juelUpSpecial(t, false, PALAM_ID.快Ｃ, ABL_ID.Ｃ感覚, 10, state.flagStore);
  } else if (foreplay === 2) {
    juelUpSpecial(t, false, PALAM_ID.快Ｂ, ABL_ID.Ｂ感覚, 10, state.flagStore);
  } else {
    juelUpSpecial(t, false, PALAM_ID.快Ｍ, ABL_ID.Ｍ感覚, 20, state.flagStore);
  }
  if (anal) {
    juelUpSpecial(t, false, PALAM_ID.快Ａ, ABL_ID.Ａ感覚, 15, state.flagStore);
  } else {
    juelUpSpecial(t, false, PALAM_ID.快Ｖ, ABL_ID.Ｖ感覚, wasVDeflowered ? 100 : 15, state.flagStore);
  }
  // 破瓜 — V virgin loss (処女喪失記念日), A virgin loss (尻穴処女喪失記念日).
  if (!anal && (t.TALENT[TALENT_ID.処女] ?? 0) === -1) {
    t.TALENT[TALENT_ID.処女] = 0;
    events.push(narration(state, `【无自觉非处女丧失】${name}并不知道自己失去了纯洁。`));
  } else if (!anal && (t.TALENT[TALENT_ID.処女] ?? 0) === 1) {
    t.CFLAG[CFLAG_ID.処女喪失記念日] = dateOf(state.time);
    t.TALENT[TALENT_ID.処女] = 0;
    events.push(narration(state, `【处女丧失】夺走了纯洁、做了${rounds}次。`));
  } else if (anal && (t.CFLAG[CFLAG_ID.尻穴処女喪失記念日] ?? 0) === 0) {
    t.CFLAG[CFLAG_ID.尻穴処女喪失記念日] = dateOf(state.time);
    events.push(narration(state, `【肛门处女丧失】夺走了纯洁、做了${rounds}次。`));
  } else {
    const verb = masterPenis ? (anal ? "贯穿" : "交合") : "抚弄";
    events.push(narration(state, `${name}和${state.master.callName ?? "主人公"}${verb}了${rounds}次…${anal ? "肛门" : "膣道"}内被注满了精液。`));
  }
  if (deps.dialogueRouter) {
    const lines = resolveEventKojoAndApply(deps.dialogueRouter, state, target.charaNum, 5, deps.rng);
    events.push(...lines.map((l) => ({ kind: "DIALOGUE_LINE" as const, timestamp: state.time.tickValue, charaNum: target.charaNum, text: l.text })));
  }
  events.push(...advanceTimeTicks(state, rounds * 20));
  return events;
}

/**
 * Run the ONABARE three-branch event. Mutates `state` (the handler's clone).
 * Returns the narration/kojo events the caller should surface.
 */
export function onabare(
  state: GameState,
  targetNum: number,
  choice: OnabareChoice,
  deps: OnabareDeps,
): ObservationEvent[] {
  const target = state.charas[targetNum];
  if (!target || targetNum <= 0) return [narration(state, "オナバレ对象不存在。")];
  target.state.CFLAG[CFLAG_ID.最後に会った日] = dateOf(state.time);
  switch (choice) {
    case "away":
      return branchAway(state, target, deps);
    case "watch":
      return branchWatch(state, target, deps);
    case "join":
      return branchJoin(state, target, deps);
  }
}
