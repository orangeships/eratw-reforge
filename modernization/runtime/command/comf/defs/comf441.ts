/**
 * Phase 7 (Wave 1) — `COMF441 授業を受ける` (attend class) settlement, as a `ComfDef`.
 *
 * Ports the deterministic core of `@COM441`
 * (`ERB/コマンド関連/COMF/日常系/COMF441 授業を受ける.ERB`).
 *
 * **Chore-help family — 勉強 (412) sibling.** 441 is structurally a near-clone
 * of `comf412.ts` (勉強): same `SOURCE:歓楽` 従順 bracket
 * (`JUUJUN_PLEASURE_CHORE_TIERS`) + 好感度 bracket (`favorPleasureBonus`), same
 * `EXP:学習経験` grant shape, master-centric, no outcome roll, `TIME += 60`.
 * The deltas from 412:
 *
 *   - DOWNBASE 体力 50 / 気力 200 (412 is 100/300).
 *   - The body gate is `TARGET>0 && !CFLAG:睡眠` only (412 also requires
 *     `CFLAG:行動 != 5`); 441 instead *requires* 慧音 to be 仕事中 (行動==5),
 *     enforced by the `execCheck` (the inverted gate).
 *   - 441 writes `TFLAG:信頼度管理` (a trust ladder: 3 + 教養 brackets) —
 *     unique to this command; 412 doesn't. Consumer is deferred in
 *     `source-check.ts` (TRUST_CALC), so the write is faithful-but-dormant,
 *     same posture as every other port.
 *
 * **Phase 8 unlock.** §3G (Phase 7.5) scanned 441 as "trial 不可達" because
 * the trial was single-map/single-char. Phase 8 now populates 人間の里 with
 * 慧音 (charaNum 67, 寺子屋 teacher, `keine-schedule.ts`) — so the resolver
 * can now settle 441 against a real village+慧音 context. (441 is not in the
 * trial action menu `BASIC_ACTION_NOS`; it is resolver-only, exercised via
 * tests.)
 *
 * **Faithful core captured:**
 *   - `@COM_ABLE441` gates: 寺子屋 location + 慧音 co-located + 慧音 仕事中
 *     (CFLAG:行動==5) + class-time window (not lunch 720-780, not after 840)
 *     + master 気力>0 + not 時間停止 + not 诶嘿嘿 (ERB 73-92). The
 *     `TFLAG:100` (command-screen) and `GLOBAL_COMABLE(441)` (1/day) arms are
 *     deferred — same as 411/412/440/495 (owned by the resolver/catalog layer).
 *   - DOWNBASE master 体力 -50 / 気力 -200 (ERB 7-8).
 *   - TIME += 60 (ERB 56).
 *   - SOURCE:歓楽 = 200 + 従順-bracket + 好感度-bracket, clamped ≥0 — only
 *     when a chara is present and awake (`TARGET>0 && !CFLAG:睡眠`, ERB 9).
 *   - TFLAG:信頼度管理 = 3 + (m教養>2) + (m教養>t教養) (ERB 14-17).
 *   - EXP:学習経験 grants (ERB 19/22/52/53/58):
 *       · master always +1 (line 58, runs even with no helper)
 *       · with a helper: target +2 if m教養 > t教養 (line 19),
 *         master +1 if m教養 < t教養 - 2 (line 22),
 *         master +1, target +1 (lines 52-53)
 *
 * **DEFERRED (documented):**
 *   - `TFLAG:100` command-screen flag + `GLOBAL_COMABLE(441)` 1/day gate
 *     (resolver/catalog layer).
 *   - `TCVAR:67:特殊事件 ++` (ERB 39-40, gated by 寺子屋+慧音行動==5, both
 *     guaranteed by execCheck) — no `TCVAR_ID.特殊事件` modeled and no consumer.
 *   - `M_TFLAG:时间因子类型 = TimeFactor_学习` (time-factor tag, same as 412).
 *   - `ITEM:103 && !RAND:2` master EXP bonus (ITEM + RAND, same as 412).
 *
 * **Live-reachability gap (R5).** The scheduler (`scheduler.ts`) syncs only
 * `CharaSlot.location` from a schedule slot, NOT `CFLAG:行動`. So in live
 * trial play 慧音 sits at 寺子屋 during teach slots but her `CFLAG:行動` stays
 * 0 → the `行動==5` gate blocks 441. Tests set `CFLAG:行動=5` explicitly.
 * Genuine live reachability needs the R5 schedule→CFLAG sync (deferred).
 *
 * **No outcome roll.** 441 has no `RAND`/`TFLAG:193` great/normal/fail split,
 * so the factory's outcome is pinned to 通常 (thresholds unreachable).
 */
import type { CommandContext, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  getMasterBase,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfCtx, ComfDef } from "../comf-def.js";
import {
  bracketBonus,
  favorPleasureBonus,
  JUUJUN_PLEASURE_CHORE_TIERS,
} from "../source-brackets.js";
import { TFLAG_ID, setTflag } from "../../../state/tflag.js";

/** 慧音 (charaNum 67) — the 寺子屋 teacher this command targets. */
const KEINE_CHARA_NUM = 67;
/** 寺子屋 location string (人間の里 room, see `keine-schedule.ts`). */
const TERAKOYA = "人間之里:寺子屋";

