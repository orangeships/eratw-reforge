/**
 * Slice O3 — COMF698 部屋に入る (enter private room).
 *
 * Modern equivalent of `@COM698` (`ERB/コマンド関連/COMF/外出系/COMF698部屋に入る.ERB`).
 * Faithful to the entry-path gates + 嫉妬/浮気 detection (id 60 → 嫉妬,
 * co-present 恋慕 + 信赖<1000 → 浮気) and the 698 → `@OMANEKI_ENTER(ARG)`
 * state-writer.
 *
 * Reachability (`@COM_ABLE698`):
 *   - `!GLOBAL_COMABLE(698)` — generic disabled check (handled by catalog)
 *   - `!CFLAG:行動 == 5` — not working
 *   - `CFLAG:MASTER:現在位置 == CFLAG:自宅位置` — master at the chara's home
 *   - `CHK_DATENOW(CFLAG:MASTER:约会中)` — on a date map (set by 405/odekake)
 *   - **`!IS_FALLEN(TARGET) && TALENT:セフレ != 2 && !TCVAR:発情 &&
 *      !(TCVAR:誘惑時刻 && CFLAG:溜まってる度 >= 800) && FLAG:催眠強度 <= 49` →
 *      block** — the upstream consent gate (modded "tweaked condition to be
 *      more forgiving"; the strict 恋慕-only original is commented out in
 *      source. MVP checks: 恋慕 || 思慕 || 淫乱 || 愛欲 || 炮友≠0 OR
 *      発情 OR 催眠強度>49 OR (誘惑時刻+溜まってる度>=800).
 *   - `!CFLAG:睡眠` / `!FLAG:70` (時停) / `!潜伏` (潜伏 bit0)
 *   - `BASE:怒り <= 50` (com custom) — anger gate; an angry target refuses
 *
 * **Execution**: 嫉妬/浮気 detection (loop all chara in master's room; id 60
 * → 嫉妬=60; non-master 恋慕 + 信赖<1000 → 浮気). 嫉妬/浮気 path is RETURN -1
 * with a narration. Otherwise: `omanekiEnter(state, target)` + TIME += 1.
 *
 * **Deferred (faithful, not silent stubs)**:
 *   - `FLAG:约会的对象 && !IS_DATING_WITH_PLAYER(TARGET) && GET_UWAKI_HISTORY(...)
 *     != 2` arm — dating-system aware; MVP blocks unconditionally when
 *     `FLAG:约会的对象 && 约会的对象 != target`.
 *   - `MOREDATES_HOUSE_VISIT(ARG)` (多人约会 arm).
 *   - `IS_DATING_WITH_PLAYER(FLAG:约会的对象)` predicate — needs dating helper.
 *   - `@COM698_DISPLAY` text override (returns "去" + OMANEKI_PLACE()).
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  advanceTimeTicks,
  CFLAG_ID,
  FLAG_ID,
  TALENT_ID,
  getMasterCflag,
} from "../../state/settlement.js";
import { chkDateNow } from "../../world/location-predicates.js";
import { omanekiEnter } from "../../world/omaneki.js";

/** Upstream jealousy/floating arm target charaNum = 60 (輝夜). */
const JEALOUSY_CHARA = 60;

/** 汚臭耐性 is the 698/697 コンプライント gate partner; 催眠強度 is a global FLAG. */
const HYPNOSIS_GATE = 49;

function block(
  message: string,
): { ok: false; reason: { kind: "precondition"; message: string } } {
  return { ok: false, reason: { kind: "precondition", message } };
}

/** `IS_FALLEN(TARGET)` (ADD_CUSTOM_FALL_CONDITION.ERB) — matches at least one
 *  of 恋慕/思慕/淫乱/愛欲. Modded "tweaked condition" upstream adds 炮友
 *  to the consent gate; we include it. */
function isFallen(target: number, state: GameState): boolean {
  const slot = target === 0 ? state.master : state.charas[target];
  if (!slot) return false;
  const t = (id: number): number => slot.state.TALENT[id] ?? 0;
  return t(TALENT_ID.恋慕) !== 0
      || t(TALENT_ID.思慕) !== 0
      || t(TALENT_ID.淫乱) !== 0
      || t(TALENT_ID.愛欲) !== 0
      || t(TALENT_ID.炮友) !== 0;
}

/** TCVAR 発情 + 誘惑時刻 — not in modern TCVAR_ID; modeled as raw ids.
 *  発情 (.als id=164), 誘惑時刻 (.als id=?). For MVP we read TCVAR[164]
 *  (発情) and TCVAR[60] (誘惑時刻 — placeholder raw id, to be aligned with
 *  upstream TCVAR.als if/when 発情 is added). */
const TCVAR_発情 = 164;
const TCVAR_誘惑時刻 = 60;

