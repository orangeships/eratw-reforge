/** Fixed craft guidance for daily L1 requests. These are editing
 * criteria, not a compulsory sequence of gestures or a lexical blacklist.
 *
 * H 场景有独立副本 `H_SCENE_BASE_WRITING_GUIDANCE`——两个 slot 的覆盖本来就分开存，
 * 这里只是把默认值也拆开，让 H 能独立演化而不牵动日常。 */
export const KOJO_WRITING_GUIDANCE = [
  "# 口上写法",
  "把这一轮当成真实人物正在生活，而不是完成一个固定格式的反应。",
  "",
  "可以只说一句，也可以自然展开几句；可以回应玩家，也可以由角色主动把注意力转到别的地方。",
  "",
  "台词、动作、场景和联想都只是表达人物的手段，需要时再用。不要为了完整而补动作，也不要为了表现人设而重复标志性设定。",
  "",
  "近期对话、background、style_examples 等都是素材，不是待完成的清单。",
].join("\n");

/** H 场景的通用写法下限：在所有 H 分支都插入，包括时停与无意识——那两个分支不插入
 *  轮换块（见 `h-scene-writing.ts`），所以 H 专属的通用规则必须落在这一块。
 *
 *  H 场景加入身体反应，并与本轮篇幅档位保持一致。 */
export const H_SCENE_BASE_WRITING_GUIDANCE = [
  "# 口上写法",
  "把这一轮当成真实人物正在生活，而不是完成一个固定格式的反应。",
  "",
  "按 generation.rhythm 的短、中、长档自然展开；可以回应玩家，也可以由角色主动把注意力转到别的地方。不要靠压缩句子里的信息量满足篇幅。",
  "",
  "台词、动作、身体反应、场景和联想都只是表达人物的手段，需要时再用。不要为了完整而补动作，也不要为了表现人设而重复标志性设定。",
  "",
  "近期对话、background、style_examples 等都是素材，不是待完成的清单。",
].join("\n");

/** Complete, authored rhythms: one entry is exposed, never a tone/length mix.
 * minTokens is internal eligibility metadata, not a prompt field. */
export const KOJO_RHYTHMS = [
  { minTokens: 0, text: "简短直接，约30–80字。接住当下最值得回应的意思，措辞干脆；一句成立就停，不必补动作或收尾。" },
  { minTokens: 0, text: "简短含蓄，约30–80字。把意思落在准确的措辞与分寸里，不必说尽，也不故意含糊或拖长停顿。" },
  { minTokens: 0, text: "日常随意，约30–80字。像相处中的一个普通片刻，顺口回应即可，不必显露鲜明情绪或寻找亮点。" },
  { minTokens: 512, text: "自然接续，约100–200字。顺着本轮新增的意思展开，让角色自己的关注参与；话题够了就停，不求完整收束。" },
  { minTokens: 512, text: "轻快灵活，约100–200字。措辞可以轻巧，交流留些转圜；合乎人物时容许一点玩笑，不必刻意逗趣或连续反问。" },
  { minTokens: 512, text: "具体从容，约100–200字。留意此刻真正影响互动的细节，让它自然参与交流；不为观察而罗列环境或身体动作。" },
  { minTokens: 512, text: "坦率清楚，约100–200字。让角色表达自己的判断与取舍，必要的意思说到位；不靠强硬语气或解释性独白强调性格。" },
  { minTokens: 512, text: "舒缓有分寸，约100–200字。给当下的意思一点停留空间，亲疏服从现有关系；安静也可以自然，不必煽情或故作冷淡。" },
  { minTokens: 1024, text: "充分展开，约220–360字。值得继续的交流可以多走一点，让关注、理解或话题自然发展；不为篇幅追加玩家行动或另造事件。" },
  { minTokens: 1024, text: "细致连贯，约220–360字。让本轮值得写的过程与人物选择清楚可感，节奏随内容松紧变化；意思已足就结束，不反复放大同一情绪。" },
] as const;

/** Time-stop and unconscious targets must not inherit active social cues. */
export const PASSIVE_KOJO_RHYTHMS = [
  { minTokens: 0, text: "简短客观，约30–80字。写清当前可观察的画面即可，不替目标补出意识、回应或主动选择。" },
  { minTokens: 0, text: "简短克制，约30–80字。留下一个确有依据的可见细节，不用心理解释或虚构变化填补安静。" },
  { minTokens: 512, text: "从容具体，约100–200字。按本轮事实写清可见过程，细节有必要才展开；不使目标主动参与，不推进后续事件。" },
  { minTokens: 512, text: "平实细致，约100–200字。让现场已有的细节保持连贯，不为层次另造动作，也不把静止写成有意识的等待。" },
] as const;

