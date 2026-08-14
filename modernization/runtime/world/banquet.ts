import type {
  BanquetBeat,
  BanquetEventInstance,
  BanquetProgram,
  GameState,
} from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/types.js";
import { cloneGameState } from "../state/game-state.js";
import { applyRelationshipDelta } from "../state/relationship.js";
import { getWeatherState } from "../state/weather-state.js";
import { regionIdOfLocation } from "../weather/region-system.js";
import { compileEventOpportunitySet, consumeEventRanking, type EventOpportunitySet } from "./event-ranking.js";
import { recordDateBanquetSignal } from "../agent/recorder.js";

// Keep the world-event module dependency-light: settlement.ts imports the
// clock, which projects banquets. These are the canonical ids used by the
// settlement layer and match the upstream AutoConst headers.
const BASE_WORK = 13;
const CFLAG_ACTION = 325;
const CFLAG_WORKPLACE = 326;
const CFLAG_JOB = 350;
const CFLAG_LOCATION = 300;
const CFLAG_BANQUET = 20;
const JOB_PREPARE = 48;
const JOB_PARTICIPATE = 49;
const JOB_CLEANUP = 50;

// FLAG 30/31/32/33/34/35/36 are upstream banquet mirrors. 38/39 are reserved
// by the modern runtime for the persisted absolute end date/time; upstream
// does not expose these two convenience values in AutoConst_FLAG.ERH.
const FLAG_BANQUET_ENABLED = 3;
const FLAG_BANQUET_TEMPLATE = 30;
const FLAG_BANQUET_SCALE = 31;
const FLAG_BANQUET_VENUE = 32;
const FLAG_BANQUET_START_TIME = 33;
const FLAG_BANQUET_START_DAY = 34;
const FLAG_BANQUET_COUNT = 35;
const FLAG_BANQUET_BAD_WEATHER = 36;
const FLAG_BANQUET_END_DAY = 38;
const FLAG_BANQUET_END_TIME = 39;

const BANQUET_MIRROR_FLAGS = [
  FLAG_BANQUET_TEMPLATE,
  FLAG_BANQUET_SCALE,
  FLAG_BANQUET_VENUE,
  FLAG_BANQUET_START_TIME,
  FLAG_BANQUET_START_DAY,
  FLAG_BANQUET_COUNT,
  FLAG_BANQUET_BAD_WEATHER,
  FLAG_BANQUET_END_DAY,
  FLAG_BANQUET_END_TIME,
] as const;

function venueRoomId(venue: string): number {
  if (venue.includes("中央広場")) return 202;
  if (venue.includes("小料理屋")) return 218;
  if (venue.includes("走廊")) return 409;
  if (venue.includes("庭")) return 11;
  if (venue.includes("境内")) return 2;
  if (venue.includes("本殿の裏")) return 20;
  if (venue.includes("分社")) return 21;
  if (venue.includes("居間")) return 9;
  return 0;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export interface BanquetTemplate {
  id: number;
  name: string;
  weight: number;
  venue: string;
  scale: number | ((rng: Rng) => number);
  startHour: number;
  forced: boolean;
  requiresSunny?: boolean;
  season?: number;
  dateRange?: readonly [number, number];
  requiredHostNames?: readonly string[];
  requiredGuestNames?: readonly string[];
}

export const BANQUET_TEMPLATES: readonly BanquetTemplate[] = Object.freeze([
  { id: 1, name: "灵梦的随兴酒宴", weight: 100, venue: "神社:境内", scale: (rng) => 1000 + rng.int(1500), startHour: 0, forced: false, requiresSunny: true },
  { id: 2, name: "幻想乡年忘会", weight: 0, venue: "人間之里:居間", scale: 6000, startHour: 15, forced: true, season: 4, dateRange: [25, 30], requiredGuestNames: ["P9"] },
  { id: 3, name: "月见酒", weight: 0, venue: "永遠亭:走廊", scale: (rng) => 2000 + rng.int(1000), startHour: 19, forced: true, season: 3, dateRange: [1, 14], requiredGuestNames: ["P409"], requiresSunny: true },
  { id: 4, name: "收获祭", weight: 0, venue: "人間之里:中央広場", scale: (rng) => 2000 + rng.int(3000), startHour: 9, forced: true, season: 3, dateRange: [16, 26], requiredGuestNames: ["静叶", "穰子"] },
  { id: 7, name: "畜生界的和平亲睦会", weight: 50, venue: "畜生界:组织首领宅", scale: 1200, startHour: 18, forced: false, season: 1, dateRange: [4, 4], requiredGuestNames: ["八千慧", "早鬼", "尤魔", "ちやり", "美天", "慧ノ子"] },
  { id: 8, name: "住所不定者的集会", weight: 50, venue: "山麓:大蛤蟆之池", scale: (rng) => 1001 + rng.int(500), startHour: 19, forced: false, dateRange: [10, 10] },
  { id: 10, name: "姐姐聚会", weight: 100, venue: "人間之里:小料理屋", scale: (rng) => 1201 + rng.int(500), startHour: 19, forced: false, season: 2, dateRange: [3, 3], requiredGuestNames: ["蕾米莉亚", "露娜萨", "觉", "静叶", "丰姬", "白莲", "幻月", "紫苑"] },
  { id: 11, name: "正邪的一人宴会", weight: 100, venue: "山麓:玄武之泽", scale: (rng) => 1000 + rng.int(200), startHour: 21, forced: false, season: 1, dateRange: [8, 8], requiredHostNames: ["正邪"] },
]);

export function banquetOpportunitySet(state: Readonly<GameState>): EventOpportunitySet {
  return compileEventOpportunitySet({
    channel: "banquet",
    dayIndex: state.time.dayIndex,
    contextKey: `${state.time.season ?? 1}:${state.time.date ?? 1}`,
    candidates: BANQUET_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      source: "upstream" as const,
      weight: template.weight,
      probability: template.forced ? "forced" : "weighted",
      locationIds: [template.venue],
      safety: ["deterministic", "fail-closed"] as const,
    })),
  });
}

