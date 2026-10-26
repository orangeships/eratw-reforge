import type { MobGirlCandidateProfile } from "../../../modernization/runtime/world/dynamic-characters.js";
import { createOpenAiCompatibleProvider } from "./provider.js";
import type { AiCompletionRequest, AiSettings } from "./types.js";
import { promptText } from "./prompt-catalog.js";

/** 物色页面资料文案（初见口上 + 亲密偏好）的写作规则；块 `l1.mob.intro`。 */
export const MOB_GIRL_INTRO_SYSTEM_PROMPT = [
  "你是 eraTW 物色页面的角色资料文案生成器。",
  "只输出严格 JSON，不要解释、分析、Markdown、标签或代码块。",
  "请写两句短文案：一条角色第一次见到玩家时说出的短口上，一条第一人称脑内妄想。",
  "初见口上控制在 16-56 个汉字，像正在面对玩家自然说话，有迟疑、试探、戒备、主动或玩笑中的一种情绪；不要写成资料表，不要主动报出姓名或称呼。",
  "亲密偏好控制在 20-64 个汉字，写成角色脑内闪过的第一人称妄想：明确中意的体位和具体玩法，可用‘要是…就…’‘光是想象…’‘被…时…’这类句式，必须直白点出体位和具体玩法（如骑乘、后入、口交、指交、阴蒂刺激、束缚、抽插等），不要写‘我喜欢/我偏爱/我中意’，也不要用‘亲密互动’‘进一步接触’这类含糊说法。",
  "内容是第一次接触时的暂时印象，不是已经发生的事件，不得改变好感、信赖、能力、位置或任何游戏状态。",
  "保持种族、地域、当前体力气力和能力倾向一致；不要凭空加入原作角色姓名或未给出的背景。",
  "语气具体、自然、有角色感，避免资料表式复述；偏好描述是角色自己的妄想片段，不是玩家指令或第三人称说明。",
  '输出格式只能是 {"selfIntro":"...","preference":"..."}。',
].join("\n");

/** 动态路人基础画像的写作规则；块 `l1.mob.persona`。 */
export const MOB_GIRL_PERSONA_SYSTEM_PROMPT = [
  "你是 eraTW 动态路人角色的基础画像生成器。",
  "只输出严格 JSON，不要解释、分析、Markdown、标签或代码块。",
  "输出一条第三人称短画像，16-48 个汉字：必须保留种族辨识度，并添加一个独立、具体的性格钩子。",
  "不要写性偏好、已发生的经历、原作角色姓名、未提供的背景，也不要改变任何游戏状态。",
  '{"persona":"..."}。',
].join("\n");

export interface MobGirlVoiceProfile {
  readonly selfIntro: string;
  readonly preference: string;
  readonly source: "ai" | "fallback";
}

export interface MobGirlBasePersona {
  readonly persona: string;
  readonly source: "ai" | "fallback";
}

export function mobGirlPersonaKey(profile: MobGirlCandidateProfile): string {
  return `${profile.seed}:${profile.callName}:${profile.species}:${profile.region}`;
}

const MAX_FIELD_LENGTH = 120;
const MAX_BASE_PERSONA_LENGTH = 100;
const META_TEXT = /(?:作为(?:一个)?AI|语言模型|system prompt|系统提示|```)/i;
const POSITION_TERMS = /(?:骑乘|后入|正面(?:拥抱|位)|侧卧|跪姿|站立位|坐姿|69|足交|口交)/;
const PLAY_TERMS = /(?:口交|舔舐|吮吸|抽插|指交|手指|阴蒂|乳房|乳头|束缚|调教|摩擦|亲吻|抚摸|挑逗|节奏)/;
const THIRD_PERSON_TERMS = /(?:她|她的|这个女孩|这个女人|角色本人)/;
const PREFERENCE_VERBS = /我(?:喜欢|偏爱|中意|爱着|最爱|最喜欢)/;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeField(value: unknown, field: string, maxLength = MAX_FIELD_LENGTH): string {
  if (typeof value !== "string") throw new Error(`mob girl profile ${field} is not text`);
  const text = compact(value);
  if (!text || text.length > maxLength || META_TEXT.test(text)) {
    throw new Error(`mob girl profile ${field} is invalid`);
  }
  return text;
}

function requireThirdPerson(text: string, field: string): string {
  if (/(^|[，。；：、\s])(?:我|俺|咱|本小姐|本姑娘|老娘)/.test(text)) {
    throw new Error(`mob girl profile ${field} must use third person`);
  }
  return text;
}

function requireFirstPerson(text: string, field: string): string {
  if (THIRD_PERSON_TERMS.test(text) || !/(?:^|[，。；：、！？!?…\s「『“\"])我/.test(text)) {
    throw new Error(`mob girl profile ${field} must use first person`);
  }
  return text;
}

function containsForbiddenName(text: string, forbiddenName: string): boolean {
  const name = compact(forbiddenName);
  if (!name) return false;
  if (name.length > 1) return text.includes(name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[「『“\"\\s：:，,。！？!?])${escaped}(?=$|[」』”\"\\s，,。！？!?])`).test(text)
    || new RegExp(`(?:我是|我叫|叫作|名叫)${escaped}`).test(text);
}

