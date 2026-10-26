// Hand-authored AI-state topic table. Lives beside its only consumer rather
// than under `modernization/scenes/`, whose loader treats every subdirectory
// as a scene asset (`scene.json` + `background.txt`) and throws otherwise.
import topicsJson from "./topics.json";
import type { CharaSlot, GameState } from "../state/game-state.js";
import { ABL_ID, BASE_ID, CFLAG_ID, EXP_ID, TALENT_ID, MARK_ID } from "../state/settlement.js";
import { currentRegionWeather } from "../weather/region-override.js";
import { showTop, showBottom } from "../state/clothing.js";
import { charaDataOf, foldTasteTags } from "../state/chara-data.js";
import { alcoholFace } from "../state/alcohol.js";

export type StateRoute = "l1" | "l2" | "l3";
export interface StateTopic { id: string; label: string; aliases: string[]; related: string[]; priority: number; fields: string[] }
export interface StateFact { id: string; subject: number; label: string; value: unknown; tick: number; status: "known" | "unknown"; visibility: "self" | "public" | "director" }
export interface StateContextInput {
  state: Readonly<GameState>; route: StateRoute; observer: number; subjects?: readonly number[];
  beforeState?: Readonly<GameState>;
  cue?: string; topics?: readonly string[]; excludeFields?: readonly string[]; maxFacts?: number; maxChars?: number;
  /** Suppress the generic body baseline when a route already supplies a scene-specific status view. */
  includeBaseline?: boolean;
}
interface Field {
  label: string; visibility: StateFact["visibility"];
  read: (state: Readonly<GameState>, slot: CharaSlot) => unknown;
}
const ownStat = (label: string, ns: "BASE" | "CFLAG" | "ABL" | "EXP", id: number): Field => ({
  label, visibility: "self", read: (_state, slot) => slot.state[ns][id] ?? (ns === "BASE" ? null : 0),
});
const gauge = (label: string, id: number): Field => ({ label, visibility: "self", read: (_state, slot) => {
  const value = slot.state.BASE[id];
  return value === undefined ? null : { value, max: slot.state.MAXBASE[id] ?? null };
} });

