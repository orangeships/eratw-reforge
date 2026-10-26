/**
 * Phase 7 (Wave 1) — `COMF364 豆まき` (Setsubun bean-throwing) settlement.
 *
 * Ports the deterministic core of `@COM364`
 * (`ERB/コマンド関連/COMF/日常系/COMF364 豆まき.ERB`, utf-8-sig).
 *
 * **The multi-target exemplar.** 364 is the first command whose settlement
 * loops over *all present NPCs* (`FOR LOCAL,1,GET_TARGETNUM()+1`), calling
 * `@COM364_1` per eligible chara. It can't be a `ComfDef` — the factory
 * settles only `ctx.target`. The `presentNpcs` helper (scene/presence.ts)
 * is the reusable deliverable this port exercises.
 *
 * **SOURCE_CHECK semantics (verified, `SOURCE.ERB` l.58-72):** `@SOURCE_CHECK`
 * loops every co-located chara (`FOR LOCAL,0,CHARANUM` filtered by 現位置 +
 * 登場) and settles *each one's own* SOURCE array. So the per-NPC
 * `SOURCE:歓楽/征服` written during the 364 loop ARE consumed — each eligible
 * NPC is settled against its own ABL/CFLAG. The original target (LOCAL:2,
 * == TARGET:1, always iterated first) additionally receives the post-loop
 * `苦痛/恐怖/反感`, merged into its single settlement pass.
 *
 * **Faithful core captured:**
 *   - `TFLAG:信頼度管理 = -1` (ERB l.12) → `flagStore[信頼度管理] = -1`.
 *   - `TFLAG:193 = 1` then `++` per eligible chara (ERB l.13,23) →
 *     `count = 1 + N` (skipped charas do NOT increment; 睡眠/鬼/正邪 skip
 *     before the `++`).
 *   - Per eligible chara `@COM364_1` (ERB l.49-52): master DOWNBASE 気力 -50;
 *     `SOURCE:歓楽 = 1500 + 300*施虐属性`, `SOURCE:征服 = 500 + 200*施虐属性`
 *     (ERA `=` overwrites each iteration, but each write lands on a
 *     DIFFERENT chara's SOURCE — TARGET is rebound per iteration — so every
 *     eligible chara keeps its own values).
 *   - Post-loop on restored TARGET (ERB l.30,31,33-35,37): master DOWNBASE
 *     体力 `count*200`, 気力 `count*200 + 50`; aggregate `SOURCE:苦痛 =
 *     count*1000`, `恐怖 = count*2000`, `反感 = count*500`.
 *   - `SOURCE:苦痛` PALAM-level scaling (ERB l.44):
 *     `* (10 + 5*MAX(GETPALAMLV(PALAM:苦痛,5)-1,0)) / 10` (truncating).
 *   - `TIME += 30` (ERB l.45).
 *
 * **DEFERRED (documented, not stubbed as reachable):**
 *   - `[[正邪]]` charaNum skip (l.21) — the modern roster uses the authored
 *     call-name exception because a stable numeric alias is not exposed.
 *   - `TFLAG:207 += count*300` 仕事-income (l.39) — no TFLAG:207 model /
 *     consumer in the runtime; bean-money payout deferred.
 *   - `TFLAG:193` outcome flag (consumed by GET_SUCCESS_RATE outcome-scaling
 *     in SOURCE_CHECK) — outcome-scaling deferred in `source-check.ts`; only
 *     the local `count` arithmetic is reproduced.
 *   - `TFLAG:100` + `GLOBAL_COMABLE(301)` (@COM_ABLE364 l.65-69) —
 *     resolver/catalog plumbing.
 *   - `TCVAR:116 = PLAYER` (l.11) — no TCVAR_ID for 接触反省.
 *
 * **Live reachability.** The calendar and 鬼-race gates are now wired, so the
 * command is reachable on winter date 3 for an eligible target. The remaining
 * deferred income flag is deliberately not converted into money without an
 * authoritative modern consumer.
 */
import type { CommandContext, HandlerEntry } from "../types.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  advanceTimeTicks,
  getMasterBase,
  palamLevel,
  setMasterBase,
} from "../../state/settlement.js";
import { applySourceCheck } from "../source-check.js";
import { presentNpcs } from "../../scene/presence.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";
import { festivalNow } from "../../world/calendar.js";

