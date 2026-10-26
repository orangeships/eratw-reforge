/** Deterministic port of `@DAILYEVENT` (AFTERTRA.ERB:1141-1162). */

import type { ObservationEvent } from "../../schemas/types.js";
import { isObservationEvent } from "../../schemas/validator.js";
import type { PromptAnswer, PromptSpec } from "../command/prompt.js";
import type { Rng } from "../command/types.js";
import type { DialogueRouter, KojoLine } from "../kojo/types.js";
import { applyKojoEffects } from "../kojo/effects.js";
import {
  cloneGameState,
  type DailyEventSession,
  type EventPromptLine,
  type EventPromptSpec,
  type GameState,
} from "../state/game-state.js";
import { buffBase } from "../state/buff.js";
import { addItem } from "../state/items.js";
import { ITEM_ID, hasItem } from "../state/items.js";
import { TFLAG_ID, getTflag, setTflagBit } from "../state/tflag.js";
import { createGift } from "../state/gifts.js";
import { ABL_ID, BASE_ID, CFLAG_ID, FLAG_ID, TALENT_ID, EVENT_FLAG_ALIASES as EVENT_FLAGS, recoverBase } from "../state/settlement.js";
import { getYogore, setYogore } from "../state/yogore.js";
import { ABNORMAL_WEATHER } from "../weather/abnormal-weather.js";
import { WEATHER_ID } from "../weather/constants.js";
import {
  currentRegionWeather,
  qolForceSetRegionRainbowSystem,
  qolForceSetRegionWeatherSystem,
  qolForceSetRegionWindVeSystem,
} from "../weather/region-override.js";
import {
  DAILY_MESS_PROMPT,
  dailyMessCondition,
  runDailyMessEvent,
} from "./daily-mess.js";
import {
  compileEventOpportunitySet,
  consumeEventRanking,
  type EventOpportunitySet,
} from "./event-ranking.js";
import { ev5Condition, ev5PromptView, runEv5 } from "./daily-event-ev5.js";
import { ev23Condition, ev23PromptView, runEv23 } from "./daily-event-ev23.js";
import { mapIdOfLocation } from "./location-predicates.js";

export const DAILY_EVENT_SLOT_COUNT = 40;

export interface DailyEventDiagnostic {
  eventId?: number;
  phase: "condition" | "effect" | "replay" | "validation";
  message: string;
}

export interface DailyEventEffectContext {
  now: () => number;
  sleepSeed: number;
  answer?: PromptAnswer;
  router?: DialogueRouter;
  session?: DailyEventSession | null;
}

export type DailyEventEffectOutcome =
  | { kind: "applied"; events: ObservationEvent[] }
  | {
      kind: "needs-input";
      events: ObservationEvent[];
      prompt: PromptSpec;
      session: DailyEventSession;
    }
  | { kind: "unsupported"; reason: string };

export interface DailyEventDefinition {
  readonly id: number;
  readonly label: string;
  readonly condition: (state: Readonly<GameState>, rng: Rng) => boolean;
  readonly effect: (
    state: GameState,
    rng: Rng,
    context: DailyEventEffectContext,
  ) => DailyEventEffectOutcome;
}

export interface DailyEventPending {
  eventId: number;
  prompt: PromptSpec;
  previewEvents: ObservationEvent[];
  session: DailyEventSession;
}

export interface DailyEventDispatchResult {
  events: ObservationEvent[];
  firedEventId?: number;
  pending?: DailyEventPending;
  diagnostics: DailyEventDiagnostic[];
}

export interface DailyEventRunOptions {
  sleepSeed: number;
  now?: () => number;
  answer?: PromptAnswer;
  router?: DialogueRouter;
}

function narration(now: () => number, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: now(), text };
}

function dialogueEvents(now: () => number, charaNum: number, lines: readonly KojoLine[]): ObservationEvent[] {
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: now(),
    charaNum,
    text: line.text,
    form: line.form,
  }));
}

function fisherYatesCharaNums(state: Readonly<GameState>, rng: Rng): number[] {
  const ids = [0, ...Object.keys(state.charas).map(Number).filter(Number.isFinite)].sort((a, b) => a - b);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

function dailyKojoChoicePath(context: DailyEventEffectContext): number[] {
  const encoded = context.session?.kind === "daily-kojo" && typeof context.session.data?.choices === "string"
    ? context.session.data.choices
    : "";
  const choices = encoded.length > 0
    ? encoded.split(",").map(Number).filter(Number.isFinite)
    : [];
  const answer = context.answer;
  if (answer?.kind === "pick_one" && Number.isFinite(Number(answer.value))) choices.push(Number(answer.value));
  else if (answer?.kind === "ask_yn") choices.push(answer.value ? 1 : 0);
  return choices;
}

function resolveDailyPersonalKojo(
  state: GameState,
  rng: Rng,
  context: DailyEventEffectContext,
  eventId: 2 | 4,
  charaNum: number,
  fallback: ObservationEvent[],
): DailyEventEffectOutcome {
  const router = context.router;
  if (!router) return { kind: "applied", events: fallback };
  const choices = dailyKojoChoicePath(context);
  const interactive = router.resolveDailyKojoInteractive?.(charaNum, eventId, state, rng, [], choices);
  if (interactive?.pending) {
    const values = interactive.pending.values ?? interactive.pending.options.map((_option, index) => index);
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return { kind: "applied", events: fallback };
    }
    const kojoEvents = dialogueEvents(context.now, charaNum, interactive.lines);
    return {
      kind: "needs-input",
      events: kojoEvents.length > 0 ? kojoEvents : fallback,
      prompt: {
        kind: "pick_one",
        question: "请选择回应。",
        options: interactive.pending.options.map((option, index) => ({ id: values[index] as number, label: option.label })),
      },
      session: {
        kind: "daily-kojo",
        eventId,
        eventDay: state.time.dayIndex,
        sleepSeed: context.sleepSeed,
        phase: "kojo-choice",
        data: { charaNum, choices: choices.join(",") },
      },
    };
  }
  const detailed = interactive ?? router.resolveDailyKojoDetailed?.(charaNum, eventId, state, rng, []);
  if (!detailed || detailed.status !== "resolved") return { kind: "applied", events: fallback };
  if (detailed.effects.length > 0) Object.assign(state, applyKojoEffects(state, detailed.effects));
  const authored = dialogueEvents(context.now, charaNum, detailed.lines);
  return { kind: "applied", events: authored.length > 0 ? authored : fallback };
}