/** Resolver allowlist owns visibility. Creator topic edits cannot widen it. */
const NAMED_FIELDS: Record<string, Field> = {
  stamina: gauge("体力（当前/上限）", BASE_ID.体力),
  energy: gauge("气力（当前/上限）", BASE_ID.気力),
  alcohol: gauge("酒气（当前/上限）", BASE_ID.酒気),
  // 醉酒**程度**，不是酒的余量：`alcohol` 只给一个裸数值，角色侧从来没有一个
  // 能读出「她现在醉了」的字段——而运行时自己就是按 `@ALCOHOL_FACE` 分档的
  // （`alcoholFace`：清醒/微醺/醉酒/不省人事，阈值 80%/50%）。复用同一个函数，
  // 不再复刻一套阈值。
  // 与 `body` 主题的其它字段一致按 self：这是**该角色自己的身体状态**，一个角色
  // 不能读另一个人的身体数值（ai-state 既有不变量）。L1/L2 的 observer 就是被写的
  // 角色本人，所以 self 已经足够让「她自己醉了」进到 prompt。
  drunkenness: { label: "醉酒状态（清醒/微醺/醉酒/不省人事）", visibility: "self", read: (s, c) => alcoholFace(s, c.charaNum) },
  sleep: ownStat("睡眠状态（0=未睡眠）", "CFLAG", CFLAG_ID.睡眠),
  overnight: ownStat("熬夜记录", "CFLAG", CFLAG_ID.徹夜),
  favor: ownStat("对主角的好感度", "CFLAG", CFLAG_ID.好感度),
  trust: ownStat("对主角的信赖度", "CFLAG", CFLAG_ID.信頼度),
  anger: ownStat("愤怒程度", "BASE", BASE_ID.憤怒),
  emotion: ownStat("心绪被撩动程度（不是心情好坏）", "BASE", BASE_ID.情緒),
  composure: ownStat("理性", "BASE", BASE_ID.理性),
  job: ownStat("职种编号（没有名称时不能猜测职业）", "CFLAG", CFLAG_ID.职种),
  workplace: ownStat("职场房间编号", "CFLAG", CFLAG_ID.职场),
  home: { label: "自宅地点", visibility: "self", read: (_s, c) => c.homeLocation ?? null },
  work: { label: "今日工作安排（status 表示是否完成，不代表过去一直在工作）", visibility: "self", read: (s, c) =>
    s.workRuntime?.dayIndex === s.time.dayIndex ? s.workRuntime.entries.filter(e => e.charaNum === c.charaNum).slice(0, 4)
      .map(e => ({ start: e.startMin, end: e.endMin, location: e.location, status: e.status, workload: e.workload })) : null },
  wake: ownStat("起床时间（游戏分钟）", "CFLAG", CFLAG_ID.起床時間),
  bedtime: ownStat("就寝时间（游戏分钟）", "CFLAG", CFLAG_ID.就寝時間),
  date: { label: "当前与主角的约会", visibility: "self", read: (s, c) => s.dateSession?.partner === c.charaNum
    ? { partner: s.master.charaNum, phase: s.dateSession.phase } : null },
  cookingSkill: ownStat("料理技能等级", "ABL", ABL_ID.料理技能),
  conversationSkill: ownStat("话术技能等级", "ABL", ABL_ID.話術技能),
  cleaningSkill: ownStat("清扫技能等级", "ABL", ABL_ID.清扫技能),
  cookingExperience: ownStat("料理累计经验（不证明某次具体经历）", "EXP", EXP_ID.料理経験),
  conversationExperience: ownStat("会话累计经验（不证明某次具体对话）", "EXP", EXP_ID.会話経験),
  gifts: { label: "自己的礼物记录（编号不能推测礼物名称）", visibility: "self", read: (s, c) => s.gifts?.[c.charaNum]?.records.slice(-3) ?? null },
  lastMeeting: ownStat("上次与主角见面的游戏日期记录", "CFLAG", CFLAG_ID.最後に会った日),
  firstKissDay: ownStat("初吻纪念日期记录（0=没有记录）", "CFLAG", CFLAG_ID.初吻喪失記念日),
  clothing: { label: "当前外层穿着", visibility: "public", read: (_s, c) => ({ upper: showTop(c) || null, lower: showBottom(c) || null }) },
  calendar: { label: "当前时间（dayIndex 从零计）", visibility: "public", read: s => ({ ...s.time }) },
  weather: { label: "主角所在区域可见天气", visibility: "public", read: (s, c) => {
    if (c.location !== s.master.location) return null;
    const w = currentRegionWeather(s);
    return w.weatherVisible ? { weather: w.weatherName, wind: w.windVisible ? w.windName : null } : null;
  } },
  dish: { label: "当前料理（未表明角色吃过或知道配方）", visibility: "director", read: s => s.dish
    ? { name: s.dish.name, type: s.dish.type, freshness: s.dish.limit, quality: s.dish.basepoint } : null },
  money: { label: "主角持有金钱", visibility: "director", read: s => s.money },
  farm: { label: "田地当前状态", visibility: "director", read: s => s.farm?.slice(0, 4) ?? null },
  brewing: { label: "当前酿造", visibility: "director", read: s => ({ material: s.varFerment ?? null, days: s.brewDays ?? null }) },
  // 角色**自己**的口味与好恶（キャラデータ 料理/感性 味覚，权重=上游出现次数）。
  // 面板（`buildCharaPreference`）对这两项有 `親密` 遮罩，但遮罩约束的是「玩家 UI
  // 能看什么」，而这里供给的是「角色自己知道什么」—— 角色当然知道自己的口味，
  // 说不说出口交给 relationship/性格那套现有机制。故此处**不套用遮罩**（用户
  // 2026-09-11 拍板）。
  foodTaste: { label: "料理口味偏好（喜欢的味道 / 讨厌的味道，weight=偏向强度）", visibility: "self", read: (_s, c) => {
    const data = charaDataOf(c.charaNum);
    const trim = (raw: string | undefined) => foldTasteTags(raw).slice(0, 6).map(({ tag, weight }) => ({ tag, weight }));
    const likes = trim(data?.foodLike);
    const dislikes = trim(data?.foodDislike);
    return likes.length > 0 || dislikes.length > 0 ? { likes, dislikes } : null;
  } },
  senseTaste: { label: "感性好恶（喜欢 / 讨厌的倾向，weight=偏向强度）", visibility: "self", read: (_s, c) => {
    const data = charaDataOf(c.charaNum);
    const trim = (raw: string | undefined) => foldTasteTags(raw).slice(0, 6).map(({ tag, weight }) => ({ tag, weight }));
    const likes = trim(data?.senseLike);
    const dislikes = trim(data?.senseDislike);
    return likes.length > 0 || dislikes.length > 0 ? { likes, dislikes } : null;
  } },
};