export interface BanquetResult {
  state: GameState;
  events: ObservationEvent[];
  diagnostics: string[];
  instance?: BanquetEventInstance;
}

const narration = (state: GameState, text: string): ObservationEvent => ({ kind: "NARRATION", timestamp: state.time.tickValue, text });

function currentTemplate(state: Readonly<GameState>): BanquetTemplate | undefined {
  const season = state.time.season ?? 1;
  const date = state.time.date ?? 1;
  const forced = BANQUET_TEMPLATES.find((template) => template.forced && template.season === season && template.dateRange && date >= template.dateRange[0]! && date <= template.dateRange[1]!);
  if (forced) return forced;
  return state.time.dayIndex % 7 === 5 ? BANQUET_TEMPLATES[0] : undefined;
}

function authoredEligible(state: Readonly<GameState>, template: BanquetTemplate): boolean {
  const season = state.time.season ?? 1;
  const date = state.time.date ?? 1;
  if (!template.dateRange || date < template.dateRange[0]! || date > template.dateRange[1]!) return false;
  if (template.id === 7 && season === 4) return false;
  if (template.id === 10 && season !== 2 && season !== 4) return false;
  if (template.id === 11 && season !== 1 && season !== 2) return false;
  if (template.id === 8) return Object.values(state.charas).filter((slot) => !(slot.state.TALENT[61] ?? 0) && (slot.state.CFLAG[311] ?? 0) === 0 && (slot.state.CFLAG[301] ?? 0) === 0).length >= 8;
  if (template.id === 10) {
    const attendants = ["咲夜", "お燐", "お空", "レイセン"];
    if (!attendants.every((name) => { const id = findNamed(state, name); return id !== undefined && (state.charas[id]!.state.CFLAG[301] ?? 0) === 0; })) return false;
  }
  if (template.id === 11) {
    const seija = Object.values(state.charas).find((slot) => slot.callName?.includes("正邪"));
    return !!seija && (seija.state.CFLAG[301] ?? 0) === 0 && (seija.state.ABL[10] ?? 0) >= 8;
  }
  return (template.requiredGuestNames ?? []).every((name) => { const id = findNamed(state, name); return id !== undefined && (state.charas[id]!.state.CFLAG[301] ?? 0) === 0; });
}

export function chooseBanquetTemplate(state: Readonly<GameState>, rng: Rng): BanquetTemplate | undefined {
  if ((state.flagStore[FLAG_BANQUET_ENABLED] ?? 1) === 0) return undefined;
  const forced = currentTemplate(state);
  if (forced) return forced;
  const authored = BANQUET_TEMPLATES.filter((template) => template.id >= 7 && authoredEligible(state, template));
  if (authored.length > 0) return authored[rng.int(authored.length)]!;
  if (state.time.dayIndex % 7 !== 5) return undefined;
  const opportunity = banquetOpportunitySet(state);
  const ranking = state.acceptedEventRankings?.find((entry) => entry.setId === opportunity.setId && entry.contextHash === opportunity.contextHash && entry.dayIndex === opportunity.dayIndex)?.candidateIds;
  if (ranking) {
    const ranked = ranking.map((id) => BANQUET_TEMPLATES.find((template) => template.id === id)).find((template) => template && template.weight > 0);
    if (ranked) return ranked;
  }
  const weighted = BANQUET_TEMPLATES.filter((template) => template.weight > 0);
  const total = weighted.reduce((sum, template) => sum + template.weight, 0);
  if (total <= 0 || rng.int(total) >= weighted[0]!.weight) return undefined;
  return weighted[0];
}