function regionForLocation(location: string): number {
  return mapIdOfLocation(location) ?? 0;
}

function forceClearRegionalWeather(state: GameState): void {
  const snapshot = currentRegionWeather(state);
  qolForceSetRegionWeatherSystem(state, WEATHER_ID.少云);
  qolForceSetRegionRainbowSystem(state, snapshot.rainbowIndex);
  qolForceSetRegionWindVeSystem(state, snapshot.windIndex);
}

// DAILY_EV uses a handful of legacy slots that were not previously needed by
// the deterministic runtime. Keep their numeric ids local and named here so
// the port remains auditable without pretending they are unrelated flags.
const DAILY_FLAG = {
  オナ禁: 71,
  篤信: 78,
  子宝祈願: 580,
  獲得胖次種数: 700,
  ファッション: 880,
  異常気象: 89,
} as const;

// Kept ASCII because this legacy flag name is only an audit label; the
// upstream slot is numeric and does not need a Unicode property alias.
const DAILY_FLAG_CHILD_PRAYER = 580;

const DAILY_CFLAG = {
  favor: 2,
  trust: 4,
  physiology: 900,
  childCount: 912,
  nextVisit: 362,
  shrineResident: 30,
  banned: 360,
  sleepTime: 354,
  fertilityBonus: 913,
} as const;

const DAILY_CFLAG_FERTILITY_BONUS = 913;

const DAILY_TALENT = {
  gender: 2,
  love: 3,
  admiration: 8,
  thickSemen: 120,
  pregnant: 153,
  parenting: 154,
  immature: 151,
  regression: 150,
  menarche: 156,
  ghost: 194,
  doll: 196,
  divine: 193,
  extraRace: 197,
} as const;

function allCharaSlots(state: GameState) {
  return [state.master, ...Object.values(state.charas)];
}

function charaByNum(state: GameState, charaNum: number) {
  return charaNum === 0 ? state.master : state.charas[charaNum];
}

function hasPenis(slot: { state: { TALENT: Record<number, number> } }): boolean {
  return ((slot.state.TALENT[DAILY_TALENT.gender] ?? 0) & 2) !== 0;
}

function isMercyRace(slot: { state: { TALENT: Record<number, number> } }): boolean {
  const talent = slot.state.TALENT;
  return (talent[DAILY_TALENT.ghost] ?? 0) !== 0 ||
    (talent[DAILY_TALENT.doll] ?? 0) !== 0 ||
    (talent[DAILY_TALENT.extraRace] ?? 0) === 4 ||
    (talent[DAILY_TALENT.divine] ?? 0) !== 0;
}