function rejectForbiddenName(text: string, forbiddenName: string | undefined, field: string): string {
  if (forbiddenName && containsForbiddenName(text, forbiddenName)) {
    throw new Error(`mob girl profile ${field} must not reveal the candidate name`);
  }
  return text;
}

function requireFantasyPreference(text: string): string {
  if (THIRD_PERSON_TERMS.test(text) || PREFERENCE_VERBS.test(text)) {
    throw new Error("mob girl profile preference must be first-person fantasy, not a preference statement");
  }
  if (!POSITION_TERMS.test(text) || !PLAY_TERMS.test(text) || !/(?:我|要是|想象|被|让)/.test(text)) {
    throw new Error("mob girl profile preference must name a position and a concrete fantasy activity");
  }
  return text;
}

/** Strictly accepts the two-field object used by the candidate panel. */
export function parseMobGirlProfile(raw: string, forbiddenName?: string): MobGirlVoiceProfile {
  const trimmed = raw
    .replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think>\s*/gi, "")
    .trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("mob girl profile is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("mob girl profile must be an object");
  }
  const record = parsed as Record<string, unknown>;
  const selfIntro = rejectForbiddenName(
    requireFirstPerson(safeField(record.selfIntro, "selfIntro", 80), "selfIntro"),
    forbiddenName,
    "selfIntro",
  );
  const preference = rejectForbiddenName(
    requireFantasyPreference(safeField(record.preference, "preference", 110)),
    forbiddenName,
    "preference",
  );
  return {
    selfIntro,
    preference,
    source: "ai",
  };
}

/** Strict parser for the short persistent persona attached to a dynamic role. */
export function parseMobGirlBasePersona(raw: string): MobGirlBasePersona {
  const trimmed = raw
    .replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think>\s*/gi, "")
    .trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("mob girl base persona is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("mob girl base persona must be an object");
  }
  const value = requireThirdPerson(
    safeField((parsed as Record<string, unknown>).persona, "persona", MAX_BASE_PERSONA_LENGTH),
    "persona",
  );
  return { persona: value, source: "ai" };
}

function ability(profile: MobGirlCandidateProfile, key: string): number {
  return profile.abilities.find((item) => item.key === key)?.value ?? 0;
}

/** Stable local copy when AI is disabled, unavailable, or times out. */
export function fallbackMobGirlProfile(profile: MobGirlCandidateProfile): MobGirlVoiceProfile {
  const intros = [
    "……一直盯着我看，是有什么事吗？有话就过来直说。",
    "第一次见面就靠这么近？我可还没说答应呢。",
    "如果只是问路，我可以告诉你；要是另有打算，就别装了。",
    "你看起来不像迷路的人。我先听听，你到底想找我做什么？",
    "别紧张，我不会突然跑掉……但你最好先把来意说清楚。",
    "这种地方也能遇见你？我正闲得发慌，要不要陪我说两句？",
  ];
  const preference = ability(profile, "奉仕精神") >= 2
    ? "要是跪下来含住，再被手指刺激阴蒂，我会一直想象那种失控感。"
    : ability(profile, "欲望") >= 2
      ? "光是想象骑乘或后入时被加快抽插、贴着耳边挑逗，就让人发热。"
      : ability(profile, "従順") >= 2
        ? "要是正面位时被束缚住腰，再被慢慢抚摸，我会忍不住迎上去。"
        : ability(profile, "技巧") >= 2
          ? "侧卧缠抱时被亲吻、摩擦，再故意停下吊着，我会一直惦记那一下。"
          : "要是正面位或骑乘时先亲吻抚摸，再慢慢抽插，我会想象自己被逼到失态。";
  return {
    selfIntro: `我叫${profile.callName}。${intros[Math.abs(profile.seed) % intros.length]!}`,
    preference,
    source: "fallback",
  };
}