function findNamed(state: Readonly<GameState>, name: string): number | undefined {
  const direct = /^P(\d+)$/.exec(name);
  if (direct) return state.charas[Number(direct[1])] ? Number(direct[1]) : undefined;
  const aliases = name === "穰子" ? ["穰子", "穣子"]
    : name === "静叶" ? ["静叶", "静葉"]
      : name === "ちやり" ? ["ちやり", "血枪"]
        : name === "慧ノ子" ? ["慧ノ子", "慧之子"]
          : name === "お燐" ? ["お燐", "阿燐", "燐"]
            : name === "お空" ? ["お空", "阿空", "空"]
              : [name];
  return Object.values(state.charas).find((slot) => aliases.some((alias) => slot.callName?.includes(alias)))?.charaNum;
}

function venueFor(template: BanquetTemplate, rng: Rng): string {
  if (template.id !== 1) return template.venue;
  // ENKAI_1's intentionally non-uniform continuous RAND branches.
  if (rng.int(5) <= 3) return "神社:庭";
  if (rng.int(4) === 0) return "神社:境内";
  if (rng.int(4) === 0) return "神社:本殿の裏";
  if (rng.int(4) === 0) return "守矢神社:分社";
  return "人間之里:小料理屋";
}

function participantsFor(state: GameState, template: BanquetTemplate, venue: string, rng: Rng): { participants: number[]; hosts: number[]; guests: number[]; excluded: number[]; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const excluded = Object.values(state.charas).filter((slot) => slot.callName?.includes("正邪")).map((slot) => slot.charaNum);
  let guests = (template.requiredGuestNames ?? []).flatMap((name) => { const id = findNamed(state, name); if (id === undefined) diagnostics.push(`required guest ${name} is missing`); return id === undefined ? [] : [id]; });
  let hosts = template.id === 4
    ? Object.values(state.charas)
      .filter((slot) => !excluded.includes(slot.charaNum) && !guests.includes(slot.charaNum) && slot.homeLocation?.startsWith("人間之里"))
      .map((slot) => slot.charaNum)
    : (template.requiredHostNames ?? []).flatMap((name) => { const id = findNamed(state, name); if (id === undefined) diagnostics.push(`required host ${name} is missing`); return id === undefined ? [] : [id]; });
  if (template.id === 7 && guests.length >= 6) { const group = (state.flagStore[FLAG_BANQUET_COUNT] ?? 0) % 3; hosts = [guests[[0, 2, 1][group]!]!, guests[[4, 3, 5][group]!]!]; }
  if (template.id === 8) { guests = Object.values(state.charas).filter((slot) => !(slot.state.TALENT[61] ?? 0) && (slot.state.CFLAG[311] ?? 0) === 0 && (slot.state.CFLAG[301] ?? 0) === 0).map((slot) => slot.charaNum); hosts = guests.slice(0, 1); }
  if (template.id === 10 && guests.length >= 8) {
    const rotations = [["蕾米莉亚", "咲夜"], ["觉", "お燐", "お空"], ["丰姬", "レイセン"]] as const;
    hosts = rotations[(state.flagStore[FLAG_BANQUET_COUNT] ?? 0) % 3]!.flatMap((name) => {
      const id = findNamed(state, name);
      if (id === undefined) diagnostics.push(`required host ${name} is missing`);
      return id === undefined ? [] : [id];
    });
    guests = guests.filter((id) => !hosts.includes(id));
  }
  if (diagnostics.length > 0) return { participants: [], hosts, guests, excluded, diagnostics };
  const selected = new Set([...hosts, ...guests]);
  const candidates = Object.values(state.charas).filter((slot) => !excluded.includes(slot.charaNum) && !selected.has(slot.charaNum) && slot.location.includes(venue.split(":")[0]!));
  for (const slot of candidates.sort((a, b) => a.charaNum - b.charaNum)) if (rng.int(100) < 50) selected.add(slot.charaNum);
  return { participants: [...selected].sort((a, b) => a - b), hosts, guests, excluded, diagnostics };
}

function orderedFocus(participants: number[], hosts: number[], guests: number[]): number[] {
  return [...new Set([...hosts, ...guests, ...participants])].sort((a, b) => a - b).slice(0, 3);
}

