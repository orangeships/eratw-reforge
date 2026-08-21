/**
 * Phase 7.5 (§3E follow-up) — `COMF332 お酒をふるまう` (serve alcohol). The
 * 酒/飲酒 mechanism lives in `runtime/state/alcohol.ts` (the @酒データ{N}
 * registry, @DRUNKEN, @ALCOHOL_TASTE, @EFFECT_酒データ{N}, @COM332_1 SOURCE).
 * This handler is the `@COM_ABLE332` execCheck + the `@COM332` orchestration:
 * pick alcohol → (refusal arms) → EFFECT + DOWNBASE master + consume +
 * DRUNKEN(master) + COM332_1(target) → TIME/同行 advance.
 *
 * **Parallel to `serve-meal.ts` (COMF415):** target-directed serve (the
 * master pours for the TARGET), master also drinks (`DRUNKEN(MASTER,…)` at
 * ERB 93, like 415's "master doesn't eat" — except here master DOES drink).
 *
 * **Ported faithfully (handler layer):**
 *   - **execCheck** (`@COM_ABLE332`, ERB 211-246): `FLAG:70` 時間停止 block,
 *     `TARGET<1` block, `CFLAG:睡眠` (TARGET) block, `CFLAG:陪睡中` block,
 *     `CFLAG:妊娠自覚状態==1` block, `BASE:MASTER:気力<=0` block, and a
 *     "no drinkable alcohol in inventory" block (the ERB picker returns 0 →
 *     `RETURN -1`; modeled as a precondition for a clean MVP). (`TFLAG:100` /
 *     `GLOBAL_COMABLE` catalog-reach, `BATHCHECK`, `デート相手`, `AT_HOME` /
 *     `ABL:親密<3` defer — no ROOMDATA/dating layer.)
 *   - **interactive picker** `酒一覧表示(1)` (ERB 10) — staged B9 picker over
 *     every drinkable inventory item, with a second prompt for the upstream
 *     说服 arm when a 下戸 target refuses.
 *   - **refusal arms** (ERB 26-85): 烂酔奸==2 && !恋慕, 酒気>2/3, 酒耐性==-2
 *     (the 说服 INPUT arm) — persuasion success sets TFLAG:193=1 and uses
 *     the upstream intimacy/talk/emotion score; failed persuasion applies the
 *     corresponding refusal reaction and does not consume the drink.
 *   - **serve path** (ERB 87-99): `EFFECT_酒データ{酒ID}(TARGET)` →
 *     `DOWNBASE:MASTER:気力+=50 / 体力+=10` → `ITEM--` → `DRUNKEN(MASTER,…)` →
 *     `COM332_1` (which internally `DRUNKEN(TARGET,…)` + SOURCE) → `TIME+=30`.
 *   - **CFLAG:MASTER:同行 += 30** (faithful to the eraTW 同行 convention used
 *     by meal/gathering; the ERB's `M_TFLAG:时间因子类型` defer).
 *
 * **DEFERRED (handler layer; mechanism deferrals in alcohol.ts header):**
 *   - `TFLAG:100` / `GLOBAL_COMABLE` reachability gates — catalog reach.
 *   - `BATHCHECK` / `デート相手` / `AT_HOME`+`親密<3` — need ROOMDATA/dating.
 *   - `PREVCOM == SELECTCOM` 反感=100 (no PREVCOM tracking).
 *   - `M_TFLAG:时间因子类型 = TimeFactor_话术` — no consumer.
 *   - `TFLAG:信頼度管理` — set in `computeDrinkSources`, no consumer wired.
 */
import type { GameState } from "../../state/game-state.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import type { PromptAnswer, PromptSpec } from "../prompt.js";
import { pickOne } from "../prompt.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck } from "../source-check.js";
import { itemCount, removeItem } from "../../state/items.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  advanceTimeTicks,
  getMasterCflag,
} from "../../state/settlement.js";
import {
  alcoholName,
  applyAlcoholEffect,
  computeDrinkSources,
  drunken,
  drinkableAlcoholIds,
  firstDrinkableAlcohol,
  isAlcohol,
  syncDrunkenness,
} from "../../state/alcohol.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";
import { collectCommandKojo } from "../command-kojo.js";
import { applyKojoEffects } from "../../kojo/effects.js";

