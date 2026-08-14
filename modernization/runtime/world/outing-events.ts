import type { GameState } from "../state/game-state.js";
import type {
  OutingChoicePromptLine,
  OutingChoicePromptSpec,
  OutingChoiceSession,
  OutingChoiceValue,
} from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/types.js";
import { getTflag, setTflag, TFLAG_ID } from "../state/tflag.js";
import { addItem, ITEM_ID, itemCount, buyItem } from "../state/items.js";
import { BASE_ID, CFLAG_ID, EX_ID, EXP_ID, FLAG_ID, MARK_ID, TALENT_ID, TCVAR_ID, advanceTimeTicks } from "../state/settlement.js";
import { cloneGameState } from "../state/game-state.js";
import { compileEventOpportunitySet, consumeEventRanking, type EventOpportunitySet } from "./event-ranking.js";
import { mapIdOfLocation } from "./location-predicates.js";

const RETURN_EVENT_BIT = 1 << 11;
const DEPARTURE_EVENT_BIT = 1 << 15;
const MARISA_CHARA_ID = 11;

/** Interactive upstream event ids — events that present a player ASK_M before
 *  settling. The non-interactive events (0/4/8) settle deterministically and
 *  never pause. EV1 is intentionally retired (no authoritative battle). */
const INTERACTIVE_EVENT_IDS: ReadonlyArray<2 | 3 | 5 | 6 | 7> = [2, 3, 5, 6, 7];

const OUTING_EVENT_NAMES: Record<number, string> = {
  0: "返程亲密时光", 1: "返程事件1", 2: "返程事件2", 3: "返程事件3",
  4: "据点来访", 5: "返程事件5", 6: "返程事件6", 7: "返程事件7", 8: "返程事件8",
};

const EV6_REWARDS = [
  { id: 625, name: "龙血" },
  { id: 630, name: "仙桃" },
  { id: 639, name: "暗黑物质" },
  { id: 640, name: "凤凰之尾" },
  { id: 643, name: "龙涎香" },
  { id: 646, name: "香木" },
] as const;

const EV8_POTIONS = [
  { id: 508, name: "魔法药水" },
  { id: 509, name: "破眠药水" },
  { id: 507, name: "药水" },
] as const;

const EV8_MUSHROOMS = [
  { id: 603, name: "冬虫夏草" },
  { id: 604, name: "危险菌菇" },
  { id: 605, name: "魔法菌菇" },
] as const;

const EV7_SHOP = [
  { id: 514, name: "仙香玉兎", price: 45000 },
  { id: 515, name: "国士無双の药", price: 30000 },
  { id: 516, name: "毒气花园", price: 35000 },
  { id: 517, name: "劇毒身軀", price: 40000 },
  { id: ITEM_ID.奇跡之石, name: "奇迹之石", price: 98000 },
] as const;

/** The source events are authored as a short scene followed by ASK_M, not as
 * a single question. Keep the safe, non-effectful opening in the persisted
 * choice session so the player can read the encounter before deciding. */
const OUTING_EVENT_OPENINGS: Readonly<Record<2 | 3 | 5 | 6 | 7, readonly OutingChoicePromptLine[]>> = {
  2: [
    { kind: "narration", text: "途中，突然被一群妖怪狸拦了下来……！？" },
    { kind: "dialogue", speaker: "妖怪狸", text: "「等一下、等一下！我们没有要和客人对抗的意思呀！」" },
    { kind: "narration", text: "披着羽织的狸猫慌慌张张地解释着，看来确实没有敌意。" },
    { kind: "dialogue", speaker: "妖怪狸", text: "「宴会马上就要开始了。总是同样的面孔太无聊，客人要不要一起喝几杯？」" },
  ],
  3: [
    { kind: "narration", text: "途中，一个长发蓬乱、留着胡子的男人可疑地靠了过来……！？" },
    { kind: "dialogue", speaker: "可疑的男人", text: "「那边的人！不会花太多时间的，只要听我说几句就好……」" },
    { kind: "narration", text: "男人的眼神异常认真，像是已经为某个烦恼担心了很久。" },
  ],
  5: [
    { kind: "narration", text: "途中，一个陌生女人朝这边走来，伸手拉住了你的手腕。" },
    { kind: "dialogue", speaker: "陌生女人", text: "「那边的客人，要不要和我做些……好事情？」" },
    { kind: "dialogue", speaker: "陌生女人", text: "「快看，到这边来。只要跟我走一小段路就好啦。」" },
  ],
  6: [
    { kind: "narration", text: "途中，发现一只小动物被猎人的陷阱困住了。" },
    { kind: "narration", text: "它挣扎得越来越厉害，再这样下去一定会受伤。" },
  ],
  7: [
    { kind: "narration", text: "中途，突然被因幡拦了下来……！？" },
    { kind: "dialogue", speaker: "因幡", text: "「啊啊啊！请不要冲过来！客人，先听我说一下！」" },
    { kind: "narration", text: "背着满满货物的兔子商贩慌慌张张地停在路边。" },
    { kind: "dialogue", speaker: "因幡", text: "「在这里相遇一定是有缘。客人，对我这边的优秀商品有兴趣吗？」" },
  ],
};