type Blocked = { ok: false; reason: { kind: "precondition"; message: string } };

/** A chara's 施虐属性 plus its identity, for the per-NPC SOURCE pass. */
interface EligibleChara {
  charaNum: number;
  sade: number;
}

/**
 * Pure arithmetic of the bean-throwing SOURCE plan. Exported so tests can
 * pin the `歓楽 = 1500 + 300*施虐属性` / `征服 = 500 + 200*施虐属性` formulas
 * and the `count*{1000,2000,500}` aggregates + 苦痛 PALAM-scaling without
 * driving the full settlement (whose favor deltas are covered separately).
 *
 * @param eligible  present NPCs that passed the 睡眠/鬼/正邪 skips
 *                  (ascending charaNum, mirroring the TARGET list order).
 * @param kutsuuPalamValue  the restored TARGET's current PALAM:苦痛
 *                          (drives GETPALAMLV(PALAM:苦痛,5)).
 * @returns the per-chara SOURCE map + master DOWNBASE drains + the three
 *          aggregate sources for the original target.
 */
export function computeMamemakiPlan(
  eligible: EligibleChara[],
  kutsuuPalamValue: number,
): {
  count: number;
  /** per eligible charaNum → {歓楽,征服} keyed by SOURCE_ID (each chara's own formula). */
  perChara: Map<number, Record<number, number>>;
  /** master DOWNBASE drains (positive magnitudes). */
  masterTairyokuDrain: number;
  masterKiryokuDrain: number;
  /** aggregate sources for the original target. */
  kutsuu: number;
  terror: number;
  hanken: number;
} {
  const n = eligible.length;
  const count = 1 + n; // ERB l.13,23: TFLAG:193 = 1, ++ per eligible.

  const perChara = new Map<number, Record<number, number>>();
  for (const c of eligible) {
    perChara.set(c.charaNum, {
      [SOURCE_ID.歓楽]: 1500 + 300 * c.sade, // ERB l.51
      [SOURCE_ID.征服]: 500 + 200 * c.sade, // ERB l.52
    });
  }

  // Master DOWNBASE (ERB l.30,31 per-iteration 気力 -50; l.30/31 count*200;
  // l.37 flat 気力 +50). Positive drain magnitudes.
  const masterTairyokuDrain = count * 200; // ERB l.30
  const masterKiryokuDrain = n * 50 + count * 200 + 50; // l.50 (×n) + l.31 + l.37

  // Aggregate on restored TARGET (ERB l.33-35), 苦痛 then PALAM-scaled (l.44).
  const lvl = palamLevel(kutsuuPalamValue, 5); // GETPALAMLV(PALAM:苦痛,5)
  const mult = 10 + 5 * Math.max(lvl - 1, 0);
  const kutsuu = Math.trunc((count * 1000 * mult) / 10); // ERB l.33,44
  const terror = count * 2000; // ERB l.34
  const hanken = count * 500; // ERB l.35

  return { count, perChara, masterTairyokuDrain, masterKiryokuDrain, kutsuu, terror, hanken };
}

/** {@link ExecCheck} body — faithful `@COM_ABLE364` (ERB l.59-88). */
function checkMamemakiEligible(ctx: CommandContext): { ok: true } | Blocked {
  // ERB l.63: 時間停止 (FLAG:70).
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止期间无法执行。" } };
  }
  const target = ctx.state.charas[ctx.target];
  if (!target) {
    return { ok: false, reason: { kind: "precondition", message: "没有目标。" } };
  }
  // ERB l.71: 睡眠中 (TARGET's).
  if ((target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方正在睡觉。" } };
  }
  // ERB l.76: FESTIVAL() == "節分".
  if (festivalNow(ctx.state.time) !== "節分") {
    return { ok: false, reason: { kind: "precondition", message: "撒豆只能在节分之日进行。" } };
  }
  // ERB l.79-84: target must be the 鬼 tribe, with 正邪 as the explicit
  // exception. The modern roster carries the tribe in TALENT:妖怪; the
  // name check preserves the upstream singleton exception without inventing
  // a numeric roster constant.
  const oni = (target.state.TALENT[TALENT_ID.妖怪] ?? 0) === 2
    || target.callName?.includes("正邪");
  if (!oni) {
    return { ok: false, reason: { kind: "precondition", message: "撒豆的对象必须是鬼族。" } };
  }
  if ((target.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "陪睡中无法撒豆。" } };
  }
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "气力不足，无法撒豆。" } };
  }
  return { ok: true };
}

