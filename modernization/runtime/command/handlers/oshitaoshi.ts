/**
 * Phase 7 — `COMF350 押し倒す` (the H-mode entry gate).
 *
 * Family 7 — the C-tier state-machine gate. After this port succeeds,
 * the H-mode flag (`CFLAG:317 诶嘿嘿`) flips on both master and target,
 * making the entire intimate-family catalog (8-13: foreplay / toys /
 * positions / oral / SM / self) REACHABLE in the playable slice.
 *
 * **Faithful core ported** (`ERB/コマンド関連/COMF/日常系/COMF350 押し倒す.ERB`,
 * the normal-branch path: no 時停, no 潜伏, single target, sober):
 *
 *   1. `@COM_ABLE350` core (ERB line 355-432), simplified to what we can
 *      evaluate in our runtime:
 *        - target present (resolver contract; `ctx.target > 0`)
 *        - target not sleeping (`CFLAG:313 != 1`)
 *        - master 気力 > 0 (`BASE:1 > 0`)
 *      Defer: 甲斐性無 (`FLAG:1040`), 约会-location gate (情人旅館 /
 *      情人用宿屋 / OMANEKIBEYA — line 418), 特殊诶嘿嘿条件 (line 311),
 *      時停/潜伏 bypass (lines 100-196).
 *
 *   2. Consent gate (ERB line 132 / 221): `GETBIT(CFLAG:既成事實, 1) ||
 *      TALENT:合意誤認`. Without consent → blocked (`抱き寄せ` flow
 *      deferred — see DEFERRED below).
 *
 *   3. Mood + atmosphere gate (ERB line 249): the consent-acquired
 *      branch blocks on `BASE:情緒 < 300 || TCVAR:MASTER:亲热 < 2`.
 *      Faithful.
 *
 *   4. On success (ERB line 261-269 `$OK` label, consent branch):
 *        - `CFLAG:317 诶嘿嘿 = 1` on target
 *        - `CFLAG:MASTER:317 诶嘿嘿 = 1`
 *        - `BASE:情緒` floor to 300
 *        - `TIME += 1`
 *      Defer: 既成事實 bit 1 lift (it's the gate's precondition, set
 *      here is defensive only); DATUI_SHOES shoes-removal (line 177);
 *      UWAKI_RECORD cheating log (line 292); UFUFU_START_TIME/DAY
 *      record (line 301-304) — WorldScheduler Phase 8 will own the
 *      H-mode session envelope; TFLAG:COMABLE管理 = 2 (line 296).
 *
 *   5. On blocked (ERB line 275-281):
 *        - `DOWNBASE:MASTER:気力 = 50`
 *        - `BASE:TARGET:情緒 /= 2` (truncating int divide)
 *      Defer: `CALL ENDUFUFU_ALL` (line 276), `TFLAG:102 = 0` (line 279).
 *
 * **Subsystem used.** This handler reads `computeConsentJudgement`,
 * `computeAttitude`, `computeShinchitsu`, and `hConsentAcquired` from
 * `runtime/state/attitude.ts`. Those helpers faithfully mirror
 * ATTITUDE.ERB + INFO.ERB with documented defers (信頼度, MARK, 薬,
 * 討厭男人/HETEROSEX, 催眠強度).
 *
 * **DEFERRED (documented — matching 5C/5D/7A/B1 port precedent):**
 *   - **`抱き寄せ` consent acquisition** (ATTITUDE.ERB:142-340). The
 *     pre-consent branch of 押し倒す calls 抱き寄せ which compares
 *     好意判定値 vs 抱き寄せ必要値 and SETBITs 既成事實 bit 1 on success.
 *     Faithful core involves kojo PERMISSION (lines 139-152 of COMF350)
 *     and many二次補正 arms (発情/媚薬/ヤラせちゃった/仙香玉兎/時姦/
 *     体外/敗犬/守矢约会). Until B8 (interactive prompt) lands, our
 *     slice requires 既成事實 bit 1 to be pre-seeded (or 合意誤認 set).
 *   - **時停 (FLAG:70) bypass arm** (COMF350:97-188): the time-stop
 *     branch is parallel to normal but with 时停者 consent gates.
 *     Defer until Phase 8 (WorldScheduler) decides the time-stop
 *     session model.
 *   - **潜伏 (FLAG:99) bypass arm** (COMF350:189-196): stalking mode
 *     "regain initiative" — defer (FLAG:99 not modeled).
 *   - **多人数 (NUM_TARGET > 1)** (COMF350:108-111, 134, 223): the
 *     resolver contract is single-target for the daily slice.
 *   - **烂醉** (TCVAR): drunk-rape branch (COMF350:123-131). Defer.
 *   - **EYEWITNESS / DATUI_SHOES / UWAKI_RECORD / UFUFU_START_*:**
 *     side-effect helpers from ERB that map to scheduler / log
 *     concerns (Phase 8).
 *   - **TFLAG:194 (refusal code) / TFLAG:102 / TFLAG:COMABLE管理:**
 *     TFLAG namespace is not yet a modeled GameState namespace.
 *   - **`FLAG:70` (時間停止) and `FLAG:99` (潜伏) bypass arms:**
 *     same defer.
 *   - **好感度 gains on success:** 抱き寄せ / success arms add
 *     `SOURCE:情愛` (CASE 6 in 抱き寄せ, line 250) which then routes
 *     through `applySourceCheck`. We skip settlement entirely (no
 *     SOURCE is built) so the 情愛 delta is deferred uniformly with
 *     every other command's FAVOR_CALC. Same caveat as the 5D port.
 */