/** Authored ASK_M prompts for each interactive event. The shape mirrors the
 *  command-layer `PromptSpec` so the UI can reuse `PromptMenu`. `option.id`
 *  values follow upstream `RESULT` conventions where applicable; decline is a
 *  safe synthesized branch (the upstream file uses `CALL ASK_M` with two real
 *  options, but modern runtime needs an explicit no-op to avoid pretending
 *  the player picked the destructive branch). */
const INTERACTIVE_EVENT_PROMPTS: Record<2 | 3 | 5 | 6 | 7, OutingChoicePromptSpec> = {
  2: {
    kind: "ask_yn",
    question: "狸猫们发出了参加宴会的邀请。要加入吗？",
    options: [
      { id: "accept", label: "参加宴会" },
      { id: "decline", label: "无视并离开" },
    ],
    opening: [...OUTING_EVENT_OPENINGS[2]],
  },
  3: {
    kind: "ask_yn",
    question: "一位奇怪的男子向你搭话。要聊聊吗？",
    options: [
      { id: "accept", label: "聊一聊" },
      { id: "decline", label: "无视并归去" },
    ],
    opening: [...OUTING_EVENT_OPENINGS[3]],
  },
  5: {
    kind: "ask_yn",
    question: "陌生的女性邀请你一起回家。要跟着走吗？",
    options: [
      { id: "accept", label: "跟着走" },
      { id: "decline", label: "甩开并回家" },
    ],
    opening: [...OUTING_EVENT_OPENINGS[5]],
  },
  6: {
    kind: "ask_yn",
    question: "陷阱里的小动物向你求助。要救助吗？",
    options: [
      { id: "rescue", label: "救助" },
      { id: "decline", label: "不要妨碍" },
    ],
    opening: [...OUTING_EVENT_OPENINGS[6]],
  },
  7: {
    kind: "pick_one",
    question: "因幡的流动商贩在叫卖。要看看她带来的商品吗？",
    options: [
      { id: "decline", label: "无视并离开" },
      ...EV7_SHOP.map((item) => ({
        id: item.id as OutingChoiceValue,
        label: item.name,
        detail: `${item.price} 円`,
      })),
    ],
    opening: [...OUTING_EVENT_OPENINGS[7]],
  },
};

export interface OutingEventResult {
  state: GameState;
  ended: boolean;
  events: ObservationEvent[];
  diagnostics: string[];
  selectedEventId?: number;
}

/** Optional host-supplied answer for an input-heavy outing event. The normal
 * go-out command leaves this unset, retaining the authored safe decline path. */
export interface OutingEventChoice {
  eventId: number;
  value: number | "decline" | "accept" | "rescue";
}
export type { OutingChoiceValue } from "../state/game-state.js";

/** Build a paused session for the chosen interactive event. The UI renders
 *  `prompt` and forwards the player's answer back via
 *  `resolveOutingChoiceSession`. */
function createChoiceSession(
  eventId: 2 | 3 | 5 | 6 | 7,
  channel: "outing-departure" | "outing-return",
  state: GameState,
): OutingChoiceSession {
  const prompt = INTERACTIVE_EVENT_PROMPTS[eventId];
  const sessionPrompt: OutingChoicePromptSpec = eventId === 7
    ? {
        ...prompt,
        options: prompt.options.map((option) => {
          if (typeof option.id !== "number") return { ...option };
          const item = EV7_SHOP.find((candidate) => candidate.id === option.id);
          return item && state.money < item.price
            ? { ...option, disabled: true, detail: `${item.price} 円（钱不够）` }
            : { ...option };
        }),
      }
    : {
        ...prompt,
        options: prompt.options.map((option) => ({ ...option })),
      };
  return {
    kind: "outing-choice",
    eventId,
    channel,
    startedAtTick: state.time.tickValue,
    prompt: sessionPrompt,
  };
}

function addBase(state: GameState, charaNum: number, id: number, delta: number): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return;
  slot.state.BASE[id] = Math.max(0, (slot.state.BASE[id] ?? 0) + delta);
}

function addExp(state: GameState, charaNum: number, id: number, delta: number): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return;
  slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + delta;
}

export function outingEventOpportunitySet(state: Readonly<GameState>, channel: "outing-departure" | "outing-return"): EventOpportunitySet {
  return compileEventOpportunitySet({
    channel,
    dayIndex: state.time.dayIndex,
    contextKey: state.master.location,
    candidates: Array.from({ length: 9 }, (_, id) => ({
      id,
      name: OUTING_EVENT_NAMES[id]!,
      source: "upstream" as const,
      probability: id === 0 || id === 4
        ? channel === "outing-return" ? "1/10" : "not-applicable"
        : id === 1
          ? channel === "outing-departure" ? "1/7" : "1/3"
          : id === 2
            ? channel === "outing-return" ? "1/10" : "not-applicable"
            : id === 3 || id === 5 || id === 7
              ? channel === "outing-departure" ? "1/12" : "1/10"
              : id === 6
                ? channel === "outing-departure" ? "1/15" : "1/10"
                : id === 8
                  ? channel === "outing-departure" ? "1/12" : "1/15"
                  : "1/10",
      safety: ["deterministic", "fail-closed"] as const,
    })),
  });
  /* Kept below as the historical shape until the generated event audit is
   * refreshed; the return above is the authoritative nine-event manifest.
  return compileEventOpportunitySet({
    channel,
    dayIndex: state.time.dayIndex,
    contextKey: state.master.location,
    candidates: Array.from({ length: 9 }, (_, id) => ({
      id,
      name: OUTING_EVENT_NAMES[id]!,
      source: "upstream" as const,
      probability: id === 1
        ? channel === "outing-departure" ? "1/7" : "1/3"
        : id === 3 || id === 5 || id === 7
          ? channel === "outing-departure" ? "1/12" : "1/10"
          : id === 2
            ? channel === "outing-return" ? "1/10" : "not-applicable"
          : id === 0 || id === 4 ? "1/10" : "未实现",
      safety: ["deterministic", "fail-closed"] as const,
    })),
  });
  */
}

