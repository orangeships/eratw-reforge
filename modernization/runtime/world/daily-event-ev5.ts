/** Faithful deterministic slice of `DAIRY_EV5 OPPAI.ERB`. */

import type { ObservationEvent } from "../../schemas/types.js";
import type { PromptAnswer, PromptOption, PromptSpec } from "../command/prompt.js";
import type { Rng } from "../command/types.js";
import type { DailyEventSession, GameState } from "../state/game-state.js";
import { BASE_ID, CFLAG_ID, EXP_ID, TALENT_ID } from "../state/settlement.js";
import { TFLAG_ID, getTflag } from "../state/tflag.js";

export interface Ev5Context {
  now: () => number;
  sleepSeed: number;
  answer?: PromptAnswer;
}

export type Ev5Outcome =
  | { kind: "applied"; events: ObservationEvent[] }
  | { kind: "needs-input"; events: ObservationEvent[]; prompt: PromptSpec; session: DailyEventSession }
  | { kind: "unsupported"; reason: string };

const PREGNANCY_CUP_BONUS = CFLAG_ID.乳ランクアップ;

function narration(now: () => number, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: now(), text };
}

function answerValue(answer: PromptAnswer | undefined): number | string | undefined {
  return answer?.kind === "pick_one" ? answer.value : undefined;
}

function session(state: GameState, context: Ev5Context, phase: DailyEventSession["phase"], data: Record<string, number | string | boolean>): DailyEventSession {
  return { kind: "ev5-oppai", eventId: 5, eventDay: state.time.dayIndex, sleepSeed: context.sleepSeed, phase, data };
}

function needsInput(state: GameState, context: Ev5Context, phase: DailyEventSession["phase"], question: string, options: PromptOption[], data: Record<string, number | string | boolean>, lines: string[]): Ev5Outcome {
  return {
    kind: "needs-input",
    events: lines.map((line) => narration(context.now, line)),
    prompt: { kind: "pick_one", question, options },
    session: session(state, context, phase, data),
  };
}

function repeatPrompt(state: GameState, context: Ev5Context, active: DailyEventSession): Ev5Outcome {
  const view = ev5PromptView(state, active);
  if (!view) return { kind: "unsupported", reason: `EV5 cannot render phase ${active.phase}` };
  return {
    kind: "needs-input",
    events: view.lines.map((line) => narration(context.now, line)),
    prompt: view.prompt,
    session: active,
  };
}

function allSlots(state: GameState) {
  return [state.master, ...Object.values(state.charas)].sort((a, b) => a.charaNum - b.charaNum);
}

function eligibleCupTargets(state: GameState, direction: number) {
  return allSlots(state).filter((slot) => {
    if ((slot.state.TALENT[TALENT_ID.性別] ?? 0) !== 1) return false;
    if ((slot.state.CFLAG[CFLAG_ID.出禁] ?? 0) !== 0) return false;
    if ((slot.state.TALENT[TALENT_ID.路人] ?? 0) !== 0) return false;
    const effective = (slot.state.TALENT[TALENT_ID.胸围] ?? 0) - (slot.state.CFLAG[PREGNANCY_CUP_BONUS] ?? 0);
    return direction > 0 ? effective < 2 : effective > -2;
  });
}

function cupLabel(value: number): string {
  if (value <= -2) return "壁";
  if (value === -1) return "贫";
  if (value === 0) return "普";
  if (value === 1) return "巨";
  return "爆";
}

function applyCupBlessing(state: GameState, charaNum: number, direction: number): string | null {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot || !eligibleCupTargets(state, direction).some((candidate) => candidate.charaNum === charaNum)) return null;
  const cup = slot.state.TALENT[TALENT_ID.胸围] ?? 0;
  const pregnancyBonus = slot.state.CFLAG[PREGNANCY_CUP_BONUS] ?? 0;
  if (direction > 0 && cup === 2 && pregnancyBonus !== 0) {
    delete slot.state.CFLAG[PREGNANCY_CUP_BONUS];
  } else {
    slot.state.TALENT[TALENT_ID.胸围] = Math.max(-2, Math.min(2, cup + direction));
  }
  return `${slot.callName ?? `#${charaNum}`}的胸部被祝福了，胸围${direction > 0 ? "变大" : "变小"}了！`;
}

export function ev5Condition(state: Readonly<GameState>, rng: Rng): boolean {
  const denominator = Math.max(1, 30 - getTflag(state as GameState, TFLAG_ID.OPPAI) * 25);
  return rng.int(denominator) === 0;
}