const PERSONA_HOOKS = [
  "表面爽快，心里总要先掂量三分",
  "看着懒散，遇到新鲜事却比谁都积极",
  "嘴上不饶人，真正被夸时反而会害羞",
  "习惯先观察再行动，一旦认定就很执着",
  "喜欢把小事做得漂亮，也不介意偶尔恶作剧",
  "外表温顺，骨子里藏着不肯让步的倔强",
] as const;

/** Stable local persona used immediately after materialization and on AI failure. */
export function fallbackMobGirlBasePersona(profile: MobGirlCandidateProfile): MobGirlBasePersona {
  const hook = PERSONA_HOOKS[Math.abs(profile.seed) % PERSONA_HOOKS.length]!;
  return {
    persona: `${profile.callName}是${profile.region}遇见的${profile.species}，${hook}。`,
    source: "fallback",
  };
}

export function buildMobGirlProfileCompletion(
  profile: MobGirlCandidateProfile,
  settings: AiSettings,
): AiCompletionRequest {
  const abilityText = profile.abilities
    .map((item) => `${item.key} Lv${item.value}`)
    .join("、");
  return {
    system: promptText(settings, "l1.mob.intro", MOB_GIRL_INTRO_SYSTEM_PROMPT),
    user: [
      "【候选资料】",
      "称呼：暂不公开，不得在两句文案中出现姓名或称呼。",
      `种族：${profile.species}`,
      `地域：${profile.region}`,
      `当前地点：${profile.location}`,
      `接触方式：${profile.encounterType}`,
      `体力：${profile.stamina.value}/${profile.stamina.max}`,
      `气力：${profile.will.value}/${profile.will.max}`,
      `好感：${profile.favor}`,
      `信赖：${profile.trust}`,
      `第一次状态：${profile.firstTimeStatus ?? "未知"}${profile.firstTimeHistory ? `（${profile.firstTimeHistory}）` : ""}`,
      `能力倾向：${abilityText}`,
      `本次随机种子：${profile.seed}`,
      "只返回 JSON，不要把数值逐项抄进文案。",
    ].join("\n"),
    temperature: settings.temperature,
    maxTokens: Math.max(96, Math.min(settings.maxTokens, 220)),
    jsonMode: true,
  };
}

export function buildMobGirlBasePersonaCompletion(
  profile: MobGirlCandidateProfile,
  settings: AiSettings,
): AiCompletionRequest {
  return {
    system: promptText(settings, "l1.mob.persona", MOB_GIRL_PERSONA_SYSTEM_PROMPT),
    user: [
      "【动态路人资料】",
      `称呼：${profile.callName}`,
      `种族：${profile.species}`,
      `地域：${profile.region}`,
      `相遇地点：${profile.location}`,
      `随机种子：${profile.seed}`,
      "只返回 JSON。",
    ].join("\n"),
    temperature: settings.temperature,
    maxTokens: Math.max(80, Math.min(settings.maxTokens, 160)),
    jsonMode: true,
  };
}

export async function generateMobGirlProfile(
  profile: MobGirlCandidateProfile,
  settings: AiSettings,
  signal: AbortSignal,
): Promise<MobGirlVoiceProfile> {
  const provider = createOpenAiCompatibleProvider(settings);
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal.reason);
  if (signal.aborted) throw new Error("mob girl profile request cancelled");
  signal.addEventListener("abort", abort, { once: true });
  try {
    const raw = await provider.complete(
      buildMobGirlProfileCompletion(profile, settings),
      controller.signal,
    );
    return parseMobGirlProfile(raw, profile.callName);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function generateMobGirlBasePersona(
  profile: MobGirlCandidateProfile,
  settings: AiSettings,
  signal: AbortSignal,
): Promise<MobGirlBasePersona> {
  const provider = createOpenAiCompatibleProvider(settings);
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal.reason);
  if (signal.aborted) throw new Error("mob girl base persona request cancelled");
  signal.addEventListener("abort", abort, { once: true });
  try {
    const raw = await provider.complete(
      buildMobGirlBasePersonaCompletion(profile, settings),
      controller.signal,
    );
    return parseMobGirlBasePersona(raw);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