const event = (state: GameState, text: string): ObservationEvent => ({ kind: "NARRATION", timestamp: state.time.tickValue, text });

function datePartner(state: GameState): number | undefined {
  const partner = state.flagStore[FLAG_ID.デート相手] ?? 0;
  if (partner > 0 && state.charas[partner] && (state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0) return partner;
  const candidates = Object.values(state.charas).filter((slot) => (slot.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0);
  return candidates.length === 1 ? candidates[0]!.charaNum : undefined;
}

function eligibleEv0(state: GameState, partner: number): boolean {
  const slot = state.charas[partner];
  if (!slot) return false;
  const st = slot.state;
  return ((st.TALENT[TALENT_ID.思慕] ?? 0) !== 0 || (st.TALENT[TALENT_ID.恋慕] ?? 0) !== 0) &&
    (st.MARK?.[MARK_ID.反発刻印] ?? 0) === 0 && (st.TALENT[TALENT_ID.心情] ?? 0) >= 0;
}

function runEv0(state: GameState, rng: Rng): ObservationEvent[] {
  const partner = datePartner(state);
  if (partner === undefined || !eligibleEv0(state, partner) || rng.int(10) !== 0) return [];
  const slot = state.charas[partner]!;
  const st = slot.state;
  const multiplier = (st.TALENT[TALENT_ID.幼稚] ?? 0) !== 0 ? 12
    : (st.TALENT[TALENT_ID.恋人] ?? 0) !== 0 ? 13
      : (st.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 ? 12 : 11;
  const mood = st.BASE[BASE_ID.情緒] ?? 0;
  const maxMood = st.MAXBASE[BASE_ID.情緒] ?? 0;
  // Upstream assigns `BASE:情緒 = MIN(BASE:情緒 / 10 * MULTIPLE,
  // MAXBASE:情緒)`, rather than adding a delta.
  const scaledMood = Math.trunc(mood / 10) * multiplier;
  st.BASE[BASE_ID.情緒] = maxMood > 0 ? Math.min(maxMood, scaledMood) : scaledMood;
  if ((st.TALENT[TALENT_ID.幼稚] ?? 0) === 0) st.BASE[BASE_ID.理性] = Math.max(0, (st.BASE[BASE_ID.理性] ?? 0) - multiplier * 5);
  return [event(state, `${slot.callName ?? `角色${partner}`}在返程中和你度过了温柔的时光。`)];
}

function hasDate(state: Readonly<GameState>): boolean {
  return datePartner(state) !== undefined || (state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0;
}

/** EV1 is intentionally disabled until the original fight-or-flee battle can
 * be settled authoritatively. The previous implementation auto-dodged the
 * encounter and awarded battle experience without running BATTLE_SYSTEM. */
function runEv1(): ObservationEvent[] {
  return [];
}

/** Mirror of each event's pre-condition + RNG check. Used by the runner to
 *  decide whether the event WOULD fire (and therefore warrants a prompt) when
 *  no choice has been provided yet. Consumes the same RNG calls as the event
 *  itself so the post-roll RNG state is identical to `runEvent` having run. */
function preflightWouldFire(state: GameState, rng: Rng, id: number, channel: "outing-departure" | "outing-return"): boolean {
  switch (id) {
    case 2:
      if (channel !== "outing-return") return false;
      if (hasDate(state)) return false;
      return rng.int(10) === 0;
    case 3:
      if (mapIdOfLocation(state.master.location) !== 2 &&
          (state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 2) return false;
      return rng.int(channel === "outing-departure" ? 12 : 10) === 0;
    case 5:
      if (hasDate(state)) return false;
      return rng.int(channel === "outing-departure" ? 12 : 10) === 0;
    case 6:
      return rng.int(channel === "outing-departure" ? 15 : 10) === 0;
    case 7:
      if (hasDate(state)) return false;
      return rng.int(10) === 0;
    default:
      return false;
  }
}

/** EV2's upstream branches contain an interactive drinking scene. Preserve
 * the date gate, probability and deterministic safe aftermath. */
function runEv2(state: GameState, rng: Rng, choice?: OutingEventChoice): ObservationEvent[] {
  // A persisted choice session is proof that the probability gate already
  // fired. Re-rolling here could erase the accepted branch after the player
  // clicked "参加宴会".
  if (hasDate(state) || (!choice && rng.int(10) !== 0)) return [];
  if (choice?.eventId === 2 && choice.value === "decline") {
    return [
      event(state, "你婉拒了狸猫的宴会邀请。"),
      event(state, "「诶，也好也好！不纠缠客人啦ー」"),
      event(state, "你无视了仍在挥手的狸猫，继续踏上了归途。"),
    ];
  }
  const luck = Math.trunc((state.master.state.CFLAG[CFLAG_ID.今日の運勢] ?? 0) / 100) +
    getTflag(state, TFLAG_ID.幸運補正) +
    (state.master.state.TALENT[TALENT_ID.酒耐性] ?? 0) + rng.int(10);
  if (luck >= 10) {
    addItem(state, ITEM_ID.どぶろく, 5);
    addItem(state, ITEM_ID.清酒, 5);
    addItem(state, ITEM_ID.鬼殺し, 5);
    const current = state.master.state.BASE[BASE_ID.酒気] ?? 0;
    const max = state.master.state.MAXBASE[BASE_ID.酒気] ?? 0;
    state.master.state.BASE[BASE_ID.酒気] = max > 0 ? Math.max(Math.trunc(max / 3) * 2, current) : current;
  } else if (luck >= 5) {
    addBase(state, 0, BASE_ID.気力, -100);
  } else {
    state.money = Math.max(0, state.money - 500);
  }
  advanceTimeTicks(state, 30);
  return [
    event(state, "「太好啦ー！那么客人，这边这边，跟着我们来！」"),
    event(state, "穿着羽织的妖怪狸们已经开始了宴会，热闹地举杯欢迎你的到来。"),
    event(state, luck >= 10
      ? "宴会的酒意外地醇厚，你带着几份酒回到了路上。"
      : luck >= 5
        ? "你只喝了几口便觉得头昏脑涨，只好提前离开宴会。"
        : "狸猫们的宴会看起来热闹非凡，但你的钱包似乎变轻了一些。"),
    event(state, "「下次再见啦ー！路上小心哦！」"),
  ];
}

function runEv3(state: GameState, rng: Rng, channel: "outing-departure" | "outing-return", choice?: OutingEventChoice): ObservationEvent[] {
  // Unlike the other encounters, upstream EV3 is also allowed during a
  // village date (CFLAG:MASTER:约会中 == 2).
  if (mapIdOfLocation(state.master.location) !== 2 &&
      (state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 2) return [];
  if (rng.int(channel === "outing-departure" ? 12 : 10) !== 0) return [];
  if (choice?.eventId === 3 && choice.value === "decline") {
    return [
      event(state, "你拒绝了那个男人的搭话。"),
      event(state, "「啊啊！请等一下！不要无视我，救救我啊ー！」"),
      event(state, "你没有回头，和同伴一起继续赶路。"),
    ];
  }
  const luck = Math.trunc((state.master.state.CFLAG[CFLAG_ID.今日の運勢] ?? 0) / 100) + getTflag(state, TFLAG_ID.幸運補正);
  if (luck < 5) {
    addBase(state, 0, BASE_ID.気力, -300);
    const partner = datePartner(state);
    if (partner !== undefined) {
      const target = state.charas[partner]!.state;
      target.BASE[BASE_ID.気力] = Math.max(0, (target.BASE[BASE_ID.気力] ?? 0) - 300);
      target.BASE[BASE_ID.情緒] = Math.trunc((target.BASE[BASE_ID.情緒] ?? 0) / 3);
    }
    advanceTimeTicks(state, 60);
    return [
      event(state, "「世界末日就要到了！最近的异变你也注意到了吧？」"),
      event(state, "那个男人没完没了地描述着自己的臆想，你只好在合适的时候逃走。"),
      event(state, "浪费了时间和气力的你，疲惫地踏上了归途。"),
    ];
  }
  addItem(state, ITEM_ID.睡眠薬, 9);
  const partner = datePartner(state);
  if (partner !== undefined) addItem(state, ITEM_ID.媚薬, 2);
  addBase(state, 0, BASE_ID.気力, -100);
  if (partner !== undefined) addBase(state, partner, BASE_ID.気力, -100);
  advanceTimeTicks(state, 30);
  return [
    event(state, "「哦哦！谢谢、谢谢！刚才从哪里开始说起呢……」"),
    event(state, "男人讲起了抗抑郁药的神奇功效，说这是足以应对世界末日的珍贵药物。"),
    event(state, "「作为听我说话的谢礼，这些药就全部送给你吧！」"),
    event(state, partner !== undefined
      ? "你和同伴收下药物，在一阵疲惫的长谈后重新踏上了旅程。"
      : "你收下药物，在一阵疲惫的长谈后重新踏上了旅程。"),
  ];
}

function runEv5(state: GameState, rng: Rng, channel: "outing-departure" | "outing-return", choice?: OutingEventChoice): ObservationEvent[] {
  if (hasDate(state) || rng.int(channel === "outing-departure" ? 12 : 10) !== 0) return [];
  if (choice?.eventId === 5 && choice.value === "decline") {
    return [
      event(state, "「嗯……那就算了。下次有机会再来找我吧？」"),
      event(state, "你默默甩开了陌生女人的手，赶忙继续赶路。"),
    ];
  }
  const luck = Math.trunc((state.master.state.CFLAG[CFLAG_ID.今日の運勢] ?? 0) / 100) +
    getTflag(state, TFLAG_ID.幸運補正) + rng.int(2);
  if (luck > 4) {
    addExp(state, 0, EXP_ID.清掃経験, 5);
    state.master.state.TCVAR[TCVAR_ID.清掃経験] = (state.master.state.TCVAR[TCVAR_ID.清掃経験] ?? 0) + 5;
    state.master.state.EX[EX_ID.今日的掃除回数] = (state.master.state.EX[EX_ID.今日的掃除回数] ?? 0) + 20000;
    addItem(state, ITEM_ID.運動飲料, 2);
    advanceTimeTicks(state, 60);
    return [
      event(state, "「呼呼呼，谢谢您啦。仔细一看，您的身材还真不错呢～」"),
      event(state, "被她拉到广场后，你发现那里堆满了宴会留下的垃圾。"),
      event(state, "你莫名其妙地加入了清扫，完成后收下了两瓶运动饮料。"),
      event(state, "「哇ー，变得干净了！下次也请来帮忙呀♪」"),
    ];
  }
  addBase(state, 0, BASE_ID.体力, -250);
  advanceTimeTicks(state, 60);
  return [
    event(state, "「来嘛，跟我走一小段路就好啦。」"),
    event(state, "你意识到情况不对，慌忙挣脱时却在灌木边摔了一跤。"),
    event(state, "那女人早已不见踪影，你带着擦伤继续赶路。"),
  ];
}

/** EV7 is an input-heavy travelling shop. The non-interactive dispatcher takes
 * the authored no-purchase branch; the ordinary shop command remains the
 * authoritative purchase path. */
function runEv7(
  state: GameState,
  rng: Rng,
  channel: "outing-departure" | "outing-return",
  choice?: OutingEventChoice,
): ObservationEvent[] {
  if (hasDate(state) || rng.int(channel === "outing-departure" ? 10 : 10) !== 0) return [];
  const stoneAvailable = ((state.dailyEventFlags?.[23] ?? 0) & 1) !== 0 && itemCount(state, ITEM_ID.奇跡之石) === 0;
  if (!choice || choice.eventId !== 7 || choice.value === "decline") {
    return [
      event(state, "你拒绝了因幡的推销。"),
      event(state, "「怎么会ー，至少聊几句嘛ー」"),
      event(state, "你无视了仍在坚持叫卖的兔子商贩，继续前往目的地。"),
    ];
  }
  const item = EV7_SHOP.find((candidate) => candidate.id === choice.value);
  if (!item || (item.id === ITEM_ID.奇跡之石 && !stoneAvailable) || !buyItem(state, item.id, 1, item.price)) {
    return [
      event(state, "你翻了翻钱包，发现这件商品目前买不起。"),
      event(state, "「什么嘛，只是个穷鬼啊……浪费这么多时间了ー」"),
      event(state, "因幡撇了撇嘴，背起货物离开了。"),
    ];
  }
  return [
    event(state, "「好呀好呀～非常感谢！那么，这是其他地方见不到的秘藏之一！」"),
    event(state, `「虽然价格有点小贵，但是效果绝对有保障！！${item.name}，请收好！」`),
    event(state, `因幡的流动商贩售出了${item.name}。`),
    event(state, "「非常感谢您的购买！咿呀～客人桑真好骗……希望您能再次光顾！」"),
    event(state, "兔子贩卖员留下几句尖酸的台词后，背着货物离开了。"),
  ];
}

function excludedForEv4(state: GameState, slot: NonNullable<GameState["charas"][number]>): boolean {
  const st = slot.state;
  const root = (location: string | undefined) => location?.split(":", 1)[0] ?? "";
  const atBase = root(slot.homeLocation) !== "" && root(slot.homeLocation) === root(state.homeLocation);
  const freeAction = (state.freeActions?.[slot.charaNum]?.remainingMinutes ?? 0) > 0;
  return (st.CFLAG[CFLAG_ID.出禁] ?? 0) !== 0 || atBase || slot.location === state.master.location || freeAction ||
    (st.CFLAG[CFLAG_ID.拠点来訪] ?? 0) !== 0 || (st.CFLAG[CFLAG_ID.来訪不能] ?? 0) !== 0 ||
    (st.CFLAG[CFLAG_ID.行动] ?? 0) === 5 ||
    (st.CFLAG[CFLAG_ID.宴会参加] ?? 0) !== 0 || (st.BASE[BASE_ID.体力] ?? 1) <= 0 ||
    (st.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0 || (st.CFLAG[CFLAG_ID.来訪時間] ?? 0) !== 0;
}

function runEv4(state: GameState, rng: Rng): ObservationEvent[] {
  if ((state.flagStore[FLAG_ID.交流来訪模式] ?? 1) === 3 || rng.int(10) !== 0) return [];
  const order = Object.keys(state.charas).map(Number);
  for (let i = order.length - 1; i > 0; i -= 1) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
  for (const charaNum of order.slice(0, 10)) {
    const slot = state.charas[charaNum];
    if (!slot || excludedForEv4(state, slot)) continue;
    const name = slot.callName ?? "";
    // The upstream 若鷺姫 pool/pool-weather dependency is not represented in
    // the modern roster; fail closed instead of inventing eligibility.
    if (name.includes("若鷺") || name.includes("若鹭") || name.includes("わかさぎ")) continue;
    if (name.includes("妹紅") || name.includes("妹红") || name.includes("輝夜") || name.includes("辉夜")) {
      if ((slot.state.CFLAG[CFLAG_ID.好感度] ?? 0) <= 500) continue;
    } else if (!(slot.state.TALENT[TALENT_ID.思慕] || slot.state.TALENT[TALENT_ID.恋慕])) continue;
    slot.state.CFLAG[CFLAG_ID.拠点来訪] = 1;
    slot.state.CFLAG[CFLAG_ID.現在位置] = 0;
    slot.state.CFLAG[CFLAG_ID.最後に来訪した日] = state.time.dayIndex;
    return [event(state, `${name || `角色${charaNum}`}突然来到了据点。`)];
  }
  return [];
}

function runEv6(state: GameState, rng: Rng, channel: "outing-departure" | "outing-return", choice?: OutingEventChoice): ObservationEvent[] {
  if (rng.int(channel === "outing-departure" ? 15 : 10) !== 0) return [];
  if (choice?.eventId === 6 && choice.value === "decline") {
    return [
      event(state, "你看着陷阱里的小动物，最终还是决定不要妨碍猎人的诱捕。"),
      event(state, "它不安地缩在原地，你和同伴继续踏上了旅程。"),
    ];
  }
  const prey = rng.int(2) === 0 ? "狐狸" : "狸猫";
  const partner = datePartner(state);
  const luck = Math.trunc((state.master.state.CFLAG[CFLAG_ID.今日の運勢] ?? 0) / 100) +
    getTflag(state, TFLAG_ID.幸運補正);
  const events = [
    event(state, `你发现一只困在猎人陷阱里的${prey}，停下来替它解开了机关。`),
    event(state, `「……」${prey}受伤地缩在你的脚边，似乎正在观察你。`),
  ];
  let minutes = 15;
  if (luck > 4) {
    const reward = EV6_REWARDS[rng.int(EV6_REWARDS.length)]!;
    addItem(state, reward.id, 2);
    events.push(event(state, `${prey}消失在灌木丛中，随后叼着谢礼回来了：${reward.name}x2。`));
  } else if (partner !== undefined) {
    state.master.state.BASE[BASE_ID.体力] = Math.max(0, (state.master.state.BASE[BASE_ID.体力] ?? 0) - 200);
    events.push(event(state, `${prey}受惊抓伤了你，随后逃进灌木丛，连一句道谢也没有。`));
  } else {
    state.master.state.BASE[BASE_ID.体力] = Math.max(0, (state.master.state.BASE[BASE_ID.体力] ?? 0) - 100);
    state.master.state.BASE[BASE_ID.気力] = Math.max(0, (state.master.state.BASE[BASE_ID.気力] ?? 0) - 300);
    minutes = 60;
    events.push(event(state, "猎人追来训斥了你一番。你什么也没得到，只能疲惫地继续赶路。"));
  }
  events.push(...advanceTimeTicks(state, minutes));
  return events;
}

function marisaEligible(state: GameState, departure: boolean): boolean {
  const marisa = state.charas[MARISA_CHARA_ID];
  if (!marisa || !(marisa.callName ?? "").includes("魔理沙")) return false;
  if ((state.flagStore[FLAG_ID.デート相手] ?? 0) === MARISA_CHARA_ID) return false;
  const st = marisa.state;
  if ((st.CFLAG[CFLAG_ID.出禁] ?? 0) !== 0) return false;
  if (!departure && (st.CFLAG[CFLAG_ID.神社在住] ?? 0) !== 0) return false;
  if ((st.CFLAG[CFLAG_ID.拠点来訪] ?? 0) !== 0 || (st.CFLAG[CFLAG_ID.行动] ?? 0) === 5) return false;
  if ((st.CFLAG[CFLAG_ID.宴会参加] ?? 0) !== 0) return false;
  return true;
}

function runEv8(state: GameState, rng: Rng, channel: "outing-departure" | "outing-return"): ObservationEvent[] {
  const departure = channel === "outing-departure";
  const onKoumakanRoute = departure
    ? (state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) === 3
    : mapIdOfLocation(state.homeLocation ?? state.master.homeLocation ?? "") === 3;
  if (!onKoumakanRoute || rng.int(departure ? 12 : 15) !== 0 || !marisaEligible(state, departure)) return [];
  const potion = rng.int(3) === 0;
  const pool = potion ? EV8_POTIONS : EV8_MUSHROOMS;
  const reward = pool[rng.int(pool.length)]!;
  const amount = potion ? 1 : 3;
  addItem(state, reward.id, amount);
  return [
    event(state, "快到红魔馆时，魔理沙从上空飞驰而过，多半又去偷书了。"),
    event(state, `路边发现了她遗落的${reward.name}x${amount}。`),
  ];
}

/** Internal dispatcher. For interactive events (EV2/3/5/6/7) WITHOUT a
 *  supplied choice, performs the same RNG pre-check the event itself would do
 *  and returns `null` ONLY when the event would actually fire — this avoids
 *  falsely pausing on a 1-in-N miss. The caller is expected to invoke the
 *  same event id again with a choice to settle. With a `choice`, runs the
 *  event directly so tests and the resolve path can bypass the pause. */
function runEvent(
  state: GameState,
  rng: Rng,
  id: number,
  channel: "outing-departure" | "outing-return",
  choice?: OutingEventChoice,
): ObservationEvent[] | null {
  const isInteractive = (INTERACTIVE_EVENT_IDS as readonly number[]).includes(id);
  if (isInteractive && !choice) {
    // Advance the rng identically to the event function so subsequent
    // preflight calls observe the same state.
    return preflightWouldFire(state, rng, id, channel) ? null : [];
  }
  if (id === 1) return runEv1();
  if (id === 2) return channel === "outing-return" ? runEv2(state, rng, choice) : [];
  if (id === 3) return runEv3(state, rng, channel, choice);
  if (id === 5) return runEv5(state, rng, channel, choice);
  if (id === 7) return runEv7(state, rng, channel, choice);
  if (id === 6) return runEv6(state, rng, channel, choice);
  if (id === 8) return runEv8(state, rng, channel);
  if (channel === "outing-return" && id === 0) return runEv0(state, rng);
  if (channel === "outing-return" && id === 4) return runEv4(state, rng);
  return [];
}

export function runOutingDepartureEvents(state: GameState, rng: Rng, choice?: OutingEventChoice): OutingEventResult {
  let next = cloneGameState(state);
  const events: ObservationEvent[] = [];
  // Clear a stale session from the retired EV1 modal before normal travel
  // events are evaluated. It carries no authoritative settlement.
  next.outingEventSession = null;
  const tflag = getTflag(next, TFLAG_ID.一日一回);
  if ((tflag & DEPARTURE_EVENT_BIT) !== 0) return { state: next, ended: false, events, diagnostics: [] };
  const opportunity = outingEventOpportunitySet(next, "outing-departure");
  const ranking = next.acceptedEventRankings?.find((entry) => entry.setId === opportunity.setId && entry.contextHash === opportunity.contextHash && entry.dayIndex === opportunity.dayIndex)?.candidateIds;
  const order = ranking ?? [0, 1, 2, 3, 4, 5, 6, 7, 8];
  let selectedEventId: number | undefined;
  for (const id of order) {
    const candidate = cloneGameState(next);
    try {
      const selected = runEvent(candidate, rng, id, "outing-departure", choice);
      if (selected === null) {
        // Interactive event selected and no choice provided — pause for the
        // player. Do NOT consume the day's departure-event TFLAG yet: the
        // resolution path will mark settlement on completion, so a cancelled
        // prompt still allows retrying the same day.
        const pausedEventId = id as 2 | 3 | 5 | 6 | 7;
        next.outingEventSession = createChoiceSession(pausedEventId, "outing-departure", next);
        return {
          state: next,
          ended: false,
          events: [event(next, INTERACTIVE_EVENT_PROMPTS[pausedEventId].question)],
          diagnostics: ["outing event paused: awaiting player choice"],
          selectedEventId: id,
        };
      }
      if (selected.length === 0) continue;
      next = candidate;
      events.push(...selected);
      selectedEventId = id;
      break;
    } catch (error) {
      return { state: next, ended: false, events: [], diagnostics: [`outing event ${id}: ${String(error)}`] };
    }
  }
  setTflag(next, TFLAG_ID.一日一回, getTflag(next, TFLAG_ID.一日一回) | DEPARTURE_EVENT_BIT);
  consumeEventRanking(next, opportunity);
  return { state: next, ended: false, events, diagnostics: [], ...(selectedEventId === undefined ? {} : { selectedEventId }) };
}

export function runOutingReturnEvents(state: GameState, rng: Rng, choice?: OutingEventChoice): OutingEventResult {
  let next = cloneGameState(state);
  const events: ObservationEvent[] = [];
  const tflag = getTflag(next, TFLAG_ID.一日一回);
  if ((tflag & RETURN_EVENT_BIT) !== 0) return { state: next, ended: false, events, diagnostics: [] };
  const opportunity = outingEventOpportunitySet(next, "outing-return");
  const ranking = next.acceptedEventRankings?.find((entry) => entry.setId === opportunity.setId && entry.contextHash === opportunity.contextHash && entry.dayIndex === opportunity.dayIndex)?.candidateIds;
  const order = ranking ?? [0, 1, 2, 3, 4, 5, 6, 7, 8];
  let selectedEventId: number | undefined;
  for (const id of order) {
    const candidate = cloneGameState(next);
    try {
      const selected = runEvent(candidate, rng, id, "outing-return", choice);
      if (selected === null) {
        const pausedEventId = id as 2 | 3 | 5 | 6 | 7;
        next.outingEventSession = createChoiceSession(pausedEventId, "outing-return", next);
        return {
          state: next,
          ended: false,
          events: [event(next, INTERACTIVE_EVENT_PROMPTS[pausedEventId].question)],
          diagnostics: ["outing event paused: awaiting player choice"],
          selectedEventId: id,
        };
      }
      if (selected.length === 0) continue;
      next = candidate;
      events.push(...selected);
      selectedEventId = id;
      break;
    } catch (error) {
      return { state: next, ended: false, events: [], diagnostics: [`outing event ${id}: ${String(error)}`] };
    }
  }
  consumeEventRanking(next, opportunity);
  if (events.length > 0) setTflag(next, TFLAG_ID.一日一回, getTflag(next, TFLAG_ID.一日一回) | RETURN_EVENT_BIT);
  return { state: next, ended: events.length > 0, events, diagnostics: [], ...(selectedEventId === undefined ? {} : { selectedEventId }) };
}

/** Retire a stale EV1 session without inventing a battle outcome, OR apply a
 *  player's answer to a paused interactive outing event session. */
export function resolveOutingEventSession(
  state: GameState,
  answer?: { eventId: number; value: OutingChoiceValue },
): OutingEventResult {
  const next = cloneGameState(state);
  const session = next.outingEventSession;
  if (!session) {
    return { state: next, ended: false, events: [], diagnostics: ["no active outing event"] };
  }
  if (session.kind === "outing-ev1") {
    next.outingEventSession = null;
    return { state: next, ended: true, events: [], diagnostics: ["retired outing EV1 session"] };
  }
  // Kind === "outing-choice-result" is a paused read-only result screen.
  // Calling resolve on it without an answer returns the existing events.
  if (session.kind === "outing-choice-result") {
    if (!answer) {
      return {
        state: next,
        ended: false,
        events: [...session.resultEvents],
        diagnostics: ["outing choice result awaiting dismissal"],
      };
    }
    // Caller is forcing another resolution — restart by clearing and re-running
    // the resolution path with the original session data.
    next.outingEventSession = {
      kind: "outing-choice",
      eventId: session.eventId,
      channel: session.channel,
      startedAtTick: session.startedAtTick,
      prompt: session.prompt,
    };
    return resolveOutingEventSession(next, answer);
  }
  // kind === "outing-choice"
  if (!answer) {
    return {
      state: next,
      ended: false,
      events: [],
      diagnostics: ["outing choice session awaiting answer"],
    };
  }
  if (answer.eventId !== session.eventId) {
    return {
      state: next,
      ended: false,
      events: [],
      diagnostics: ["outing choice event mismatch"],
    };
  }
  const selectedOption = session.prompt.options.find((option) => option.id === answer.value);
  if (!selectedOption || selectedOption.disabled) {
    return {
      state: next,
      ended: false,
      events: [],
      diagnostics: [selectedOption ? "outing choice option disabled" : "outing choice option unknown"],
    };
  }
  // Apply the authored branch deterministically. Re-seed RNG by reading the
  // session tick so the outcome is reproducible for the same session.
  const rng = createSessionRng(next, session.startedAtTick);
  const choice: OutingEventChoice = { eventId: answer.eventId, value: answer.value };
  const events = runEvent(next, rng, session.eventId, session.channel, choice) ?? [];
  // Transition the session into `outing-choice-result` so the result panel can
  // render the full event chain (including branches the player chose) before
  // committing anything to the persistent eventLog. The previous version
  // cleared the session immediately and pushed the events, which made the
  // popup vanish the moment the player clicked a branch.
  next.outingEventSession = {
    kind: "outing-choice-result",
    eventId: session.eventId,
    channel: session.channel,
    startedAtTick: session.startedAtTick,
    prompt: session.prompt,
    resultEvents: events,
  };
  if (session.channel === "outing-departure") {
    setTflag(next, TFLAG_ID.一日一回, getTflag(next, TFLAG_ID.一日一回) | DEPARTURE_EVENT_BIT);
  } else {
    setTflag(next, TFLAG_ID.一日一回, getTflag(next, TFLAG_ID.一日一回) | RETURN_EVENT_BIT);
  }
  return {
    state: next,
    ended: true,
    events,
    diagnostics: [],
    selectedEventId: session.eventId,
  };
}

/** Commit the events from a paused `outing-choice-result` session into the
 *  persistent eventLog, schedule reprojection across the new tick range, and
 *  clear the session so the player returns to the underlying screen. */
export function commitOutingChoiceResult(state: GameState): {
  state: GameState;
  events: ReadonlyArray<ObservationEvent>;
} {
  const session = state.outingEventSession;
  if (!session || session.kind !== "outing-choice-result") {
    return { state, events: [] };
  }
  const next = cloneGameState(state);
  next.outingEventSession = null;
  return { state: next, events: session.resultEvents };
}

/** Reseed the RNG to the deterministic session tick so the choice branch
 *  reproduces the same outcome the player would have seen at the original
 *  call site. Mirrors the legacy `Rng` factory used by the dispatch path.
 *  The `next` / `pick` shims satisfy the `Rng` interface contract; only `int`
 *  is actually consumed by `runEvent`. */
function createSessionRng(state: GameState, startedAtTick: number): Rng {
  return {
    next: () => 0,
    int(maxExclusive: number): number {
      const x = Math.imul((startedAtTick * 2654435761) ^ state.time.tickValue, 1597334677) >>> 0;
      return (x % Math.max(1, maxExclusive)) | 0;
    },
    pick: <T>(arr: readonly T[]): T => arr[0]!,
  };
}