export function selectKojoRhythm(seed: number, maxTokens: number, passive: boolean): string {
  const pool = (passive ? PASSIVE_KOJO_RHYTHMS : KOJO_RHYTHMS)
    .filter((entry) => entry.minTokens <= maxTokens);
  // Mix high bits too: related request/history IDs can correlate in FNV's
  // low bits and otherwise skip half an even-sized pool.
  const mixed = (seed ^ (seed >>> 16)) >>> 0;
  return (pool[mixed % pool.length] ?? KOJO_RHYTHMS[0]).text;
}

export type HKojoLengthTier = "short" | "medium" | "long";

/** One length decision governs the H rhythm, craft cues and examples. Keep a
 * short response available when the player's token budget is small. */
export const H_KOJO_RHYTHMS: Readonly<Record<HKojoLengthTier, string>> = {
  short: "短篇，约150–230字。以一段自然的对话或一个连贯的动作片刻为主；只展开当前最有意义的一处，不压成高密度短句。第一或第三人称按本轮视角自然选择。",
  medium: "中篇，约250–380字。让对话与可见动作互相承接，细节随人物的注意和反应展开；句子有长短和停顿，不为凑字数增加新事件。",
  long: "长篇，约400–550字。给互动过程、动作后果与语言交锋充分空间，细节沿同一时刻自然推进；不要罗列反应，也不要为达到篇幅替玩家执行下一步。",
};

export function selectHKojoLengthTier(seed: number, maxTokens: number): HKojoLengthTier {
  const tiers: readonly HKojoLengthTier[] = maxTokens < 768
    ? ["short"]
    : maxTokens < 1024 ? ["short", "medium"] : ["short", "medium", "long"];
  const mixed = (seed ^ (seed >>> 16)) >>> 0;
  return tiers[mixed % tiers.length] ?? "short";
}

export function selectHKojoRhythm(tier: HKojoLengthTier, passive: boolean): string {
  if (!passive) return H_KOJO_RHYTHMS[tier];
  return `${H_KOJO_RHYTHMS[tier]} 目标无法主动回应；只写可观察到的状态，不补心理活动或主动行动。`;
}

export interface StyleExample {
  purpose: "voice" | "interaction_shape";
  source: "authored" | "authored_sample" | "kojo_card";
  text: string;
}

/** Length matching is applied only to H requests. A voice sample that is too
 * small or large for the selected turn is omitted rather than teaching a
 * contradictory expansion pattern. */
export function matchHKojoStyleExamples(examples: readonly StyleExample[], tier: HKojoLengthTier): StyleExample[] {
  const bounds = tier === "short" ? [0, 230] : tier === "medium" ? [80, 430] : [180, 1000];
  return examples.filter((example) => example.text.length >= bounds[0]! && example.text.length <= bounds[1]!).slice(0, 3);
}

/** Preserve complete resolved interactions before generic card quotations.
 * The caller's live-state/family-ranked samples retain their ranking. Bounds
 * apply to entire examples, so no clipped sentence becomes a writing model. */
export function selectKojoStyleExamples(input: {
  currentAuthored: readonly string[];
  liveSamples: readonly string[];
  cardSamples: readonly string[];
}): StyleExample[] {
  const examples: StyleExample[] = [];
  const seen = new Set<string>();
  let remaining = 2400; // 增加总字符预算，以支持至少 3 个样例
  function add(text: string, purpose: StyleExample["purpose"], source: StyleExample["source"]) {
    const cleaned = text.trim();
    const key = cleaned.replace(/\s+/g, " ");
    if (!cleaned || seen.has(key) || cleaned.length > 1000 || cleaned.length > remaining || examples.length >= 5) return;
    examples.push({ purpose, source, text: cleaned });
    seen.add(key);
    remaining -= cleaned.length;
  }
  // 优先添加当前作者口上（如果有）
  add(input.currentAuthored.map((line) => line.trim()).filter(Boolean).join("\n"), "interaction_shape", "authored");
  // 添加实时样本
  for (const sample of input.liveSamples) add(sample, "voice", "authored_sample");
  // 添加角色卡样本
  for (const sample of input.cardSamples) add(sample, "voice", "kojo_card");

  // 确保至少有 3 个样例（如果可能的话）
  // 如果样例不足 3 个，尝试从 cardSamples 中重复添加不同的样本
  if (examples.length < 3 && input.cardSamples.length > 0) {
    for (const sample of input.cardSamples) {
      if (examples.length >= 3) break;
      add(sample, "voice", "kojo_card");
    }
  }

  return examples;
}