/** Build the deterministic fallback story used until an AI proposal exists. */
export function buildBanquetProgram(template: BanquetTemplate, participants: number[], hosts: number[], guests: number[], scale: number): BanquetProgram {
  const activeDurationMinutes = clampInt(Math.ceil(scale / 10), 30, 720);
  const focus = orderedFocus(participants, hosts, guests);
  const definitions: readonly [BanquetBeat["kind"], string, number][] = [
    ["arrival", "到场", -15],
    ["toast", "开场与祝酒", 0],
    ["social", "自由交流", Math.round(activeDurationMinutes * 0.22)],
    ["performance", template.id === 3 ? "赏月节目" : template.id === 4 ? "收获祭节目" : "表演或游戏", Math.round(activeDurationMinutes * 0.45)],
    ["incident", "席间小插曲", Math.round(activeDurationMinutes * 0.62)],
    ["feature", "宴会主节目", Math.round(activeDurationMinutes * 0.8)],
    ["closing", "收束", activeDurationMinutes],
  ];
  let previous = -16;
  const beats = definitions.map(([kind, title, proposedOffset], index) => {
    const offsetMinutes = Math.max(previous + 1, Math.min(activeDurationMinutes, proposedOffset));
    previous = offsetMinutes;
    return {
      id: `banquet-${template.id}-beat-${index + 1}`,
      kind,
      title,
      offsetMinutes,
      participants: focus,
      status: "pending" as const,
    } satisfies BanquetBeat;
  });
  return { version: 1, activeDurationMinutes, beats, cursor: 0, momentum: 0 };
}

function templateForInstance(instance: BanquetEventInstance): BanquetTemplate {
  return BANQUET_TEMPLATES.find((template) => template.id === instance.templateId) ?? BANQUET_TEMPLATES[0]!;
}

function ensureProgram(instance: BanquetEventInstance): BanquetProgram {
  if (instance.program) return instance.program;
  instance.program = buildBanquetProgram(templateForInstance(instance), instance.participants, instance.hosts, instance.guests, instance.initialScale);
  return instance.program;
}

function namesFor(state: GameState, ids: readonly number[]): string {
  const names = ids.map((id) => state.charas[id]?.callName ?? state.charas[id]?.name ?? `#${id}`);
  return names.length > 0 ? names.join("、") : "宾客们";
}

const AUTHORED_PROSE: Record<number, Partial<Record<BanquetBeat["kind"], string>>> = {
  7: { arrival: "剑拔弩张的气氛中，畜生界三大组织的和平酒会正式开始了。", toast: "三方首领举杯时仍互相盯着彼此，和平二字显得格外可疑。", social: "部下们围着熟人落座，争抢邻座的眼神几乎擦出火花。", performance: "宴席热闹到高潮，组织间的较劲暂时变成了拼酒。", incident: "外面突然传来警察扫荡的喊声，满场宾客默契地四散奔逃。", feature: "自称警察的小兔姬追着众人冲过会场，亲睦会彻底变成了逃亡。", closing: "会场渐渐空无一人，只剩空酒瓶和脏碗碟；三大组织的酒会结束了。" },
  8: { arrival: "没有固定住处的人们在大蛤蟆之池边陆续聚齐。", toast: "平时难得见到的面孔举杯互认，这场临时集会正式开始。", social: "没有住所可谈，众人便聊起各自最近落脚的地方。", performance: "有人从随身行李里翻出乐器和零食，池边很快热闹起来。", incident: "风吹乱了临时铺开的席子，大家七手八脚把东西抢救回来。", feature: "短暂相聚让这些漂泊者交换了下一次见面的约定。", closing: "人们各自带走行囊，池边恢复了原来的安静。" },
  10: { arrival: "“长女大人万岁！”赞美姐姐的喧嚣中，姐姐聚会宣告开幕。", toast: "酒瓶被高高举起，议题是如何守护姐姐的声誉与魅力。", social: "长女们互诉妹妹带来的辛劳，话题很快偏向彼此攀比。", performance: "众人拿弹幕、家务和威严举例，试图证明谁才是最优秀的姐姐。", incident: "一句“那弹幕怎么看都像妹妹的”让会场陷入短暂而危险的沉默。", feature: "醉意最终得出结论：长女只有一人，正因稀有所以无比崇高。", closing: "会议在醉鬼的胡言乱语中结束，只留下堆积如山的空酒瓶。" },
  11: { arrival: "正邪的信只写着她要一个人开心地开宴会，却又故意留下地点和时间。", toast: "正邪装作完全没有邀请任何人，自顾自地举杯开席。", social: "她一边说独饮最自在，一边不时确认有没有人真的来了。", performance: "天邪鬼把普通下酒菜说得一文不值，却一口也没剩下。", incident: "有人靠近时，正邪立刻强调这绝不是在等谁。", feature: "这场所谓的一人宴会，终于在别扭的陪伴中有了宴会的样子。", closing: "正邪嘴上赶人，收拾酒杯时却明显心情很好。" },
};