/** Creator-addressable, canonical named stats. Missing sparse values remain unknown;
 * no raw CFLAG aliases or transient settlement buffers are auto-exposed. */
const namedNamespaces = { ABL: ABL_ID, EXP: EXP_ID, BASE: BASE_ID, MAXBASE: BASE_ID, TALENT: TALENT_ID, MARK: MARK_ID };
for (const [namespace, names] of Object.entries(namedNamespaces)) {
  const ns = namespace as keyof typeof namedNamespaces;
  for (const [name, id] of Object.entries(names)) {
    NAMED_FIELDS[`${namespace}.${name}`] = { label: `${name}（${namespace} 原值；只证明当前记录，不推断具体往事）`,
      visibility: "self", read: (_s, c) => c.state[ns][id] ?? null };
  }
}
export const STATE_FIELDS: Readonly<Record<string, Field>> = Object.freeze(NAMED_FIELDS);
export function stateFieldCatalog() { return Object.entries(STATE_FIELDS).map(([id, f]) => ({ id, label: f.label, visibility: f.visibility })); }

export function compileStateTopics(value: unknown): readonly StateTopic[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error("主题目录必须是最多 128 项的数组");
  const ids = new Set<string>();
  const topics = value.map((raw, index): StateTopic => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`主题 ${index} 无效`);
    const r = raw as Record<string, unknown>;
    if (Object.keys(r).some(k => !["id", "label", "aliases", "related", "priority", "fields"].includes(k))) throw new Error(`主题 ${index} 包含未知字段`);
    if (typeof r.id !== "string" || !/^[a-z][a-z0-9.-]{0,63}$/.test(r.id) || ids.has(r.id)) throw new Error(`主题 ${index} ID 无效或重复`);
    ids.add(r.id);
    if (typeof r.label !== "string" || !r.label || r.label.length > 100 || !Number.isInteger(r.priority) || Number(r.priority) < 0 || Number(r.priority) > 100) throw new Error(`主题 ${r.id} 名称或优先级无效`);
    for (const key of ["aliases", "related", "fields"]) {
      if (!Array.isArray(r[key]) || r[key].length > 64 || r[key].some((x: unknown) => typeof x !== "string" || !x || x.length > 100)) throw new Error(`主题 ${r.id}.${key} 无效`);
    }
    const fields = r.fields as string[];
    if (fields.some(id => !Object.hasOwn(STATE_FIELDS, id))) throw new Error(`主题 ${r.id} 引用未知字段`);
    return Object.freeze({ id: r.id, label: r.label, aliases: Object.freeze([...(r.aliases as string[])]) as unknown as string[], related: Object.freeze([...(r.related as string[])]) as unknown as string[], fields: Object.freeze([...fields]) as unknown as string[], priority: Number(r.priority) });
  });
  if (topics.some(t => t.related.some(id => !ids.has(id)))) throw new Error("主题关联引用不存在的 ID");
  return Object.freeze(topics);
}
let activeTopics = compileStateTopics(topicsJson);
let topicRevision = 1;
export function configureStateTopics(value: unknown): void { activeTopics = compileStateTopics(value); topicRevision++; }
export function resetStateTopics(): void { activeTopics = compileStateTopics(topicsJson); topicRevision++; }
export function getStateTopics(): readonly StateTopic[] { return activeTopics; }
export function stateTopicRevision(): number { return topicRevision; }
const normalize = (text: string) => text.normalize("NFKC").toLowerCase();
let indexedRevision = 0;
let aliasIndex: Array<{ alias: string; id: string }> = [];
function indexedAliases() {
  if (indexedRevision !== topicRevision) {
    aliasIndex = activeTopics.flatMap(t => t.aliases.map(alias => ({ alias: normalize(alias), id: t.id })));
    indexedRevision = topicRevision;
  }
  return aliasIndex;
}
function allowed(field: Field, input: StateContextInput, subject: number): boolean {
  if (input.route === "l3") return true;
  if (field.visibility === "director") return false;
  if (field.visibility === "self") return subject === input.observer;
  const observer = input.state.charas[input.observer] ?? (input.state.master.charaNum === input.observer ? input.state.master : undefined);
  const target = input.state.charas[subject] ?? (input.state.master.charaNum === subject ? input.state.master : undefined);
  return Boolean(observer && target && observer.location === target.location);
}