const BUILTIN_EVENTS: readonly DailyEventDefinition[] = [
  {
    id: 0,
    label: "一团糟",
    condition: dailyMessCondition,
    effect: (state, rng, context) => {
      const answer = context.answer?.kind === "ask_yn"
        ? context.answer.value
        : undefined;
      const result = runDailyMessEvent(state, rng, answer, context.now);
      if (result.kind === "applied") return result;
      return {
        kind: "needs-input",
        events: result.previewEvents,
        prompt: result.prompt,
        session: {
          kind: "ev0-fairy-punishment",
          eventId: 0,
          eventDay: state.time.dayIndex,
          sleepSeed: context.sleepSeed,
          phase: "punishment-choice",
        },
      };
    },
  },
  {
    id: 1,
    label: "永遠亭の試供薬",
    condition: (state, rng) => {
      const chance = state.master.location.includes("永遠亭") ? 10 : 30;
      return rng.int(chance) === 0;
    },
    effect: (state, rng, context) => {
      const amount = 1 + rng.int(2);
      addItem(state, 501, amount);
      return { kind: "applied", events: [narration(context.now, `永遠亭から栄養飲料を${amount}個受け取った。`)] };
    },
  },
  {
    id: 2,
    label: "梦遗",
    condition: (state, rng) =>
      rng.int(10) === 0 &&
      (state.master.state.TALENT[DAILY_TALENT.thickSemen] ?? 0) !== 0 &&
      hasPenis(state.master) &&
      (state.master.state.BASE[BASE_ID.精力] ?? 0) === (state.master.state.MAXBASE[BASE_ID.精力] ?? 0),
    effect: (state, rng, context) => {
      state.flagStore[DAILY_FLAG.オナ禁] = 0;
      delete state.master.state.TALENT[DAILY_TALENT.thickSemen];
      // 梦遗也是射精 → 记下「今日射精」(TFLAG:一日一回 bit 8),夜间禁欲结算
      // 据此不会把今天算进禁欲天数。
      setTflagBit(state, TFLAG_ID.一日一回, 8);
      state.master.state.BASE[BASE_ID.精力] = Math.max(0, (state.master.state.BASE[BASE_ID.精力] ?? 0) - 500);
      state.master.state.EXP[11] = (state.master.state.EXP[11] ?? 0) + 1;
      const events: ObservationEvent[] = [
        narration(context.now, `${state.master.callName ?? "主人公"}半夜在幸福的感觉中醒了……`),
        narration(context.now, "总感觉胯下温热的……"),
        narration(context.now, "！！！！　糟了！是梦遗！"),
        narration(context.now, `如果能更有意义地射出去就好了……${state.master.callName ?? "主人公"}深感后悔。`),
      ];
      if (rng.int(10) === 0 && !hasItem(state, ITEM_ID.奇跡之石)) {
        addItem(state, ITEM_ID.奇跡之石, 1);
        events.push(narration(context.now, "奇迹之石落在了枕边。"));
      } else {
        const masterHome = state.homeLocation ?? state.master.homeLocation ?? state.master.location;
        const homeRegion = regionForLocation(masterHome);
        const recipientId = fisherYatesCharaNums(state, rng).find((charaNum) => {
          if (charaNum === 0) return false;
          const slot = state.charas[charaNum];
          if (!slot) return false;
          const initial = slot.homeLocation ?? slot.location;
          return regionForLocation(initial) === homeRegion &&
            (slot.state.CFLAG[DAILY_CFLAG.shrineResident] ?? 0) !== 0 &&
            (slot.state.CFLAG[DAILY_CFLAG.banned] ?? 0) === 0;
        });
        const recipient = recipientId === undefined ? undefined : state.charas[recipientId];
        if (recipient) {
          recipient.state.JUEL[11] = (recipient.state.JUEL[11] ?? 0) + 1000;
          const fallback = [
            narration(context.now, `${state.master.callName ?? "主人公"}清洗被梦遗弄脏的衣服时，${recipient.callName ?? "某人"}飞了过来。`),
            narration(context.now, `${recipient.callName ?? "某人"}抗议不要把这种东西和其他衣服一起洗，并抢走了内衣。`),
            narration(context.now, `${recipient.callName ?? "某人"}　情欲之珠＋1000`),
          ];
          const personal = resolveDailyPersonalKojo(state, rng, context, 2, recipient.charaNum, fallback);
          if (personal.kind === "needs-input") return { ...personal, events: [...events, ...personal.events] };
          if (personal.kind === "applied") events.push(...personal.events);
        }
      }
      return { kind: "applied", events };
    },
  },
  {
    id: 3,
    label: "酒收购价上涨",
    condition: (state, rng) =>
      (state.flagStore[FLAG_ID.最後に酒屋に訪れた日] ?? 0) > 0 &&
      (state.flagStore[FLAG_ID.酒屋買取強化] ?? 0) === 0 &&
      rng.int(30) === 0,
    effect: (state, _rng, context) => {
      state.flagStore[FLAG_ID.酒屋買取強化] = 7;
      const text = (state.flagStore[FLAG_ID.新聞購読] ?? 0) !== 0
        ? "文文。新闻报道，人间之里的酒屋开始强化收购，酒类可以卖出更高价格。"
        : "人间之里的酒屋开始强化收购，酒类可以卖出更高价格。";
      return { kind: "applied", events: [narration(context.now, text)] };
    },
  },
  {
    id: 4,
    label: "思念来访",
    condition: (state, rng) => {
      if (rng.int(7) !== 0) return false;
      return Object.values(state.charas).some((slot) =>
        (slot.state.ABL[ABL_ID.親密] ?? 0) >= 5 &&
        (slot.state.CFLAG[DAILY_CFLAG.shrineResident] ?? 0) === 0,
      );
    },
    effect: (state, rng, context) => {
      const targetId = fisherYatesCharaNums(state, rng).find((charaNum) => {
        const slot = charaByNum(state, charaNum);
        return !!slot &&
          (slot.state.ABL[ABL_ID.親密] ?? 0) >= 5 &&
          (slot.state.CFLAG[DAILY_CFLAG.shrineResident] ?? 0) === 0;
      });
      const target = targetId === undefined ? undefined : charaByNum(state, targetId);
      if (!target) return { kind: "unsupported", reason: "EV4 target disappeared" };
      target.state.CFLAG[DAILY_CFLAG.nextVisit] = 1;
      return resolveDailyPersonalKojo(state, rng, context, 4, target.charaNum, [
        narration(context.now, `结束了思考的${target.callName ?? "某人"}，注意到自己会在不知不觉中想着${state.master.callName ?? "主人公"}。`),
        narration(context.now, `${target.callName ?? "某人"}决定明天去见${state.master.callName ?? "主人公"}。`),
      ]);
    },
  },
  {
    id: 5,
    label: "OPPAI 欧派神",
    condition: ev5Condition,
    effect: runEv5,
  },
  {
    id: 6,
    label: "神の加護",
    condition: (_state, rng) => rng.int(10) === 0,
    effect: (state, rng, context) => {
      const expId = [70, 74, 75, 76, 79][rng.int(5)]!;
      state.flagStore[EVENT_FLAGS.blessing] = 1;
      state.dailyBlessingExpId = expId;
      state.dailyBlessingDay = state.time.dayIndex;
      return { kind: "applied", events: [narration(context.now, "神の加護を授かった。次の命令で経験が増えると、さらに1点加わる。")] };
    },
  },
  {
    id: 7,
    label: "鬼的劝酒骚扰",
    condition: (state, rng) => rng.int(15) === 0 && state.master.location.startsWith("地底"),
    effect: (state, rng, context) => {
      const yuugi = rng.int(4) === 0;
      const drinkers = 1 + rng.int(5);
      let rounds = 1;
      for (let i = 0; i < drinkers; i += 1) rounds += rng.int(3);
      if (yuugi) rounds += rng.int(3) + rng.int(3);
      const alcoholGains = [200, 400, 700];
      const alcoholLabels = ["普通的酒", "相当烈的酒", "烈得过头的酒"];
      let collapsed = false;
      const group = yuugi ? "勇仪她们" : "鬼们";
      const events = [
        narration(context.now, `${state.master.callName ?? "主人公"}正要睡觉时，${drinkers}个喝醉的鬼闯了进来！${yuugi ? "勇仪也在其中。" : ""}`),
        narration(context.now, `${state.master.callName ?? "主人公"}破罐子破摔地接受了${group}，酒宴就这样开始了。`),
      ];
      const yuugiSlot = state.charas[64];
      const room = state.master.homeLocation ?? state.master.location;
      for (let i = 0; i < rounds; i += 1) {
        const drink = rng.int(alcoholGains.length);
        const gain = alcoholGains[drink]!;
        events.push(narration(context.now, `${state.master.callName ?? "主人公"}被强行灌下了${alcoholLabels[drink]}。`));
        const current = (state.master.state.BASE[BASE_ID.酒気] ?? 0) + gain;
        const max = state.master.state.MAXBASE[BASE_ID.酒気] ?? 0;
        state.master.state.BASE[BASE_ID.酒気] = current;
        if (yuugiSlot) {
          yuugiSlot.state.CFLAG[DAILY_CFLAG.favor] = (yuugiSlot.state.CFLAG[DAILY_CFLAG.favor] ?? 0) + 3;
          yuugiSlot.state.CFLAG[DAILY_CFLAG.trust] = (yuugiSlot.state.CFLAG[DAILY_CFLAG.trust] ?? 0) + 1;
        }
        if (max > 0 && current > max) {
          events.push(narration(context.now, `${state.master.callName ?? "主人公"}终于吐了，${group}却哈哈大笑。`));
          setYogore(state, room, getYogore(state, room) + 1500);
          state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 500;
          state.master.state.MAXBASE[BASE_ID.酒気] = max + 3;
          if ((state.master.state.BASE[BASE_ID.気力] ?? 0) < 0) {
            state.master.state.BASE[BASE_ID.気力] -= 1000;
            collapsed = true;
            events.push(narration(context.now, `${state.master.callName ?? "主人公"}直挺挺地倒下了。`));
            break;
          }
          state.master.state.BASE[BASE_ID.酒気] = Math.trunc(current / 2);
        } else if (max > 0 && current > (max * 3) / 4) {
          events.push(narration(context.now, "酒劲涌了上来，感觉越来越恶心……"));
        }
      }
      if (yuugi && !collapsed && yuugiSlot) {
        yuugiSlot.state.CFLAG[DAILY_CFLAG.favor] = (yuugiSlot.state.CFLAG[DAILY_CFLAG.favor] ?? 0) + 150;
        yuugiSlot.state.CFLAG[DAILY_CFLAG.trust] = (yuugiSlot.state.CFLAG[DAILY_CFLAG.trust] ?? 0) + 100;
      }
      if (!collapsed) {
        state.master.state.MAXBASE[BASE_ID.酒気] = (state.master.state.MAXBASE[BASE_ID.酒気] ?? 0) + 20;
        events.push(narration(context.now, `${state.master.callName ?? "主人公"}完全经受住了无情的灌酒。`));
      }
      state.master.state.CFLAG[CFLAG_ID.徹夜] = 1;
      setYogore(state, room, getYogore(state, room) + 1000);
      state.master.state.MAXBASE[BASE_ID.酒気] = Math.max(1500, Math.min(3000, state.master.state.MAXBASE[BASE_ID.酒気] ?? 0));
      events.push(narration(context.now, `黎明时${group}离开了，只留下大量空瓶${collapsed ? "和充满呕吐物气味的" : "与一片狼藉的"}房间。`));
      return { kind: "applied", events };
    },
  },
  {
    id: 9,
    label: "小狗钻被窝",
    condition: (state, rng) => rng.int(20) === 0 && state.master.location.startsWith("地底"),
    effect: (state, _rng, context) => {
      const season = state.time.season ?? 1;
      if (season === 2) {
        state.master.state.CFLAG[CFLAG_ID.徹夜] = 1;
        return { kind: "applied", events: [narration(context.now, "觉那里的小狗钻进了被窝，却让人怎么也睡不着……")] };
      }
      const stamina = season === 4 ? 300 : 100;
      const will = season === 4 ? 500 : 200;
      recoverBase(state.master, BASE_ID.体力, stamina);
      recoverBase(state.master, BASE_ID.気力, will);
      return {
        kind: "applied",
        events: [narration(context.now, season === 4 ? "小狗钻进被窝，温暖的感觉让人恢复了精神。" : "小狗钻进被窝，陪着主人公一起睡着了。")],
      };
    },
  },
  {
    id: 11,
    label: "祈愿得子",
    condition: (state, rng) => (state.flagStore[DAILY_FLAG_CHILD_PRAYER] ?? 0) !== 0 && rng.int(10) === 0,
    effect: (state, _rng, context) => {
      const targetId = state.flagStore[DAILY_FLAG_CHILD_PRAYER] ?? 0;
      const target = charaByNum(state, targetId);
      if (!target || targetId === 0) return { kind: "unsupported", reason: "子宝祈願 target disappeared" };
      target.state.CFLAG[DAILY_CFLAG_FERTILITY_BONUS] = (target.state.CFLAG[DAILY_CFLAG_FERTILITY_BONUS] ?? 0) + 1;
      return {
        kind: "applied",
        events: [narration(context.now, `${target.callName ?? "角色"}祈祷能顺利怀上${state.master.callName ?? "主人公"}的孩子……`)],
      };
    },
  },
  {
    id: 15,
    label: "异常气象",
    condition: (state, rng) =>
      (state.flagStore[FLAG_ID.異常気象] ?? 0) === ABNORMAL_WEATHER.NONE && rng.int(20) === 0,
    effect: (state, rng, context) => {
      state.flagStore[FLAG_ID.異常気象] = rng.int(2) === 0
        ? ABNORMAL_WEATHER.SKIRT
        : ABNORMAL_WEATHER.PANTSU;
      const effect = state.flagStore[FLAG_ID.異常気象] === ABNORMAL_WEATHER.SKIRT
        ? "女孩子被掀起裙子后，越是厌恶对方却越会感到舒服。"
        : "强风开始把胖次吹得到处都是。";
      forceClearRegionalWeather(state);
      return {
        kind: "applied",
        events: [
          narration(context.now, "全球变暖、环境污染、疫情和长时间加班……外界的各种问题也无可避免地影响到了幻想乡。"),
          narration(context.now, `由于外界影响，天气发生了异变：${effect}`),
        ],
      };
    },
  },
  {
    id: 16,
    label: "掀裙子过多",
    condition: (state, rng) => {
      const flips = getTflag(state, TFLAG_ID.skirtFlipCount);
      return flips > 0 && rng.int(flips) < rng.int(300);
    },
    effect: (state, _rng, context) => {
      for (const slot of Object.values(state.charas)) {
        slot.state.CFLAG[DAILY_CFLAG.favor] = Math.max(0, (slot.state.CFLAG[DAILY_CFLAG.favor] ?? 0) - 100);
        slot.state.CFLAG[DAILY_CFLAG.trust] = Math.max(0, (slot.state.CFLAG[DAILY_CFLAG.trust] ?? 0) - 50);
      }
      return {
        kind: "applied",
        events: [
          narration(context.now, "文文。新闻的号外出来了！"),
          narration(context.now, `记载着${state.master.callName ?? "主人公"}掀裙子的事！全员好感度下降100、信赖度下降50。`),
        ],
      };
    },
  },
  {
    id: 17,
    label: "爆炸事故",
    condition: (state, rng) =>
      (state.flagStore[FLAG_ID.異常気象] ?? 0) === ABNORMAL_WEATHER.NONE && rng.int(20) === 0,
    effect: (state, rng, context) => {
      state.flagStore[FLAG_ID.異常気象] = ABNORMAL_WEATHER.C_SENSITIVE + rng.int(5);
      const effect = [
        "大家的阴蒂变敏感了。",
        "大家的阴部变敏感了。",
        "大家的肛门变敏感了。",
        "大家的胸部变敏感了。",
        "大家的嘴唇变敏感了。",
      ][state.flagStore[FLAG_ID.異常気象] - ABNORMAL_WEATHER.C_SENSITIVE]!;
      forceClearRegionalWeather(state);
      return {
        kind: "applied",
        events: [
          narration(context.now, "永远亭的配药室发生了爆炸。"),
          narration(context.now, "气化的药品与工房煤烟反应，未知化合物扩散到了空气中。"),
          narration(context.now, effect),
        ],
      };
    },
  },
  {
    id: 18,
    label: "生理周期随机化",
    condition: (_state, rng) => rng.int(15) === 0,
    effect: (state, rng, context) => {
      const events = [narration(context.now, "从月亮上洒落着妖异的光芒……")];
      for (const slot of allCharaSlots(state)) {
        const talent = slot.state.TALENT;
        if (((talent[DAILY_TALENT.regression] ?? 0) !== 0 || (talent[DAILY_TALENT.immature] ?? 0) !== 0) &&
            (talent[DAILY_TALENT.menarche] ?? 0) === 0) continue;
        if (((talent[DAILY_TALENT.gender] ?? 0) & 1) === 0) continue;
        if (rng.int(5) !== 0) continue;
        slot.state.CFLAG[DAILY_CFLAG.physiology] = rng.int(10) + 1;
      }
      return { kind: "applied", events };
    },
  },
  {
    id: 20,
    label: "赤蛮奇夜访",
    condition: (state, rng) => {
      if (rng.int(15) !== 0) return false;
      const head = state.charas[73];
      return !!head &&
        (head.state.CFLAG[DAILY_CFLAG.shrineResident] ?? 0) === 0 &&
        (head.state.CFLAG[DAILY_CFLAG.banned] ?? 0) === 0 &&
        ((head.state.TALENT[DAILY_TALENT.admiration] ?? 0) !== 0 ||
          (head.state.TALENT[DAILY_TALENT.love] ?? 0) !== 0);
    },
    effect: (state, rng, context) => {
      const head = state.charas[73];
      if (!head) return { kind: "unsupported", reason: "蛮奇(73) is not present in the configured roster" };
      const prompt: PromptSpec = {
        kind: "pick_one",
        question: "赤蛮奇的头从窗外飘了进来。要让她进来吗？",
        options: [
          { id: "enter", label: "让她进来" },
          { id: "sleep", label: "睡觉" },
        ],
      };
      const answer = context.answer;
      const choice = answer?.kind === "pick_one"
        ? answer.value
        : answer?.kind === "ask_yn"
          ? (answer.value ? "enter" : "sleep")
          : undefined;
      const previewEvents = [
        narration(context.now, "半夜、从窗户那传来了响声。"),
        narration(context.now, `${state.master.callName ?? "主人公"}睡眼惺忪地打开了窗户，外面飘着一个人头……是赤蛮奇。`),
      ];
      if (choice !== "enter" && choice !== "sleep") {
        return {
          kind: "needs-input",
          events: previewEvents,
          prompt,
          session: {
            kind: "ev20-head-visit",
            eventId: 20,
            eventDay: state.time.dayIndex,
            sleepSeed: context.sleepSeed,
            phase: "visit-choice",
          },
        };
      }
      if (choice === "sleep") {
        return { kind: "applied", events: [...previewEvents, narration(context.now, "因为很困，还是请她回去了。 ")] };
      }
      const events = [...previewEvents, narration(context.now, "让她进来了。赤蛮奇在夜色中陪你聊了一会儿。")];
      const intimacy = head.state.ABL[9] ?? 0;
      const love = head.state.TALENT[DAILY_TALENT.love] ?? 0;
      if (rng.int(100) < intimacy * 3 + love * 15) {
        head.state.CFLAG[DAILY_CFLAG.nextVisit] = 1;
        events.push(narration(context.now, "她说明天还会再来拜访。"));
      }
      head.state.CFLAG[DAILY_CFLAG.favor] = (head.state.CFLAG[DAILY_CFLAG.favor] ?? 0) + 50;
      head.state.CFLAG[DAILY_CFLAG.trust] = (head.state.CFLAG[DAILY_CFLAG.trust] ?? 0) + 20;
      state.master.state.CFLAG[DAILY_CFLAG.sleepTime] = (state.master.state.CFLAG[DAILY_CFLAG.sleepTime] ?? 0) + 60;
      return { kind: "applied", events };
    },
  },
  {
    id: 23,
    label: "上门推销",
    condition: ev23Condition,
    effect: runEv23,
  },
  {
    id: 24,
    label: "季节异变",
    condition: (state, rng) => rng.int(15) === 0 && (state.time.date ?? 1) < 30,
    effect: (state, _rng, context) => {
      for (const slot of [state.master, ...Object.values(state.charas)]) {
        if ((slot.state.TALENT[TALENT_ID.妖精] ?? 0) === 0) continue;
        buffBase(slot, BASE_ID.体力, 300);
        buffBase(slot, BASE_ID.気力, 300);
      }
      const season = (state.time.season ?? 1) + 2;
      state.gatheringSeason = (season > 4 ? season - 4 : season) as 1 | 2 | 3 | 4;
      return {
        kind: "applied",
        events: [
          narration(context.now, "发生了季节异变！"),
          narration(context.now, `妖精们的体力与气力上升，现在可以采集第${state.gatheringSeason}季的素材。`),
        ],
      };
    },
  },
  {
    id: 21,
    label: "神的慈悲",
    condition: (state, rng) => {
      const targetId = state.flagStore[DAILY_FLAG.子宝祈願] ?? 0;
      const target = charaByNum(state, targetId);
      if (!target || targetId === 0) return false;
      if ((state.flagStore[DAILY_FLAG.獲得胖次種数] ?? 0) < 100) return false;
      if (rng.int(30) !== 0) return false;
      return (target.state.TALENT[DAILY_TALENT.pregnant] ?? 0) === 0 &&
        isMercyRace(target) &&
        (target.state.CFLAG[DAILY_CFLAG.childCount] ?? 0) === 0;
    },
    effect: (state, _rng, context) => {
      const targetId = state.flagStore[DAILY_FLAG.子宝祈願] ?? 0;
      const target = charaByNum(state, targetId);
      if (!target || targetId === 0) return { kind: "unsupported", reason: "子宝祈願 target disappeared" };
      buffBase(state.master, BASE_ID.体力, 1000);
      buffBase(state.master, BASE_ID.気力, 1000);
      buffBase(state.master, BASE_ID.精力, 500);
      const events = [narration(context.now, `胖次大神怜悯着渴求子嗣的${target.callName ?? "角色"}……`)];
      if ((state.master.state.TALENT[DAILY_TALENT.thickSemen] ?? 0) === 0) {
        state.master.state.TALENT[DAILY_TALENT.thickSemen] = 1;
        state.master.state.BASE[BASE_ID.精力] = state.master.state.MAXBASE[BASE_ID.精力] ?? state.master.state.BASE[BASE_ID.精力] ?? 0;
        events.push(narration(context.now, `${state.master.callName ?? "主人公"}获得了【浓厚精液】。`));
      }
      target.state.CFLAG[DAILY_CFLAG.nextVisit] = 1;
      target.state.CFLAG[DAILY_CFLAG.fertilityBonus] = (target.state.CFLAG[DAILY_CFLAG.fertilityBonus] ?? 0) + 1;
      return { kind: "applied", events };
    },
  },
  {
    id: 25,
    label: "流行时尚",
    condition: (state, rng) => (state.flagStore[DAILY_FLAG.ファッション] ?? 0) === 0 && rng.int(20) === 0,
    effect: (state, rng, context) => {
      const outfit = rng.int(2) === 0 ? 62 : 74;
      state.flagStore[DAILY_FLAG.ファッション] = outfit;
      return {
        kind: "applied",
        events: [narration(context.now, outfit === 62 ? "超棒的T恤衫突然流行起来了。" : "水手服突然成为了幻想乡的流行时尚。")],
      };
    },
  },
  {
    id: 26,
    label: "桃色之风",
    condition: (state, rng) => {
      let rate = 25;
      const panties = state.flagStore[DAILY_FLAG.獲得胖次種数] ?? 0;
      if (panties >= 4) rate += Math.sqrt(panties) / 2;
      rate += (state.flagStore[DAILY_FLAG.篤信] ?? 0) * 5;
      return rate >= rng.int(1000) && (state.flagStore[DAILY_FLAG.異常気象] ?? 0) === 0;
    },
    effect: (state, _rng, context) => {
      state.flagStore[DAILY_FLAG.篤信] = 0;
      state.flagStore[DAILY_FLAG.異常気象] = 8;
      return {
        kind: "applied",
        events: [
          narration(context.now, `${state.master.callName ?? "主人公"}积攒的人品让奇迹发生了……！`),
          narration(context.now, "开始吹起了桃色之风。"),
        ],
      };
    },
  },
  {
    id: 27,
    label: "土産屋半額セール",
    condition: (state, rng) => (state.flagStore[EVENT_FLAGS.souvenirSale] ?? 0) === 0 && rng.int(30) === 0,
    effect: (state, rng, context) => {
      const homeRegion = regionForLocation(state.master.location);
      let region = rng.int(11);
      if (region === homeRegion) region = (region + 1) % 11;
      state.flagStore[EVENT_FLAGS.souvenirSale] = 1100 + region;
      return { kind: "applied", events: [narration(context.now, `土産屋の${region}地区商品が半額になった。`)] };
    },
  },
  {
    id: 33,
    label: "市場の神",
    condition: (state) => (state.flagStore[EVENT_FLAGS.marketGod] ?? 0) === 1,
    effect: (state, rng, context) => {
      state.flagStore[EVENT_FLAGS.marketGod] = 2;
      const gifts = [];
      for (let i = 0; i < 20; i += 1) {
        const gift = createGift(() => rng.next(), null);
        if (gift) gifts.push(gift);
      }
      state.marketGifts = gifts;
      return { kind: "applied", events: [narration(context.now, "市場の神が訪れ、市場の商品が増えた。")] };
    },
  },
  {
    id: 34,
    label: "妖兽强化",
    condition: (_state, rng) => rng.int(15) === 0,
    effect: (state, rng, context) => {
      const races = ["妖怪狐", "妖怪狸", "因幡", "山童", "玉兎", "河童", "鴉天狗", "白狼天狗"];
      const race = races[rng.int(races.length)]!;
      const days = 2 + rng.int(2);
      state.mobRaceBuff = { race, days };
      return {
        kind: "applied",
        events: [narration(context.now, `${race}的出现率上升，战斗能力也提升了（${days}天）。`)],
      };
    },
  },
  {
    id: 30,
    label: "酿造状态好",
    condition: (_state, rng) => rng.int(15) === 0,
    effect: (state, _rng, context) => {
      state.brewDays = (state.brewDays ?? 0) + 2;
      return {
        kind: "applied",
        events: [
          narration(context.now, "今天酒虫的状态很好。"),
          narration(context.now, "酿造进度比平时增加了。"),
        ],
      };
    },
  },
];