// ---------------------------------------------------------------------------
function sequenceValues(answer: PromptAnswer | undefined): readonly (number | string)[] {
  return answer?.kind === "pick_sequence" ? answer.values : [];
}

function selectedItemId(answer: PromptAnswer | undefined): number | null {
  const values = sequenceValues(answer);
  const raw = values[0] ?? (answer?.kind === "pick_one" ? answer.value : undefined);
  if (raw === undefined || raw === "cancel") return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

function persuasionNeeded(state: GameState, target: number): boolean {
  const slot = state.charas[target];
  if (!slot) return false;
  const sakeMax = slot.state.MAXBASE[BASE_ID.酒気] ?? 0;
  const sakeCur = slot.state.BASE[BASE_ID.酒気] ?? 0;
  if ((slot.state.CFLAG[CFLAG_ID.烂酔奸] ?? 0) === 2 && !(slot.state.TALENT[TALENT_ID.恋慕] ?? 0)) {
    return false;
  }
  if (sakeMax > 0 && sakeCur > Math.trunc((sakeMax * 2) / 3)) return false;
  return (slot.state.TALENT[TALENT_ID.酒耐性] ?? 0) === -2 &&
    (slot.state.CFLAG[CFLAG_ID.不會喝酒] ?? 0) < 5;
}

export function serveDrinkPrompt(ctx: CommandContext): PromptSpec | null {
  const values = sequenceValues(ctx.promptAnswer);
  const itemId = selectedItemId(ctx.promptAnswer);
  if (values.length === 0 && ctx.promptAnswer?.kind !== "pick_one") {
    const options = drinkableAlcoholIds(ctx.state).map((id) => ({
      id,
      label: alcoholName(id),
      detail: `库存 ${itemCount(ctx.state, id)}`,
    }));
    return options.length > 0
      ? pickOne("要敬什么酒？", [...options, { id: "cancel", label: "放弃" }])
      : null;
  }
  if (itemId === null || !isAlcohol(itemId) || itemCount(ctx.state, itemId) < 1) return null;
  if (values.length <= 1 && persuasionNeeded(ctx.state, ctx.target)) {
    const targetName = ctx.state.charas[ctx.target]?.callName ?? `#${ctx.target}`;
    return pickOne(`${targetName}推托说自己不能喝酒。怎么办？`, [
      { id: 0, label: "放弃" },
      { id: 1, label: "说服" },
    ]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE332` core (ERB 211-246)
// ---------------------------------------------------------------------------

function checkServeDrinkEligible(
  state: GameState,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // ERB 242: 時間停止 (FLAG:70) → block.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中不能劝酒。" } };
  }
  // ERB 244: TARGET < 1 → block.
  if (target < 1) {
    return { ok: false, reason: { kind: "precondition", message: "没有劝酒的对象。" } };
  }
  const tSlot = state.charas[target];
  if (!tSlot) {
    return { ok: false, reason: { kind: "precondition", message: "没有劝酒的对象。" } };
  }
  // ERB 221: 睡眠中 → block.
  if ((tSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方睡着了。" } };
  }
  // ERB 224: 陪睡中 → block.
  if ((tSlot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方正在陪睡。" } };
  }
  // ERB 227: 妊娠自覚状態 == 1 → block.
  if ((tSlot.state.CFLAG[CFLAG_ID.妊娠自覚状態] ?? 0) === 1) {
    return { ok: false, reason: { kind: "precondition", message: "对方现在不适合喝酒。" } };
  }
  // ERB 239: BASE:MASTER:気力 <= 0 → block.
  if ((state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "没有劝酒的力气了。" } };
  }
  // ERB 229-237: BATHCHECK / デート相手 / AT_HOME+親密<3 — defer (no layer).
  // The picker returns -1 when no drinkable alcohol exists. Fail closed at
  // the command gate so the UI cannot advertise an action that can only
  // become a no-op after opening the picker.
  if (drinkableAlcoholIds(state).length === 0) {
    return { ok: false, reason: { kind: "precondition", message: "没有可饮用的酒。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM332` core (ERB 5-99)
// ---------------------------------------------------------------------------

export const serveDrinkHandlerEntry: HandlerEntry = {
  commandNo: 332,
  stagedPrompt: true,
  prompt: serveDrinkPrompt,
  execCheck: (ctx) => {
    const r = checkServeDrinkEligible(ctx.state, ctx.target);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    if (target < 1 || !next.charas[target]) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有劝酒的对象。" }],
        outcome: "noop" as const,
      };
    }
    const hasPromptSelection = sequenceValues(ctx.promptAnswer).length > 0 || ctx.promptAnswer?.kind === "pick_one";
    const itemId = selectedItemId(ctx.promptAnswer) ?? (hasPromptSelection ? null : firstDrinkableAlcohol(next));
    if (itemId === null) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有酒可以劝。" }],
        outcome: "noop" as const,
      };
    }
    if (!isAlcohol(itemId) || itemCount(next, itemId) < 1) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "选择的酒已经不在库存中了。" }],
        outcome: "noop" as const,
      };
    }

    const tSlot = next.charas[target]!;
    const drinkName = alcoholName(itemId);

    // TFLAG:193 = 0 (ERB 24) — success flag reset (the 说服 arm may set 1).
    setTflag(next, TFLAG_ID.SELECTCOM的分岐, 0);
    // TFLAG:194 = selected alcohol id. Personal COM332 kojo branches on this
    // through ALCOHOL_TASTE(TFLAG:194), so keep it visible to the router.
    setTflag(next, TFLAG_ID.SOURCEなどに影響しないSELECTCOMの分岐, itemId);

    // --- refusal arms (ERB 26-85) — 说服 INPUT (B9) deferred → refuse-noop ---
    // ERB 26: 烂酔奸==2 && !恋慕 → RETURN -1 (SOURCE:反感+=3000 dead pre-settle).
    const ransai = tSlot.state.CFLAG[CFLAG_ID.烂酔奸] ?? 0;
    const renbo = tSlot.state.TALENT[TALENT_ID.恋慕] ?? 0;
    if (ransai === 2 && !renbo) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "对方已经不想再和你喝酒了。" },
        ],
        outcome: "noop" as const,
      };
    }
    // ERB 34: BASE:酒気 > MAXBASE:酒気 * 2/3 → RETURN -1 (target too drunk).
    const sakeMax = tSlot.state.MAXBASE[BASE_ID.酒気] ?? 0;
    const sakeCur = tSlot.state.BASE[BASE_ID.酒気] ?? 0;
    if (sakeMax > 0 && sakeCur > Math.trunc((sakeMax * 2) / 3)) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "对方看起来已经不想再喝了。" },
        ],
        outcome: "noop" as const,
      };
    }
    // ERB 38-85: 下戸 can choose to give up or try to persuade the target.
    const tol = tSlot.state.TALENT[TALENT_ID.酒耐性] ?? 0;
    const wontDrink = tSlot.state.CFLAG[CFLAG_ID.不會喝酒] ?? 0;
    let persuasionText = "";
    if (tol === -2 && wontDrink < 5) {
      const values = sequenceValues(ctx.promptAnswer);
      const persuasion = values[1];
      if (persuasion !== 1 || target === 55) {
        setTflag(next, TFLAG_ID.SELECTCOM的分岐, -5);
        return {
          state: next,
          events: [
            { kind: "NARRATION" as const, timestamp: ctx.now(), text: "因为对方完全没有要喝酒的意思，所以放弃了。" },
          ],
          outcome: "noop" as const,
        };
      }

      const intimacy = tSlot.state.ABL[ABL_ID.親密] ?? 0;
      const talk = next.master.state.ABL[ABL_ID.話術技能] ?? 0;
      const emotion = tSlot.state.BASE[BASE_ID.情緒] ?? 0;
      const maxEmotion = tSlot.state.MAXBASE[BASE_ID.情緒] ?? 0;
      const persuasionScore = (intimacy * 200 + talk * 100 + Math.min(3, wontDrink) * 300) * emotion;
      const persuaded = maxEmotion > 0 && persuasionScore / maxEmotion >= 1500;
      if (persuaded) {
        tSlot.state.CFLAG[CFLAG_ID.不會喝酒] = wontDrink + 1;
        setTflag(next, TFLAG_ID.SELECTCOM的分岐, 1);
        persuasionText = "由于你的劝说，对方开始怯生生地喝起酒来。";
      } else if (wontDrink < -10) {
        applySourceCheck(next, target, { [SOURCE_ID.反感]: 3000 });
        tSlot.state.BASE[BASE_ID.情緒] = 0;
        tSlot.state.BASE[BASE_ID.憤怒] = 1500;
        setTflag(next, TFLAG_ID.好感度减少, 5);
        setTflag(next, TFLAG_ID.SELECTCOM的分岐, -2);
        return {
          state: next,
          events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "对方终于被惹火了。" }],
          outcome: "noop" as const,
        };
      } else {
        applySourceCheck(next, target, { [SOURCE_ID.反感]: 500 });
        tSlot.state.BASE[BASE_ID.情緒] = Math.trunc((tSlot.state.BASE[BASE_ID.情緒] ?? 0) / 2);
        setTflag(next, TFLAG_ID.好感度减少, 1);
        setTflag(next, TFLAG_ID.SELECTCOM的分岐, -1);
        return {
          state: next,
          events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "不管你怎么劝说，对方还是不肯喝酒。" }],
          outcome: "noop" as const,
        };
      }
    }

    // --- serve path (ERB 87-99) ---
    // TRYCALLFORM EFFECT_酒データ{酒ID}(TARGET) (ERB 87).
    applyAlcoholEffect(next, target, itemId);

    // DOWNBASE:MASTER:気力 += 50 / 体力 += 10 (ERB 88-89).
    const mWill = next.master.state.BASE[BASE_ID.気力] ?? 0;
    const mStam = next.master.state.BASE[BASE_ID.体力] ?? 0;
    next.master.state.BASE[BASE_ID.気力] = Math.max(0, mWill - 50);
    next.master.state.BASE[BASE_ID.体力] = Math.max(0, mStam - 10);

    // ITEM:(TFLAG:194) -- (ERB 91).
    removeItem(next, itemId, 1);

    // CALL DRUNKEN(MASTER, TFLAG:194) (ERB 93).
    drunken(next, 0, itemId, ctx.rng);

    // CALL COM332_1 (ERB 95) — internally DRUNKEN(TARGET) (ERB 109) + SOURCE.
    drunken(next, target, itemId, ctx.rng);
    const drunkenness = syncDrunkenness(next, target);
    const { sources, taste, favorBias } = computeDrinkSources(
      next,
      target,
      itemId,
      ctx.rng,
    );
    applySourceCheck(next, target, sources, favorBias);

    // TIME += 30 (ERB 97) + CFLAG:MASTER:同行 += 30 (同行 convention).
    // Preserve the pre-tick master companion value before the clock's
    // decrement/cleanup, then apply COMF332's ERB +30 addition.
    const masterCompanionBefore = getMasterCflag(next, CFLAG_ID.同行);
    advanceTimeTicks(next, 30);
    if (masterCompanionBefore > 0) {
      next.master.state.CFLAG[CFLAG_ID.同行] = masterCompanionBefore + 30;
    }

    const flavor =
      taste < 10
        ? "似乎不合对方的口味。"
        : taste >= 15
          ? "对方喝得很中意。"
          : "";
    const text = `向对方劝了${drinkName}。${flavor}（经过 30 分钟）`;
    const drunkEvents = drunkenness.map((transition) => ({
      kind: "NARRATION" as const,
      timestamp: ctx.now(),
      text: transition.kind === "became-drunk"
        ? "对方喝得酩酊大醉的样子。"
        : "对方酒醒了。",
    }));
    const kojo = collectCommandKojo({ ...ctx, state: next }, target, 332);
    return {
      state: kojo.effects.length > 0 ? applyKojoEffects(next, kojo.effects) : next,
      events: [
        ...(persuasionText ? [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: persuasionText }] : []),
        { kind: "NARRATION" as const, timestamp: ctx.now(), text },
        ...drunkEvents,
        ...kojo.events,
      ],
      outcome: "ok" as const,
      pendingKojoChoice: kojo.pendingKojoChoice,
      kojoHandled: true,
    };
  },
};