function applyBeat(state: GameState, instance: BanquetEventInstance, program: BanquetProgram, beat: BanquetBeat, events: ObservationEvent[]): void {
  const template = templateForInstance(instance);
  const names = namesFor(state, beat.participants);
  const authored = AUTHORED_PROSE[template.id]?.[beat.kind];
  if (authored) {
    beat.outcome = beat.kind === "incident" ? "tension" : beat.kind === "performance" || beat.kind === "feature" ? "applause" : "warmth";
    program.momentum += beat.kind === "incident" ? -3 : 8;
    if (beat.kind === "social") for (const id of beat.participants) applyRelationshipDelta(state, id, 10, 5);
    if (beat.kind === "closing") instance.finalScale = Math.max(0, instance.initialScale + program.momentum * 10);
    events.push(narration(state, authored));
    return;
  }
  switch (beat.kind) {
    case "arrival":
      beat.outcome = "warmth";
      program.momentum += 5;
      events.push(narration(state, `${template.name}的宾客陆续到场，席间渐渐热闹起来。`));
      return;
    case "toast":
      beat.outcome = "warmth";
      program.momentum += 8;
      events.push(narration(state, `主持人举杯致意，${template.name}正式开场。`));
      return;
    case "social":
      beat.outcome = "warmth";
      program.momentum += 10;
      for (const id of beat.participants) applyRelationshipDelta(state, id, 10, 5);
      events.push(narration(state, `${names}围坐交谈，彼此的距离明显拉近了。`));
      return;
    case "performance":
      beat.outcome = "applause";
      program.momentum += 12;
      events.push(narration(state, `${beat.title}赢得一阵掌声，宴会的气氛更加高涨。`));
      return;
    case "incident": {
      const mishap = ((instance.seed + beat.offsetMinutes + instance.templateId) & 1) === 0;
      if (mishap) {
        beat.outcome = "tension";
        program.momentum -= 8;
        for (const id of beat.participants.slice(0, 2)) applyRelationshipDelta(state, id, -2, -1);
        events.push(narration(state, "席间发生了一个小插曲，短暂的尴尬让谈话停了一拍。"));
      } else {
        beat.outcome = "recovery";
        program.momentum += 3;
        events.push(narration(state, "席间出了点小状况，但众人很快把气氛拉了回来。"));
      }
      return;
    }
    case "feature":
      beat.outcome = "applause";
      program.momentum += 15;
      for (const id of beat.participants.slice(0, 1)) applyRelationshipDelta(state, id, 8, 3);
      events.push(narration(state, `${beat.title}成为今晚的焦点，宾客们留下了深刻印象。`));
      return;
    case "closing":
      beat.outcome = program.momentum >= 0 ? "warmth" : "recovery";
      instance.finalScale = Math.max(0, instance.initialScale + program.momentum * 10);
      events.push(narration(state, program.momentum >= 0 ? "宴会在一片笑声中收束。" : "宴会带着些许疲惫收束，但总算平稳落幕。"));
      return;
  }
}

function advanceProgram(state: GameState, instance: BanquetEventInstance, events: ObservationEvent[]): void {
  const program = ensureProgram(instance);
  const relative = state.time.tickValue - instance.scheduledStartTick;
  while (program.cursor < program.beats.length) {
    const beat = program.beats[program.cursor]!;
    if (beat.status !== "pending") {
      program.cursor += 1;
      continue;
    }
    if (relative < beat.offsetMinutes) break;
    applyBeat(state, instance, program, beat, events);
    beat.status = "completed";
    program.cursor += 1;
  }
}

function skipProgram(instance: BanquetEventInstance): void {
  const program = ensureProgram(instance);
  for (const beat of program.beats) if (beat.status === "pending") beat.status = "skipped";
  program.cursor = program.beats.length;
}

function moveToVenue(slot: GameState["master"], venue: string): void {
  slot.location = venue;
  const roomId = venueRoomId(venue);
  if (roomId > 0) slot.state.CFLAG[CFLAG_LOCATION] = roomId;
}

function restoreOrigin(slot: GameState["master"], instance: BanquetEventInstance): void {
  const origin = instance.originLocations?.[slot.charaNum] ?? slot.homeLocation;
  if (origin) slot.location = origin;
  const originRoomId = instance.originRoomIds?.[slot.charaNum];
  if (originRoomId !== undefined) slot.state.CFLAG[CFLAG_LOCATION] = originRoomId;
}