export function runEv5(state: GameState, rng: Rng, context: Ev5Context): Ev5Outcome {
  const replay = state.dailyEventSession?.kind === "ev5-oppai" ? state.dailyEventSession : undefined;
  const godType = Number(replay?.data?.godType ?? rng.int(9));
  const phase = replay?.phase ?? "oppai-choice";
  const selected = answerValue(context.answer);
  const masterName = state.master.callName ?? "主人公";

  if (phase === "oppai-choice") {
    const unlocked = (state.master.state.CFLAG[CFLAG_ID.累計膣内精液] ?? 0) +
      (state.master.state.CFLAG[CFLAG_ID.累計肛門精液] ?? 0) +
      (state.master.state.CFLAG[CFLAG_ID.累計精飲] ?? 0) >= 5000;
    if (selected === undefined) {
      const godName = godType <= 4 ? "胸部神" : godType <= 6 ? "巨乳之神" : "贫乳之神";
      return needsInput(state, context, phase, "巨乳和贫乳、你喜欢哪一个……", [
        { id: "large", label: "大的" }, { id: "small", label: "小的" },
        { id: "equal", label: "胸部没有贵贱" },
        { id: "futanari", label: "喜欢扶她肉棒", disabled: !unlocked, detail: unlocked ? undefined : "累计体内/饮用精液达到 5000 后解锁" },
      ], { godType }, [`${masterName}在迷迷糊糊中，听到了不可思议的声音。`, `${godName}正在心里直接询问你的喜好。`]);
    }
    if (!["large", "small", "equal", "futanari"].includes(String(selected)) || (selected === "futanari" && !unlocked)) {
      return { kind: "unsupported", reason: "EV5 received an invalid or locked preference" };
    }
    if (godType <= 4) {
      if (godType === 0 && selected === "futanari") {
        return needsInput(state, context, "oppai-futanari-choice", "扶她之神允许你说出一个愿望。", [
          { id: "nothing", label: "没什么" }, { id: "grow", label: "让某人长出扶她肉棒" },
          { id: "strengthen", label: "强化某人的扶她肉棒" }, { id: "taste", label: "想吃扶她肉棒" },
          { id: "underwear", label: "请给我内裤", disabled: true, detail: "原版会拒绝并重新询问" },
        ], { godType }, ["声音主人的气息突然变得强大。", "“你对扶她肉棒的爱真是了不起。给你奖励，说出你的愿望吧。”"]);
      }
      state.money += 10000;
      return { kind: "applied", events: [narration(context.now, selected === "futanari" ? "（无效回答、啊）" : "谢谢你的合作……"), narration(context.now, `${masterName}的户头上汇入了 10000！`)] };
    }
    const direction = godType <= 6 ? 1 : -1;
    const response = selected === "large" ? direction : selected === "small" ? -direction : selected === "equal" ? 0 : 2;
    if (response === -1) {
      if ((state.master.state.ABL[42] ?? 0) < 5) {
        state.master.state.BASE[BASE_ID.体力] = Math.max(0, (state.master.state.BASE[BASE_ID.体力] ?? 0) - 5000);
        return { kind: "applied", events: [narration(context.now, `偏离${direction > 0 ? "巨乳" : "贫乳"}之道的回答激怒了神。`), narration(context.now, `${masterName}在冲击中失去了意识。`)] };
      }
      return needsInput(state, context, "oppai-correction", "战斗力胜过欧派神后，要怎么处置她？", [
        { id: "punish", label: "必须惩戒！" }, { id: "drive", label: "赶走" },
      ], { godType, direction }, ["你凭直觉接下了邪神的攻击，抓住了史莱姆一样的贫乳小鬼。"]);
    }
    if (response === 0 || response === 2) {
      return { kind: "applied", events: [narration(context.now, response === 0 ? "可悲的无信仰之人……那之后声音就断绝了。" : "竟然会选那个……那之后声音就断绝了。")] };
    }
    return needsInput(state, context, "oppai-target", `愿${direction > 0 ? "巨乳" : "贫乳"}的加护与你同在。`, [
      { id: "rub", label: "请让我揉欧派" }, { id: "bless", label: "请让我为欧派祝福" },
    ], { godType, direction, stage: "method" }, ["只要不忘记这份心意，欧派就永远是你的伙伴……"]);
  }

  if (phase === "oppai-correction") {
    if (selected === undefined) return repeatPrompt(state, context, replay!);
    if (selected === "punish") {
      state.master.state.EXP[EXP_ID.挿入経験] = (state.master.state.EXP[EXP_ID.挿入経験] ?? 0) + rng.int(5);
      state.master.state.EXP[EXP_ID.射精経験] = (state.master.state.EXP[EXP_ID.射精経験] ?? 0) + rng.int(5);
      state.master.state.EXP[EXP_ID.絶頂経験] = (state.master.state.EXP[EXP_ID.絶頂経験] ?? 0) + rng.int(5);
      state.master.state.BASE[BASE_ID.体力] = Math.max(0, (state.master.state.BASE[BASE_ID.体力] ?? 0) - 500);
      state.master.state.BASE[BASE_ID.気力] = Math.max(0, (state.master.state.BASE[BASE_ID.気力] ?? 0) - 550);
      const semen = 500 + rng.int(100);
      state.master.state.BASE[BASE_ID.精力] = Math.max(0, (state.master.state.BASE[BASE_ID.精力] ?? 0) - semen);
      return { kind: "applied", events: [narration(context.now, "邪神受到了惩戒，在莫大的耻辱中消失了。"), narration(context.now, `主人公消耗了 ${semen} 点精力。`)] };
    }
    if (selected === "drive") return { kind: "applied", events: [narration(context.now, "一拳把欧派神打飞了。她捂着脸消失了……")] };
    return { kind: "unsupported", reason: "EV5 correction answer is invalid" };
  }

  if (phase === "oppai-futanari-choice") {
    if (selected === undefined) return repeatPrompt(state, context, replay!);
    if (selected === "nothing") return { kind: "applied", events: [narration(context.now, "“不懂风趣……就这样吧。”强大的气息离开了。") ] };
    if (selected === "taste") {
      state.master.state.BASE[BASE_ID.体力] = (state.master.state.BASE[BASE_ID.体力] ?? 0) + 2000;
      state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) + 2000;
      return { kind: "applied", events: [narration(context.now, "超越人知的恩赐让主人公在苦闷与至福中失去了意识。"), narration(context.now, "体力与气力各恢复了 2000。") ] };
    }
    if (selected === "grow" || selected === "strengthen") {
      const candidates = allSlots(state).filter((slot) => selected === "grow"
        ? (slot.state.TALENT[TALENT_ID.性別] ?? 0) === 1
        : (slot.state.TALENT[TALENT_ID.性別] ?? 0) === 3 && (slot.state.MAXBASE[BASE_ID.精力] ?? 0) < 1500);
      if (candidates.length === 0) return { kind: "unsupported", reason: `EV5 has no eligible ${selected} target` };
      return needsInput(state, context, "oppai-target", selected === "grow" ? "选谁长出扶她肉棒？" : "强化谁的扶她肉棒？", candidates.map((slot) => ({ id: slot.charaNum, label: slot.callName ?? `#${slot.charaNum}` })), { godType, stage: selected }, []);
    }
    return { kind: "unsupported", reason: "EV5 futanari wish is invalid" };
  }

  if (phase === "oppai-target") {
    const stage = String(replay?.data?.stage ?? "");
    if (selected === undefined) return repeatPrompt(state, context, replay!);
    if (stage === "method") {
      if (selected === "rub") {
        const gained = (state.master.state.TALENT[TALENT_ID.器用な指] ?? 0) === 0;
        state.master.state.TALENT[TALENT_ID.器用な指] = 1;
        return { kind: "applied", events: [narration(context.now, gained ? "主人公得到了【灵活手指】！" : "若你对欧派爱得真切，终有一天定能揉到欧派……"), narration(context.now, "在胸部包围般的惬意中，意识坠入梦寐……")] };
      }
      if (selected === "bless") {
        const direction = Number(replay?.data?.direction ?? 0);
        const targets = eligibleCupTargets(state, direction);
        if (targets.length === 0) return { kind: "unsupported", reason: "EV5 has no eligible cup-blessing target" };
        return needsInput(state, context, phase, "祝福谁的胸部？", targets.map((slot) => ({ id: slot.charaNum, label: `${slot.callName ?? `#${slot.charaNum}`}（${cupLabel(slot.state.TALENT[TALENT_ID.胸围] ?? 0)}）` })), { ...replay!.data, stage: "cup-target" }, []);
      }
      return { kind: "unsupported", reason: "EV5 blessing method is invalid" };
    }
    const charaNum = Number(selected);
    if (stage === "cup-target") {
      const text = applyCupBlessing(state, charaNum, Number(replay?.data?.direction ?? 0));
      return text ? { kind: "applied", events: [narration(context.now, text), narration(context.now, "在胸部包围般的惬意中，意识坠入梦寐……")] } : { kind: "unsupported", reason: "EV5 cup target is no longer eligible" };
    }
    const slot = charaNum === 0 ? state.master : state.charas[charaNum];
    if (!slot) return { kind: "unsupported", reason: "EV5 target disappeared" };
    if (stage === "grow" && (slot.state.TALENT[TALENT_ID.性別] ?? 0) === 1) {
      slot.state.TALENT[TALENT_ID.性別] = 3;
      return { kind: "applied", events: [narration(context.now, `${slot.callName ?? `#${charaNum}`}变成了扶她。`)] };
    }
    if (stage === "strengthen" && (slot.state.TALENT[TALENT_ID.性別] ?? 0) === 3 && (slot.state.MAXBASE[BASE_ID.精力] ?? 0) < 1500) {
      slot.state.MAXBASE[BASE_ID.精力] = (slot.state.MAXBASE[BASE_ID.精力] ?? 0) + 100;
      return { kind: "applied", events: [narration(context.now, `${slot.callName ?? `#${charaNum}`}的精力最大值增加了 100。`)] };
    }
    return { kind: "unsupported", reason: "EV5 target is no longer eligible" };
  }

  return { kind: "unsupported", reason: `unsupported EV5 phase ${phase}` };
}

export function ev5PromptView(state: Readonly<GameState>, active: DailyEventSession): { prompt: PromptSpec; lines: string[] } | null {
  if (active.kind !== "ev5-oppai") return null;
  const godType = Number(active.data?.godType ?? 0);
  const direction = Number(active.data?.direction ?? 0);
  const stage = String(active.data?.stage ?? "");
  const unlocked = (state.master.state.CFLAG[CFLAG_ID.累計膣内精液] ?? 0) + (state.master.state.CFLAG[CFLAG_ID.累計肛門精液] ?? 0) + (state.master.state.CFLAG[CFLAG_ID.累計精飲] ?? 0) >= 5000;
  if (active.phase === "oppai-choice") return { prompt: { kind: "pick_one", question: "巨乳和贫乳、你喜欢哪一个……", options: [{ id: "large", label: "大的" }, { id: "small", label: "小的" }, { id: "equal", label: "胸部没有贵贱" }, { id: "futanari", label: "喜欢扶她肉棒", disabled: !unlocked }] }, lines: [`${state.master.callName ?? "主人公"}在迷迷糊糊中听到了${godType <= 4 ? "胸部神" : godType <= 6 ? "巨乳之神" : "贫乳之神"}的声音。`] };
  if (active.phase === "oppai-correction") return { prompt: { kind: "pick_one", question: "要怎么处置欧派神？", options: [{ id: "punish", label: "必须惩戒！" }, { id: "drive", label: "赶走" }] }, lines: ["你凭直觉接下了邪神的攻击。"] };
  if (active.phase === "oppai-futanari-choice") return { prompt: { kind: "pick_one", question: "说出你的愿望吧。", options: [{ id: "nothing", label: "没什么" }, { id: "grow", label: "长出扶她肉棒" }, { id: "strengthen", label: "强化扶她肉棒" }, { id: "taste", label: "想吃扶她肉棒" }, { id: "underwear", label: "请给我内裤", disabled: true }] }, lines: ["扶她之神的气息变得强大。"] };
  if (active.phase === "oppai-target") {
    if (stage === "method") return { prompt: { kind: "pick_one", question: `愿${direction > 0 ? "巨乳" : "贫乳"}的加护与你同在。`, options: [{ id: "rub", label: "请让我揉欧派" }, { id: "bless", label: "请让我为欧派祝福" }] }, lines: [] };
    const targets = stage === "cup-target" ? eligibleCupTargets(state as GameState, direction) : allSlots(state as GameState).filter((slot) => stage === "grow" ? (slot.state.TALENT[TALENT_ID.性別] ?? 0) === 1 : (slot.state.TALENT[TALENT_ID.性別] ?? 0) === 3 && (slot.state.MAXBASE[BASE_ID.精力] ?? 0) < 1500);
    return { prompt: { kind: "pick_one", question: stage === "cup-target" ? "祝福谁的胸部？" : "选择对象", options: targets.map((slot) => ({ id: slot.charaNum, label: slot.callName ?? `#${slot.charaNum}` })) }, lines: [] };
  }
  return null;
}