/**
 * The SOURCE/EXP block fires only when the target chara is present and awake
 * (ERB 9: `TARGET>0 && !CFLAG:睡眠`). Unlike 412 (勉強), there is NO
 * `CFLAG:行動 != 5` exclusion here — 441 instead *requires* 慧音 to be
 * 仕事中, enforced by `checkLessonEligible` (the inverted gate).
 */
function lessonEngaged(c: ComfCtx): boolean {
  return c.hasTarget && c.tCflag(CFLAG_ID.睡眠) === 0;
}

/** {@link ExecCheck} body — faithful `@COM_ABLE441` (ERB 73-92). */
function checkLessonEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // ERB 77: 時間停止 (FLAG:70 == 1).
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1) {
    return { ok: false, reason: { kind: "precondition", message: "時間停止中は授業を受けられない。" } };
  }
  // ERB 79: 寺子屋以外不可.
  if (ctx.state.master.location !== TERAKOYA) {
    return { ok: false, reason: { kind: "precondition", message: "寺子屋でなければ授業を受けられない。" } };
  }
  // ERB 81: 慧音の居る所 (master location == 慧音 location).
  const keine = ctx.state.charas[KEINE_CHARA_NUM];
  if (!keine || keine.location !== ctx.state.master.location) {
    return { ok: false, reason: { kind: "precondition", message: "慧音がいない。" } };
  }
  // ERB 83: 仕事中以外不可 (CFLAG:行動 == 5, unscoped → 慧音's).
  if ((keine.state.CFLAG[CFLAG_ID.行动] ?? 0) !== 5) {
    return { ok: false, reason: { kind: "precondition", message: "慧音は授業中ではない。" } };
  }
  // ERB 85-88: time window — not lunch (720-780), not after class (>=840).
  const t = ctx.state.time.tickValue;
  if (t >= 720 && t <= 780) {
    return { ok: false, reason: { kind: "precondition", message: "お昼休み中は授業がない。" } };
  }
  if (t >= 840) {
    return { ok: false, reason: { kind: "precondition", message: "授業時間は終了している。" } };
  }
  // ERB 89: 気力0 (master's).
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力が足りない。" } };
  }
  // ERB 91: 诶嘿嘿 (unscoped → 慧音's, any nonzero blocks).
  if ((keine.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "今は授業どころではない。" } };
  }
  return { ok: true };
}

export const comf441Def: ComfDef = {
  commandNo: 441,
  label: "授業を受ける",

  // Master-centric: the body's `IF TARGET>0` gate tolerates a no-helper call
  // (time/downbase/exp still run). In practice execCheck guarantees 慧音 present.
  requiresTarget: false,

  // No outcome roll — pin to 通常 (thresholds unreachable for roll 0..99).
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 56.
  timeCost: 60,

  // ERB 7-8.
  downbase: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 200 },

  buildSources: (c): Record<number, number> => {
    if (!lessonEngaged(c)) return {};
    // ERB 11: fixed base, then the two shared brackets (identical to 412).
    let kanraku = 200;
    kanraku += bracketBonus(c.tAbl(ABL_ID.従順), JUUJUN_PLEASURE_CHORE_TIERS);
    kanraku += favorPleasureBonus(c.favor);
    if (kanraku < 0) kanraku = 0; // ERB 50
    return { [SOURCE_ID.歓楽]: kanraku };
  },

  body: (c) => {
    const grant = (slot: { state: { EXP: Record<number, number> } }, n: number) => {
      slot.state.EXP[EXP_ID.学習経験] = (slot.state.EXP[EXP_ID.学習経験] ?? 0) + n;
    };

    // ERB 58: master always gains 1 (even with no helper).
    grant(c.master, 1);

    if (lessonEngaged(c)) {
      // ERB 14-22: 信頼度管理 trust ladder (consumer deferred in source-check.ts).
      let trust = 3;
      const km = c.mAbl(ABL_ID.教養);
      const kt = c.tAbl(ABL_ID.教養);
      if (km > 2) trust++; // ERB 15-16
      if (km > kt) {
        trust++; // ERB 17-18
        grant(c.t, 2); // ERB 19 (target's 学習経験 += 2)
      }
      if (km < kt - 2) grant(c.master, 1); // ERB 21-22
      setTflag(c.next, TFLAG_ID.信頼度管理, trust);

      // ERB 52-53: non-DLC EXP grants (DLC arms deferred).
      grant(c.master, 1);
      grant(c.t, 1);

      // ERB 39-40: TCVAR:67:特殊事件 ++ (gated by 寺子屋 + 慧音行動==5, both
      // guaranteed by execCheck). DEFERRED — no TCVAR_ID.特殊事件 modeled and no
      // consumer; matches the M_TFLAG/ITEM deferral posture.
    }
  },

  narration: (c, favorDelta) => {
    if (!lessonEngaged(c)) {
      return `%CALLNAME:MASTER% 独自上了一课.`;
    }
    return `%CALLNAME:MASTER% 与%CALLNAME:TARGET%一同上课；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf441HandlerEntry: HandlerEntry = {
  ...makeComfHandler(comf441Def),
  execCheck: (ctx) => {
    const r = checkLessonEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
};