const BUILTIN_BY_ID = new Map(BUILTIN_EVENTS.map((event) => [event.id, event]));
const registeredEvents = new Map<number, DailyEventDefinition>();

export function dailyEventOpportunitySet(state: Readonly<GameState>): EventOpportunitySet {
  const definitions = [...BUILTIN_EVENTS, ...registeredEvents.values()].sort((a, b) => a.id - b.id);
  return compileEventOpportunitySet({
    channel: "daily",
    dayIndex: state.time.dayIndex,
    contextKey: state.master.location,
    candidates: definitions.map((definition) => ({
      id: definition.id,
      name: definition.label,
      source: definition.id < 40 ? "upstream" : "modern",
      safety: ["deterministic", "authored", "fail-closed"],
    })),
  });
}

function eventById(id: number): DailyEventDefinition | undefined {
  return registeredEvents.get(id) ?? BUILTIN_BY_ID.get(id);
}

/** Exact Fisher-Yates over all canonical slots, not only implemented events. */
export function shuffleDailyEventSlots(rng: Rng): number[] {
  const ids = Array.from({ length: DAILY_EVENT_SLOT_COUNT }, (_, id) => id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

function replaceGameState(target: GameState, source: GameState): void {
  const mutable = target as unknown as Record<string, unknown>;
  const replacement = source as unknown as Record<string, unknown>;
  for (const key of Object.keys(mutable)) {
    if (!(key in replacement)) delete mutable[key];
  }
  Object.assign(target, source);
}

function validEvents(events: unknown): events is ObservationEvent[] {
  return Array.isArray(events) && events.every(isObservationEvent);
}

function promptOpening(
  state: Readonly<GameState>,
  events: ReadonlyArray<ObservationEvent>,
): EventPromptLine[] {
  const lines: EventPromptLine[] = [];
  for (const event of events) {
    if (event.kind === "NARRATION") {
      if (event.text.trim().length > 0) lines.push({ kind: "narration", text: event.text });
      continue;
    }
    if (event.kind === "DIALOGUE_LINE" && event.text.trim().length > 0) {
      const speaker = event.charaNum === 0
        ? state.master.callName
        : state.charas[event.charaNum]?.callName;
      lines.push({
        kind: "dialogue",
        ...(speaker ? { speaker } : {}),
        text: event.text,
      });
    }
  }
  return lines;
}

/**
 * Freeze the exact player-facing event prompt at the pause boundary. Night
 * events used to rebuild their question from mutable state after a save,
 * which could change prices, disabled options, or opening text mid-scene.
 * Outing events already had this contract; both channels now share it.
 */
function snapshotEventPrompt(
  state: Readonly<GameState>,
  prompt: PromptSpec,
  events: ReadonlyArray<ObservationEvent>,
): EventPromptSpec {
  const opening = promptOpening(state, events);
  return {
    kind: prompt.kind,
    question: prompt.question,
    options: prompt.options.map((option) => ({ ...option })),
    ...(opening.length > 0 ? { opening } : {}),
  };
}

/**
 * Evaluate the canonical table once for the current day. A registered event
 * whose gate succeeds owns the tick: unsupported/invalid effects fail closed
 * instead of falling through to a different event.
 */
export function runDailyEventTick(
  state: GameState,
  rng: Rng,
  options: DailyEventRunOptions = { sleepSeed: 0 },
): DailyEventDispatchResult {
  const day = state.time.dayIndex;
  const now = options.now ?? (() => 0);
  const replaySession = state.dailyEventSession ?? undefined;
  const markerEvents = prepareDailyEventMarkers(state, now);
  if (!replaySession && state.dailyEventLastRunDay === day) {
    return { events: [], diagnostics: [] };
  }

  const finishWithoutEffect = (diagnostic?: DailyEventDiagnostic): DailyEventDispatchResult => {
    state.dailyEventLastRunDay = day;
    state.dailyEventSession = undefined;
    return { events: markerEvents, diagnostics: diagnostic ? [diagnostic] : [] };
  };

  if (replaySession && replaySession.eventDay !== day) {
    return finishWithoutEffect({
      eventId: replaySession.eventId,
      phase: "replay",
      message: `daily-event session day ${replaySession.eventDay} does not match ${day}`,
    });
  }

  const opportunity = dailyEventOpportunitySet(state);
  // Keep an accepted ordering until the event (including any persisted
  // prompt continuation) settles. Consuming it before EV0 asks for input would
  // make a save/replay fall back to a different random order.
  const ranked = state.acceptedEventRankings?.find((entry) =>
    entry.setId === opportunity.setId && entry.contextHash === opportunity.contextHash && entry.dayIndex === opportunity.dayIndex,
  )?.candidateIds;
  const shuffled = shuffleDailyEventSlots(rng);
  const order = ranked
    ? [...ranked, ...shuffled.filter((id) => !ranked.includes(id))]
    : shuffled;
  for (const id of order) {
    const definition = eventById(id);
    if (!definition) continue;
    const candidate = cloneGameState(state);
    let eligible: boolean;
    try {
      eligible = definition.condition(candidate, rng);
    } catch (error) {
      return finishWithoutEffect({
        eventId: id,
        phase: "condition",
        message: String(error),
      });
    }
    if (!eligible) continue;

    if (replaySession && replaySession.eventId !== id) {
      return finishWithoutEffect({
        eventId: id,
        phase: "replay",
        message: `expected event ${replaySession.eventId}, replay selected ${id}`,
      });
    }

    let outcome: DailyEventEffectOutcome;
    try {
      outcome = definition.effect(candidate, rng, {
        now,
        sleepSeed: options.sleepSeed,
        answer: options.answer,
        router: options.router,
        session: replaySession,
      });
    } catch (error) {
      return finishWithoutEffect({
        eventId: id,
        phase: "effect",
        message: String(error),
      });
    }

    if (outcome.kind === "unsupported") {
      return finishWithoutEffect({ eventId: id, phase: "effect", message: outcome.reason });
    }
    if (!validEvents(outcome.events)) {
      return finishWithoutEffect({
        eventId: id,
        phase: "validation",
        message: "daily event returned invalid observation events",
      });
    }
    if (outcome.kind === "needs-input") {
      const prompt = snapshotEventPrompt(candidate, outcome.prompt, outcome.events);
      const session = {
        ...outcome.session,
        prompt,
      } satisfies DailyEventSession;
      return {
        events: [],
        pending: {
          eventId: id,
          prompt: outcome.prompt,
          previewEvents: [...markerEvents, ...outcome.events],
          session,
        },
        diagnostics: [],
      };
    }

    candidate.dailyEventLastRunDay = day;
    candidate.dailyEventSession = undefined;
    finalizeDailyEventMarkers(candidate, id);
    replaceGameState(state, candidate);
    consumeEventRanking(state, opportunity);
    return { events: [...markerEvents, ...outcome.events], firedEventId: id, diagnostics: [] };
  }

  if (replaySession) {
    return finishWithoutEffect({
      eventId: replaySession.eventId,
      phase: "replay",
      message: `event ${replaySession.eventId} was not eligible during replay`,
    });
  }
  finalizeDailyEventMarkers(state);
  consumeEventRanking(state, opportunity);
  return finishWithoutEffect();
}

/** Backward-compatible wrapper for the misspelled Slice-G export. */
export function runDailyearnEventTick(state: GameState, rng: Rng): ObservationEvent[] {
  return runDailyEventTick(state, rng, { sleepSeed: 0 }).events;
}

/** Runtime extension hook used by later event slices and isolated tests. */
export function registerDailyEvent(definition: DailyEventDefinition): () => void {
  if (!Number.isInteger(definition.id) || definition.id < 0 || definition.id >= DAILY_EVENT_SLOT_COUNT) {
    throw new RangeError(`daily event id must be 0..${DAILY_EVENT_SLOT_COUNT - 1}`);
  }
  if (BUILTIN_BY_ID.has(definition.id) || registeredEvents.has(definition.id)) {
    throw new Error(`daily event ${definition.id} is already registered`);
  }
  registeredEvents.set(definition.id, definition);
  return () => {
    if (registeredEvents.get(definition.id) === definition) registeredEvents.delete(definition.id);
  };
}

/** Apply the fixed AFTERTRA ordering around the event table. */
export function prepareDailyEventMarkers(state: GameState, now: () => number = () => state.time.tickValue): ObservationEvent[] {
  if (state.dailyEventLastRunDay === state.time.dayIndex) return [];
  const events: ObservationEvent[] = [];
  if (state.mobRaceBuff) {
    const days = state.mobRaceBuff.days - 1;
    if (days > 0) state.mobRaceBuff = { ...state.mobRaceBuff, days };
    else {
      const race = state.mobRaceBuff.race;
      state.mobRaceBuff = undefined;
      const endings: Record<string, string> = {
        白狼天狗: "哨戒天狗被分配了别的任务，强化指标不了了之。",
        鴉天狗: "鸦天狗们结束了新闻竞争，活动恢复了平静。",
        河童: "河童们的开发竞赛告一段落。",
        山童: "山童们的竞赛热潮平息了。",
        因幡: "因幡们的集体训练结束了。",
        玉兎: "玉兔们结束了临时强化训练。",
        妖怪狐: "妖怪狐的扰民抗争告一段落。",
        妖怪狸: "妖怪狸的扰民抗争告一段落。",
      };
      events.push(narration(now, endings[race] ?? `${race}的强化热潮平息了。`));
    }
  }
  const alcoholBoost = state.flagStore[FLAG_ID.酒屋買取強化] ?? 0;
  if (alcoholBoost > 0) state.flagStore[FLAG_ID.酒屋買取強化] = Math.max(0, alcoholBoost - 1);
  const blessing = state.flagStore[EVENT_FLAGS.blessing] ?? 0;
  if (blessing !== 0) {
    state.flagStore[EVENT_FLAGS.blessing] = 0;
    state.dailyBlessingExpId = undefined;
    state.dailyBlessingDay = undefined;
    events.push(narration(now, "神的加护效果消失了。"));
  }
  const sale = state.flagStore[EVENT_FLAGS.souvenirSale] ?? 0;
  if (sale >= 100 && sale < 1110) state.flagStore[EVENT_FLAGS.souvenirSale] = 0;
  if ((state.flagStore[EVENT_FLAGS.marketGod] ?? 0) === 10) {
    state.flagStore[EVENT_FLAGS.marketGod] = 0;
    state.marketGifts = [];
    events.push(narration(now, "明月照耀下的虹光正在闭合……土特产店的货物种类恢复了原样。"));
  }
  const abnormal = state.flagStore[FLAG_ID.異常気象] ?? 0;
  if (abnormal >= 1 && abnormal <= 8) {
    state.flagStore[FLAG_ID.異常気象] = 0;
    events.push(narration(now, "异常气象消失了。"));
  }
  if ((state.flagStore[DAILY_FLAG.ファッション] ?? 0) !== 0) {
    state.flagStore[DAILY_FLAG.ファッション] = 0;
    events.push(narration(now, "追求时尚的热潮平息了。"));
  }
  if (state.gatheringSeason !== undefined) {
    state.gatheringSeason = undefined;
    events.push(narration(now, "采集季节恢复了原样。"));
  }
  return events;
}

export function finalizeDailyEventMarkers(state: GameState, firedEventId?: number): void {
  const sale = state.flagStore[EVENT_FLAGS.souvenirSale] ?? 0;
  if (sale >= 1100 && sale < 1111) state.flagStore[EVENT_FLAGS.souvenirSale] = sale - 1000;
  if (firedEventId === 33 && (state.flagStore[EVENT_FLAGS.marketGod] ?? 0) === 2) {
    state.flagStore[EVENT_FLAGS.marketGod] = 10;
  } else if (firedEventId !== 33 && (state.flagStore[EVENT_FLAGS.marketGod] ?? 0) === 1) {
    state.flagStore[EVENT_FLAGS.marketGod] = 0;
  }
}

/** One-shot EXP bonus consumed by the authoritative command result. */
export function applyDailyBlessingExpBonus(state: GameState, before: Readonly<Record<number, number>>, commandSucceeded: boolean): number {
  if (!commandSucceeded || (state.flagStore[EVENT_FLAGS.blessing] ?? 0) === 0 || state.dailyBlessingExpId === undefined) return 0;
  const id = state.dailyBlessingExpId;
  const beforeValue = before[id] ?? 0;
  const afterValue = state.master.state.EXP[id] ?? 0;
  if (afterValue <= beforeValue) return 0;
  state.master.state.EXP[id] = afterValue + 1;
  state.flagStore[EVENT_FLAGS.blessing] = 0;
  return 1;
}

export function dailyEventPromptView(
  state: Readonly<GameState>,
  session: DailyEventSession,
): { prompt: EventPromptSpec; lines: string[] } | null {
  if (session.prompt) {
    return {
      prompt: session.prompt,
      lines: session.prompt.opening?.map((line) => line.speaker ? `${line.speaker}：${line.text}` : line.text) ?? [],
    };
  }
  const ev5 = ev5PromptView(state, session);
  if (ev5) return ev5;
  const ev23 = ev23PromptView(state, session);
  if (ev23) return ev23;
  if (session.kind === "ev20-head-visit") {
    return {
      prompt: {
        kind: "pick_one",
        question: "赤蛮奇的头从窗外飘了进来。要让她进来吗？",
        options: [
          { id: "enter", label: "让她进来" },
          { id: "sleep", label: "睡觉" },
        ],
      },
      lines: [
        "半夜、从窗户那传来了响声。",
        `${state.master.callName ?? "主人公"}睡眼惺忪地打开了窗户，外面飘着一个人头……是赤蛮奇。`,
      ],
    };
  }
  if (session.kind !== "ev0-fairy-punishment") return null;
  const map = state.master.location.includes(":")
    ? state.master.location.slice(0, state.master.location.indexOf(":"))
    : state.master.location;
  return {
    prompt: DAILY_MESS_PROMPT,
    lines: [
      `在${state.master.callName ?? "主人公"}睡着的时候，${map}里大群的妖精蜂拥而来！`,
      `妖精们把${map}弄得乱七八糟的。`,
      `${state.master.callName ?? "主人公"}途中出现，目瞪口呆地看着这一切……`,
    ],
  };
}