export const comf364HandlerEntry: HandlerEntry = {
  commandNo: 364,
  execCheck: (ctx) => {
    const r = checkMamemakiEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx: CommandContext) => {
    const next = cloneGameState(ctx.state);
    const master = next.master;
    const originalTarget = ctx.target;

    // ERB l.12: TFLAG:信頼度管理 = -1 (consumer deferred in source-check.ts).
    setTflag(next, TFLAG_ID.信頼度管理, -1);

    // ERB l.16-26: loop present NPCs (ascending charaNum), skip 睡眠/鬼/正邪.
    const npcs = presentNpcs(next, master.location);
    const eligible: EligibleChara[] = [];
    for (const npc of npcs) {
      if ((npc.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) continue; // ERB l.17
      const oni = (npc.state.TALENT[TALENT_ID.妖怪] ?? 0) === 2
        || npc.callName?.includes("正邪");
      if (!oni) continue;
      eligible.push({ charaNum: npc.charaNum, sade: npc.state.ABL[ABL_ID.施虐属性] ?? 0 });
    }

    // Read the restored TARGET's PALAM:苦痛 BEFORE settlement mutates it.
    const origSlot = next.charas[originalTarget];
    const kutsuuPalam = origSlot?.state.PALAM[PALAM_ID.苦痛] ?? 0;

    const plan = computeMamemakiPlan(eligible, kutsuuPalam);

    // Master DOWNBASE (drains are positive magnitudes → subtract).
    setMasterBase(
      next,
      BASE_ID.体力,
      (getMasterBase(next, BASE_ID.体力) ?? 0) - plan.masterTairyokuDrain,
    );
    setMasterBase(
      next,
      BASE_ID.気力,
      (getMasterBase(next, BASE_ID.気力) ?? 0) - plan.masterKiryokuDrain,
    );

    // ERB l.39: TFLAG:207 += count*300 (仕事 income — DEFERRED, no model).

    // ERB l.45: TIME += 30.
    advanceTimeTicks(next, 30);

    // SOURCE_CHECK settles each present chara's own SOURCE. The original
    // target (always iterated as TARGET:1) gets its 歓楽/征服 merged with the
    // post-loop 苦痛/恐怖/反感 in a single pass; every OTHER eligible chara
    // gets only its own 歓楽/征服.
    const events: ObservationEvent[] = [];
    let favorDelta = 0;
    let settledOriginal = false;
    for (const c of eligible) {
      const own = plan.perChara.get(c.charaNum)!;
      const sources: Record<number, number> = {
        [SOURCE_ID.歓楽]: own[SOURCE_ID.歓楽]!,
        [SOURCE_ID.征服]: own[SOURCE_ID.征服]!,
      };
      if (c.charaNum === originalTarget) {
        sources[SOURCE_ID.苦痛] = plan.kutsuu;
        sources[SOURCE_ID.恐怖] = plan.terror;
        sources[SOURCE_ID.反感] = plan.hanken;
        settledOriginal = true;
      }
      const r = applySourceCheck(next, c.charaNum, sources, 0);
      favorDelta += r.favorDelta;
      events.push(...r.events);
    }
    // If the original target wasn't an eligible iteration (e.g. not present),
    // ERB still writes 苦痛/恐怖/反感 onto TARGET=LOCAL:2 post-loop → settle.
    if (origSlot && !settledOriginal) {
      const r = applySourceCheck(
        next,
        originalTarget,
        {
          [SOURCE_ID.苦痛]: plan.kutsuu,
          [SOURCE_ID.恐怖]: plan.terror,
          [SOURCE_ID.反感]: plan.hanken,
        },
        0,
      );
      favorDelta += r.favorDelta;
      events.push(...r.events);
    }

    events.unshift({
      kind: "NARRATION",
      timestamp: ctx.now(),
      text: `向${eligible.length}人撒了豆；好感度 ${favorDelta >= 0 ? "+" : ""}${favorDelta}。`,
    });

    return { state: next, events, outcome: "ok" };
  },
};