import type {
  CommandContext,
  HandlerEntry,
} from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  TALENT_ID,
  advanceTimeTicks,
  getMasterBase,
  setCharaBase,
  setCharaCflag,
  setMasterBase,
  setMasterCflag,
} from "../../state/settlement.js";
import {
  computeAttitude,
  computeShinchitsu,
  hConsentAcquired,
  liftedConsentJudgement,
} from "../../state/attitude.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";
import { collectCommandKojo } from "../command-kojo.js";
import { applyKojoEffects } from "../../kojo/effects.js";

const H_CONSENT_BIT = 1 << 1;

/** `抱き寄せ必要値(ARG)` (ATTITUDE.ERB).  Drug, item and edging values have
 * no deterministic state yet and therefore retain their upstream default 0;
 * all ordinary relationship and character modifiers are evaluated here. */
function embraceResistance(target: NonNullable<CommandContext["state"]["charas"][number]>, state: CommandContext["state"]): number {
  const talent = target.state.TALENT;
  const established = target.state.CFLAG[CFLAG_ID.既成事実] ?? 0;
  let required = 350;
  required += (talent[TALENT_ID.一線越えない] ?? 0) * 50;
  required += (talent[TALENT_ID.自尊心] ?? 0) * 30;
  required += computeAttitude(target, state.master, state) * 20;
  required -= (talent[TALENT_ID.性的兴趣] ?? 0) * 20;
  required += (talent[TALENT_ID.貞操] ?? 0) * 50;
  if ((established & 1) === 0) required += 20;
  if ((talent[TALENT_ID.思慕] ?? 0) === 0 &&
      (talent[TALENT_ID.恋慕] ?? 0) === 0 &&
      (talent[TALENT_ID.愛欲] ?? 0) === 0) required += 50;
  if ((talent[TALENT_ID.無知] ?? 0) !== 0) required -= 50;
  if ((target.state.CFLAG[CFLAG_ID.弱み握り] ?? 0) > 0) required -= 50;
  required -= Math.trunc((target.state.CFLAG[CFLAG_ID.溜まってる度] ?? 0) / 20);
  return required;
}

function collectOshitaoshiKojo(ctx: CommandContext, state: CommandContext["state"]) {
  const kojo = collectCommandKojo({ ...ctx, state });
  return {
    state: kojo.effects.length > 0 ? applyKojoEffects(state, kojo.effects) : state,
    events: kojo.events,
  };
}

// ---------------------------------------------------------------------------
// execCheck — the precondition phase (ERB `@COM_ABLE350` core)
// ---------------------------------------------------------------------------

function checkOshitaoshiEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // Target must be present (5A resolver contract — `ctx.target` defaults to
  // the actor when no explicit target is given).
  if (ctx.target <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "押し倒す需要目标角色在场。" } };
  }
  const targetSlot = ctx.state.charas[ctx.target];
  if (!targetSlot) {
    return { ok: false, reason: { kind: "precondition", message: "目标角色不存在。" } };
  }
  // ERB line 424-425: target must not be sleeping.
  if ((targetSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "目标正在睡觉。" } };
  }
  // ERB line 427-428: master 気力 must be > 0.
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法行动。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — the settlement phase (ERB `@COM350` core)
// ---------------------------------------------------------------------------