function clearBanquetFlags(state: GameState): void {
  for (const id of BANQUET_MIRROR_FLAGS) state.flagStore[id] = 0;
}

function clearParticipantState(state: GameState, instance: BanquetEventInstance): void {
  for (const id of new Set([...instance.participants, ...instance.hosts])) {
    const slot = state.charas[id];
    if (!slot) continue;
    slot.state.CFLAG[CFLAG_BANQUET] = 0;
    slot.state.CFLAG[CFLAG_JOB] = 0;
    slot.state.CFLAG[CFLAG_WORKPLACE] = 0;
    slot.state.CFLAG[CFLAG_ACTION] = 0;
    slot.state.BASE[BASE_WORK] = 0;
    slot.state.MAXBASE[BASE_WORK] = 0;
    restoreOrigin(slot, instance);
  }
}

function prepareHosts(state: GameState, instance: BanquetEventInstance, venueId: number): void {
  const preparationWork = Math.min(Math.floor(instance.initialScale / 3), 2400);
  for (const id of instance.hosts) {
    const slot = state.charas[id];
    if (!slot) continue;
    moveToVenue(slot, instance.venue);
    slot.state.CFLAG[CFLAG_JOB] = JOB_PREPARE;
    slot.state.CFLAG[CFLAG_WORKPLACE] = venueId;
    slot.state.CFLAG[CFLAG_ACTION] = 5;
    slot.state.BASE[BASE_WORK] = preparationWork;
    slot.state.MAXBASE[BASE_WORK] = preparationWork;
  }
}

function startParticipants(state: GameState, instance: BanquetEventInstance, venueId: number): void {
  for (const id of instance.participants) {
    const slot = state.charas[id];
    if (!slot) continue;
    instance.originLocations ??= {};
    instance.originRoomIds ??= {};
    if (!(id in instance.originLocations)) instance.originLocations[id] = slot.location;
    if (!(id in instance.originRoomIds)) instance.originRoomIds[id] = slot.state.CFLAG[CFLAG_LOCATION] ?? 0;
    moveToVenue(slot, instance.venue);
    recordDateBanquetSignal(state, id, `宴会开始 #${instance.templateId}`);
    slot.state.CFLAG[CFLAG_BANQUET] = instance.hosts.includes(id) ? 2 : 1;
    slot.state.CFLAG[CFLAG_LOCATION] = venueId || slot.state.CFLAG[CFLAG_LOCATION] || 0;
    slot.state.CFLAG[CFLAG_WORKPLACE] = venueId;
    slot.state.CFLAG[CFLAG_JOB] = JOB_PARTICIPATE;
    slot.state.CFLAG[CFLAG_ACTION] = 5;
    slot.state.BASE[BASE_WORK] = instance.workRemaining[id] ?? 0;
    slot.state.MAXBASE[BASE_WORK] = instance.initialScale;
  }
}

function beginCleanup(state: GameState, instance: BanquetEventInstance, venueId: number): void {
  for (const id of instance.participants) {
    const slot = state.charas[id];
    if (!slot) continue;
    if (!instance.hosts.includes(id)) {
      slot.state.CFLAG[CFLAG_JOB] = 0;
      slot.state.CFLAG[CFLAG_ACTION] = 0;
      slot.state.BASE[BASE_WORK] = 0;
      slot.state.MAXBASE[BASE_WORK] = 0;
    }
  }
  for (const id of instance.hosts) {
    const slot = state.charas[id];
    if (!slot) continue;
    moveToVenue(slot, instance.venue);
    slot.state.CFLAG[CFLAG_BANQUET] = 2;
    slot.state.CFLAG[CFLAG_JOB] = JOB_CLEANUP;
    slot.state.CFLAG[CFLAG_WORKPLACE] = venueId;
    slot.state.CFLAG[CFLAG_ACTION] = 5;
    slot.state.BASE[BASE_WORK] = instance.cleanupRemaining[id] ?? 0;
    slot.state.MAXBASE[BASE_WORK] = Math.min(Math.floor(instance.initialScale / 6), 1200);
  }
}