function isConsentOpen(target: number, state: GameState): boolean {
  if (isFallen(target, state)) return true;
  const tSlot = target === 0 ? state.master : state.charas[target];
  if (!tSlot) return false;
  // TALENT:セフレ == 2 → casual friend w/ benefits (open)
  if ((tSlot.state.TALENT[TALENT_ID.炮友] ?? 0) === 2) return true;
  // 発情
  if ((tSlot.state.TCVAR[TCVAR_発情] ?? 0) !== 0) return true;
  // 誘惑時刻 && 溜まってる度 >= 800
  if (
    (tSlot.state.TCVAR[TCVAR_誘惑時刻] ?? 0) !== 0 &&
    (tSlot.state.CFLAG[CFLAG_ID.溜まってる度] ?? 0) >= 800
  ) {
    return true;
  }
  // 催眠強度 > 49
  if ((state.flagStore[FLAG_ID.催眠強度] ?? 0) > HYPNOSIS_GATE) return true;
  return false;
}

/** Scan master's current room for the 嫉妬 (chara 60) / 浮気 (恋慕+信赖<1000)
 *  arms. Skips `target` (the chara being entered) so the target isn't
 *  counted as their own bystander. */
function detectBystanders(state: GameState, target: number): {
  jealousy: number;
  infidelity: number;
} {
  let jealousy = 0;
  let infidelity = 0;
  for (const [k, slot] of Object.entries(state.charas)) {
    const n = Number(k);
    if (n === target) continue;
    if (slot.location !== state.master.location) continue;
    if ((slot.state.TALENT[TALENT_ID.左拥右抱] ?? 0) !== 0) continue;
    if (n === JEALOUSY_CHARA) {
      jealousy = n;
      continue;
    }
    const has恋慕 = (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;
    const lowTrust =
      (slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0) < 1000;
    if (has恋慕 && lowTrust) {
      infidelity = n;
    }
  }
  return { jealousy, infidelity };
}

function check698Eligible(
  state: Readonly<GameState>,
  actor: number,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("入室は主人公だけが実行できます。");
  if (target < 1 || !state.charas[target]) {
    return block("入室する対象がいません。");
  }
  // 仕事中
  if ((getMasterCflag(state as GameState, CFLAG_ID.行动) ?? 0) === 5) {
    return block("仕事中です。");
  }
  // chara's home == master's current location
  const tSlot = state.charas[target]!;
  const tHome = tSlot.state.CFLAG[CFLAG_ID.自宅位置] ?? 0;
  // Master's 現在位置 is stored as a numeric id (CFLAG 300). The modern
  // string `slot.location` is the canonical view; we compare the bridge
  // id↔string. For MVP, a strict comparison of slot.location is the
  // friendlier check (matches COM_ABLE698 `現在位置 == 自宅位置`).
  // Without a clean home-id <-> home-location map we use slot.location
  // for both (master.location must equal the chara's recorded home).
  const masterHomeStr = state.master.location;
  const tHomeStr = tSlot.homeLocation ?? "";
  if (masterHomeStr !== tHomeStr) {
    return block("相手の私室にいません。");
  }
  if (!chkDateNow(getMasterCflag(state as GameState, CFLAG_ID.约会中))) {
    return block("デート中でない場所にいます。");
  }
  if (!isConsentOpen(target, state as GameState)) {
    return block("相手が受け入れません。");
  }
  if (getMasterCflag(state as GameState, CFLAG_ID.睡眠) !== 0) {
    return block("睡眠中です。");
  }
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return block("時間停止中です。");
  }
  if (((state.flagStore[FLAG_ID.潜伏] ?? 0) & 1) !== 0) {
    return block("潜伏中です。");
  }
  if (getMasterCflag(state as GameState, CFLAG_ID.恶作剧) !== 0) {
    return block("恶作剧中です。");
  }
  // 诶嘿嘿 is not in upstream 698's gate (only 697's). The 698 path is
  // "enter the private room the chara has already invited you to", which
  // is a more committed action than 697's "knock on their door".
  // BASE:怒り > 50 — the target's anger (TCVAR 36 in upstream).
  // MVP reads TCVAR[36] as raw id (no modern TCVAR_怒り id yet).
  if ((tSlot.state.TCVAR[36] ?? 0) > 50) {
    return block("相手が怒っています。");
  }
  // Reference tHome to silence "unused" in MVP; the strict CFLAG id
  // comparison is the future Phase-7.4 path.
  void tHome;
  return { ok: true };
}

export const omaneki698HandlerEntry: HandlerEntry = {
  commandNo: 698,
  execCheck: (ctx) => check698Eligible(ctx.state, ctx.actor, ctx.target),
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    const tSlot = next.charas[target];
    if (!tSlot) {
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: "没有可以进入其房间的对象。",
          },
        ],
        outcome: "noop" as const,
      };
    }

    // 嫉妬/浮気 detection (loop all chara in master's room; skip target).
    const { jealousy, infidelity } = detectBystanders(next, target);
    if (jealousy || infidelity) {
      const actorName = jealousy
        ? next.charas[jealousy]?.callName ?? `#${jealousy}`
        : next.charas[infidelity]?.callName ?? `#${infidelity}`;
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: `试图进入${tSlot.callName ?? `#${target}`}的房间时，被${actorName}阻止了。`,
          },
        ],
        outcome: "noop" as const,
      };
    }

    const r = omanekiEnter(next, target);
    if (!r.ok) {
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: r.reason ?? "进入房间失败。",
          },
        ],
        outcome: "noop" as const,
      };
    }
    advanceTimeTicks(next, 1);

    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `进入了${tSlot.callName ?? `#${target}`}的房间。`,
        },
      ],
      outcome: "ok" as const,
    };
  },
};