export const oshitaoshiHandlerEntry: HandlerEntry = {
  commandNo: 350,
  execCheck: (ctx) => {
    const r = checkOshitaoshiEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    const master = next.master;
    const frozenTarget =
      (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
      (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0;

    // COM350 has an explicit time-stop arm upstream. A frozen target does
    // not negotiate consent or mood, and time itself does not advance.
    if (frozenTarget) {
      setCharaCflag(next, ctx.target, CFLAG_ID.诶嘿嘿, 1);
      setMasterCflag(next, CFLAG_ID.诶嘿嘿, 1);
      return {
        state: next,
        events: [{
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: "%CALLNAME:MASTER%趁时间停止推倒了%CALLNAME:TARGET%。",
        }],
        outcome: "ok",
        kojoHandled: true,
      };
    }

    // ----- Consent gate (ERB line 132 / 221 + ATTITUDE.ERB 抱き寄せ) -----
    // The standard deterministic route acquires consent by comparing the
    // original goodwill and resistance values.  Unmodeled drug/item/forced
    // branches never fabricate consent.
    if (!hConsentAcquired(target)) {
      const goodwill = liftedConsentJudgement(target, master, next);
      const resistance = embraceResistance(target, next);
      if (goodwill >= resistance) {
        target.state.CFLAG[CFLAG_ID.既成事実] =
          (target.state.CFLAG[CFLAG_ID.既成事実] ?? 0) | H_CONSENT_BIT;
      } else {
        setTflag(next, TFLAG_ID.SELECTCOM的分岐, -1);
        const kojo = collectOshitaoshiKojo(ctx, next);
        return {
          state: kojo.state,
          events: [
            {
              kind: "NARRATION",
              timestamp: ctx.now(),
              text: `%CALLNAME:TARGET%拒绝了靠近。（合意判定 ${goodwill} / 需要 ${resistance}）`,
            },
            ...kojo.events,
          ],
          outcome: "blocked",
          kojoHandled: true,
          failReason: {
            kind: "precondition",
            message: `尚未取得合意（合意判定 ${goodwill} < 抱き寄せ必要值 ${resistance}）`,
          },
        };
      }
    }
    setTflag(next, TFLAG_ID.SELECTCOM的分岐, 0);

    // ----- Mood + atmosphere gate (ERB line 158 / 249) -----
    // Bypass arms (ERB line 158-159): 風騷 TALENT, 守矢约会 target,
    // CFLAG:诶嘿嘿 already, FLAG:催眠強度 > 75 — these GOTO OK without
    // the gate check (era's "she's so lewd it doesn't matter" path).
    // For our slice we model the 風騷 TALENT bypass only (the others are
    // deferred subsystems: 守矢约会 lottery, time-stop 催眠, and re-entry).
    const bypass =
      (target.state.TALENT[TALENT_ID.風騷] ?? 0) > 0;

    // The faithful OR: blocked if EITHER 情緒 < 300 OR 亲热 < 2. Note
    // 亲热 is the TARGET's per INFO.ERB (single-target collapse).
    const seicho = target.state.BASE[BASE_ID.情緒] ?? 0;
    const shinchitsu = computeShinchitsu(target, master, ctx.state);
    if (!bypass && (seicho < 300 || shinchitsu < 2)) {
      // Failure path (ERB line 275-281, $不让推倒).
      // 1. Master 気力 -= 50.
      const masterKiBefore = getMasterBase(next, BASE_ID.気力) ?? 0;
      setMasterBase(next, BASE_ID.気力, masterKiBefore - 50);
      // 2. Target 情緒 /= 2 (truncating int divide — BASE defaults 5C).
      setCharaBase(next, ctx.target, BASE_ID.情緒, Math.trunc(seicho / 2));
      // 3. The faithful code sets 既成事實 bit 1 here too on the
      //    "consent-acquired → blocked on mood" path? Re-reading the
      //    ERB — no: 既成事實 bit 1 is only lifted inside 抱き寄せ
      //    (line 178), not in the $OK/$不让推倒 arms (line 261-269).
      //    We just record the failed attempt.
      const kojo = collectOshitaoshiKojo(ctx, next);
      return {
        state: kojo.state,
        events: [
          {
            kind: "NARRATION",
            timestamp: ctx.now(),
            text: `%CALLNAME:MASTER% 试着推倒 %CALLNAME:TARGET%，但气氛不对、被打断了。`,
          },
          ...kojo.events,
        ],
        outcome: "blocked",
        kojoHandled: true,
        failReason: {
          kind: "precondition",
          message: `情緒(${seicho}) 或 亲热(${shinchitsu}) 未达标`,
        },
      };
    }

    // ----- Success path (ERB line 261-269, $OK label) -----
    // 1. Target 诶嘿嘿 = 1.
    setCharaCflag(next, ctx.target, CFLAG_ID.诶嘿嘿, 1);
    // 2. Master 诶嘿嘿 = 1 (line 295 of COMF350).
    setMasterCflag(next, CFLAG_ID.诶嘿嘿, 1);
    // 3. Target 情緒 floor to 300 (line 263-264). Only reachable via
    //    the 風騷 bypass arm — the gate above already requires
    //    情緒 ≥ 300, so this clamp is bypass-only.
    if (bypass && seicho < 300) {
      setCharaBase(next, ctx.target, BASE_ID.情緒, 300);
    }
    // 4. TIME += 1 (line 297-298, the !FLAG:70 branch).
    advanceTimeTicks(next, 1);

    const kojo = collectOshitaoshiKojo(ctx, next);
    return {
      state: kojo.state,
      events: [
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 推倒了 %CALLNAME:TARGET%，进入了 诶嘿嘿 状态。`,
        },
        ...kojo.events,
      ],
      outcome: "ok",
      kojoHandled: true,
    };
  },
};