function scheduleFlags(state: GameState, instance: BanquetEventInstance): void {
  state.flagStore[FLAG_BANQUET_TEMPLATE] = instance.templateId;
  state.flagStore[FLAG_BANQUET_SCALE] = instance.initialScale;
  state.flagStore[FLAG_BANQUET_VENUE] = venueRoomId(instance.venue);
  state.flagStore[FLAG_BANQUET_START_TIME] = instance.scheduledStartTick % 1440;
  state.flagStore[FLAG_BANQUET_START_DAY] = Math.floor(instance.scheduledStartTick / 1440);
  state.flagStore[FLAG_BANQUET_COUNT] = instance.participants.length;
  state.flagStore[FLAG_BANQUET_BAD_WEATHER] = 0;
  state.flagStore[FLAG_BANQUET_END_DAY] = Math.floor(instance.forcedEndTick / 1440);
  state.flagStore[FLAG_BANQUET_END_TIME] = instance.forcedEndTick % 1440;
}

export function scheduleBanquet(state: GameState, rng: Rng): BanquetResult {
  const next = cloneGameState(state);
  // Upstream only evaluates a new banquet while the global event flag is
  // clear. Keep already scheduled/active instances instead of replacing a
  // long event when a day-end hook happens to run again.
  if ((next.worldEvents ?? []).some((event) => event.kind === "banquet" && !["resolved", "cancelled"].includes(event.phase))) {
    return { state: next, events: [], diagnostics: [] };
  }
  const template = chooseBanquetTemplate(next, rng);
  if (!template) return { state: next, events: [], diagnostics: [] };
  const venue = venueFor(template, rng);
  const selection = participantsFor(next, template, venue, rng);
  if (selection.diagnostics.length > 0) return { state: next, events: [], diagnostics: selection.diagnostics };
  const scale = typeof template.scale === "function" ? template.scale(rng) : template.scale;
  const date = next.time.date ?? 1;
  const dayOffset = template.id === 1 ? 1 : template.id === 2 ? 31 - date : template.id === 3 ? 15 - date : 27 - date;
  const startDay = next.time.dayIndex + Math.max(0, dayOffset);
  const startMinute = template.id === 1 ? 1360 - Math.floor(scale / 10) : template.startHour * 60;
  const startTick = startDay * 1440 + startMinute;
  const program = buildBanquetProgram(template, selection.participants, selection.hosts, selection.guests, scale);
  const cleanupWork = Math.min(Math.floor(scale / 6), 1200);
  const cleanupDuration = clampInt(Math.ceil(cleanupWork / 10), 15, 240);
  const instance: BanquetEventInstance = {
    kind: "banquet", id: `banquet-${startDay}-${template.id}`, templateId: template.id,
    seed: next.time.tickValue, venue, scheduledStartTick: startTick,
    forcedEndTick: startTick + program.activeDurationMinutes + cleanupDuration,
    phase: "scheduled", participants: selection.participants,
    hosts: selection.hosts, guests: selection.guests, excluded: selection.excluded,
    workRemaining: Object.fromEntries(selection.participants.map((id) => [id, Math.max(0, scale)])),
    cleanupRemaining: Object.fromEntries(selection.hosts.map((id) => [id, cleanupWork])),
    initialScale: scale, finalScale: scale, program,
    originLocations: Object.fromEntries(selection.participants.map((id) => [id, next.charas[id]?.location ?? ""])),
    originRoomIds: Object.fromEntries(selection.participants.map((id) => [id, next.charas[id]?.state.CFLAG[CFLAG_LOCATION] ?? 0])),
  };
  scheduleFlags(next, instance);
  next.worldEvents = [...(next.worldEvents ?? []).filter((event) => event.kind !== "banquet" || event.phase === "resolved" || event.phase === "cancelled"), instance];
  consumeEventRanking(next, banquetOpportunitySet(next));
  return { state: next, events: [narration(next, `${template.name}已安排在${venue}。`)], diagnostics: [], instance };
}