export function resolveStateContext(input: StateContextInput) {
  const started = performance.now();
  const subjects = [...new Set(input.subjects ?? [input.observer])].slice(0, input.route === "l3" ? 4 : 1);
  const available = activeTopics.filter(t => t.fields.some(id => subjects.some(subject => allowed(STATE_FIELDS[id]!, input, subject))));
  const byId = new Map(available.map(t => [t.id, t]));
  const cue = normalize((input.cue ?? "").slice(0, 4000));
  const seeds = new Set((input.topics ?? []).slice(0, 3).filter(id => byId.has(id)));
  for (const { alias, id } of indexedAliases()) if (byId.has(id) && cue.includes(alias)) seeds.add(id);
  const observer = input.state.charas[input.observer];
  const before = input.beforeState?.charas[input.observer];
  if (observer && (!input.subjects || input.subjects.includes(input.observer))) {
    const lowStamina = (observer.state.MAXBASE[BASE_ID.体力] ?? 0) > 0
      && (observer.state.BASE[BASE_ID.体力] ?? Infinity) < observer.state.MAXBASE[BASE_ID.体力]! / 4;
    if (byId.has("body") && (lowStamina || (before && [BASE_ID.体力, BASE_ID.気力, BASE_ID.酒気].some(id => before.state.BASE[id] !== observer.state.BASE[id])))) seeds.add("body");
    if (byId.has("work") && before && before.state.CFLAG[CFLAG_ID.行动] !== observer.state.CFLAG[CFLAG_ID.行动]) seeds.add("work");
  }
  const fallback = seeds.size === 0 && !input.topics?.length && input.includeBaseline !== false;
  if (fallback) seeds.add("body");
  const queue = [...seeds].map(id => ({ id, depth: fallback ? 2 : 0, via: fallback ? "baseline" : "seed" }));
  const visited = new Set<string>();
  const selected: Array<{ field: string; priority: number; topic: string; via: string; rank: number }> = [];
  // L1 must retain its basic body snapshot even when another keyword matches.
  // Add only this topic's own fields; its work/schedule links are still on-demand.
  // Scene-specific routes can suppress it, and normal visibility/exclusion/budget
  // checks below still apply. Keep L2/L3's existing baseline behavior.
  const body = byId.get("body");
  if (input.route === "l1" && input.includeBaseline !== false && body) {
    for (const field of body.fields) selected.push({ field, topic: body.id, priority: body.priority, via: "baseline", rank: 2 });
  }
  while (queue.length && visited.size < 128) {
    const item = queue.shift()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    const topic = byId.get(item.id);
    if (!topic) continue;
    for (const field of topic.fields) selected.push({ field, topic: topic.id, priority: topic.priority - item.depth * 30,
      via: item.via, rank: input.route === "l1" && item.via === "seed" ? 1 : 0 });
    if (item.depth < 2) for (const id of topic.related) queue.push({ id, depth: item.depth + 1, via: topic.id });
  }
  const maxFacts = Math.min(input.maxFacts ?? (input.route === "l1" ? 24 : input.route === "l2" ? 48 : 64), 64);
  const maxChars = Math.min(input.maxChars ?? (input.route === "l1" ? 2400 : input.route === "l2" ? 4800 : 7200), 12000);
  const facts: StateFact[] = [];
  const trace: Array<{ field: string; topic: string; via: string; status: string }> = [];
  const seen = new Set<string>();
  let chars = 2;
  for (const item of selected.sort((a, b) => b.rank - a.rank || b.priority - a.priority || a.field.localeCompare(b.field))) {
    if (input.excludeFields?.includes(item.field)) continue;
    const field = STATE_FIELDS[item.field]!;
    for (const subject of subjects) {
      if (!allowed(field, input, subject)) continue;
      const key = `${subject}:${item.field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const slot = input.state.charas[subject] ?? (subject === input.state.master.charaNum ? input.state.master : undefined);
      if (!slot) continue;
      const value = field.read(input.state, slot);
      const fact: StateFact = { id: key, subject, label: field.label, value: value ?? null, tick: input.state.time.tickValue, status: value == null ? "unknown" : "known", visibility: field.visibility };
      const serialized = JSON.stringify(fact);
      const fits = facts.length < maxFacts && chars + serialized.length + 1 <= maxChars;
      trace.push({ field: key, topic: item.topic, via: item.via, status: fits ? fact.status : "budget" });
      if (fits) { facts.push(JSON.parse(serialized) as StateFact); chars += serialized.length + 1; }
    }
  }
  return { facts, topics: available.map(({ id, label }) => ({ id, label })), trace, chars, durationMs: performance.now() - started };
}