export function advanceBanquets(state: GameState, elapsedMinutes = 1): BanquetResult {
  const next = cloneGameState(state);
  const events: ObservationEvent[] = [];
  const workDelta = Math.max(1, Math.trunc(elapsedMinutes)) * 10;
  for (const instance of next.worldEvents ?? []) {
    if (instance.kind !== "banquet" || ["resolved", "cancelled"].includes(instance.phase)) continue;
    const tick = next.time.tickValue;
    const venueId = venueRoomId(instance.venue);
    const template = templateForInstance(instance);
    const venueWeather = getWeatherState(next).gensokyoWeatherSystem[regionIdOfLocation(instance.venue)] ?? 0;
    if ((instance.phase === "active" || (instance.phase === "preparing" && tick >= instance.scheduledStartTick)) && template.requiresSunny && venueWeather >= 4) {
      instance.phase = "cancelled";
      skipProgram(instance);
      clearBanquetFlags(next);
      clearParticipantState(next, instance);
      events.push(narration(next, "恶劣天气使宴会中止了。"));
      continue;
    }
    const program = ensureProgram(instance);
    const preparationStart = instance.scheduledStartTick - Math.floor(instance.initialScale / 30) - 15;
    if (instance.phase === "scheduled" && tick >= preparationStart) {
      instance.phase = "preparing";
      prepareHosts(next, instance, venueId);
      advanceProgram(next, instance, events);
    }
    if (instance.phase === "preparing" && tick >= instance.scheduledStartTick) {
      instance.phase = "active";
      startParticipants(next, instance, venueId);
      advanceProgram(next, instance, events);
    }
    if (instance.phase === "active") {
      advanceProgram(next, instance, events);
      for (const id of instance.participants) instance.workRemaining[id] = Math.max(0, (instance.workRemaining[id] ?? 0) - workDelta);
      for (const id of instance.participants) {
        const slot = next.charas[id];
        if (slot) slot.state.BASE[BASE_WORK] = instance.workRemaining[id] ?? 0;
      }
      if (Object.values(instance.workRemaining).every((work) => work <= 0) || tick >= instance.forcedEndTick) {
        instance.phase = "cleanup";
        beginCleanup(next, instance, venueId);
      }
    }
    if (instance.phase === "cleanup") {
      beginCleanup(next, instance, venueId);
      for (const id of instance.hosts) instance.cleanupRemaining[id] = Math.max(0, (instance.cleanupRemaining[id] ?? 0) - workDelta);
      for (const id of instance.hosts) {
        const slot = next.charas[id];
        if (slot) slot.state.BASE[BASE_WORK] = instance.cleanupRemaining[id] ?? 0;
      }
      if (Object.values(instance.cleanupRemaining).every((work) => work <= 0) || tick >= instance.forcedEndTick) instance.phase = "closing";
    }
    if (instance.phase === "closing") {
      advanceProgram(next, instance, events);
      const cleanupDone = Object.values(instance.cleanupRemaining).every((work) => work <= 0);
      if (tick >= instance.forcedEndTick || (cleanupDone && tick >= instance.scheduledStartTick + program.activeDurationMinutes)) {
        instance.phase = "resolved";
        clearBanquetFlags(next);
        const dirt = next.yogore?.[instance.venue] ?? 0;
        if (dirt < 300) {
          next.yogore ??= {};
          next.yogore[instance.venue] = dirt + 1000;
        }
        clearParticipantState(next, instance);
        events.push(narration(next, "宴会结束了，场地也收拾妥当。"));
      }
    }
  }
  return { state: next, events, diagnostics: [] };
}

function replaceNumericRecord(target: Record<number, number>, source: Record<number, number>): void {
  for (const key of Object.keys(target)) delete target[Number(key)];
  Object.assign(target, source);
}

/**
 * Commit the banquet-owned part of a cloned result while preserving the
 * caller's GameState and time object.  This is shared by day-end scheduling
 * and the clock path; copying only the owned mirrors prevents stale clones
 * from silently dropping unrelated state changes.
 */
export function applyBanquetStateProjection(target: GameState, source: GameState): void {
  target.worldEvents = source.worldEvents;
  // Scheduling consumes the accepted event ranking in the clone as well as
  // creating the world event; commit that owner-side mutation at day end.
  target.acceptedEventRankings = source.acceptedEventRankings;
  for (const id of BANQUET_MIRROR_FLAGS) {
    const value = source.flagStore[id];
    if (value === undefined) delete target.flagStore[id];
    else target.flagStore[id] = value;
  }
  if (source.yogore) {
    target.yogore ??= {};
    for (const key of Object.keys(target.yogore)) delete target.yogore[key];
    Object.assign(target.yogore, source.yogore);
  }
  const ids = new Set<number>();
  for (const event of source.worldEvents ?? []) {
    if (event.kind === "banquet") for (const id of [...event.participants, ...event.hosts]) ids.add(id);
  }
  for (const id of ids) {
    const projected = source.charas[id];
    const current = target.charas[id];
    if (!projected || !current) continue;
    current.location = projected.location;
    replaceNumericRecord(current.state.CFLAG, projected.state.CFLAG);
    replaceNumericRecord(current.state.BASE, projected.state.BASE);
    replaceNumericRecord(current.state.MAXBASE, projected.state.MAXBASE);
  }
}

/** Apply banquet changes without replacing the caller's GameState object. */
export function advanceBanquetsInPlace(state: GameState, elapsedMinutes = 1): BanquetResult {
  const result = advanceBanquets(state, elapsedMinutes);
  applyBanquetStateProjection(state, result.state);
  return { ...result, state };
}
