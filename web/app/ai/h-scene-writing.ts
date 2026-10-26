import type { HKojoLengthTier } from "./kojo-writing.js";

/** H 场景的描写侧重项，每轮按 seed 抽取与篇幅相称的项。
 *
 * 与 `kojo-writing.ts` 的 `KOJO_RHYTHMS` 同形：`as const` 池 + 纯函数选择器，
 * 同一份 prepared request 重放得到同一份文本。
 *
 * **这里不设 `minTokens`。** `KOJO_RHYTHMS` 的 `minTokens` 语义是「这条本身规定了
 * 输出多长」；技法项不规定输出长度（长度归 `generation.rhythm`），同名不同义是维护
 * 陷阱。`maxTokens` 只用作抽取条数的软上限。
 *
 * **本块归代码所有，不是可编辑 slot**——与 `h-scene-authorization.ts` 同级：玩家可以
 * 改口上文字，但不应该能取消轮换。取消 slot 是本模块存在的前提，改动时不要把
 * `formatHSceneWriting` 重新接回 `promptText`。
 *
 * 技法按**不重叠的轴**编写（感官通道 / 机制 / 内面 / 控制），任意 2–3 项组合都兼容。
 * 新增项时保持这一点，否则同轮抽到的两项会互相抵消。
 *
 * 已排除的轴：**句法节奏镜像**（TheAtelierV4 `➕Visceral Smut` Rule 5、WritersBlock
 * `Hentai Author` 的 "Varied length"）。它与 `player-facing-prose.ts` 的碎片短句禁令
 * 正面冲突，不要再加回来。 */

export interface HSceneTechnique {
  /** 稳定身份。测试按 id 断言去重与覆盖，不要用文本比对。 */
  readonly id: string;
  readonly directive: string;
  readonly bad: string;
  readonly good: string;
}

/** 每轮都插入的骨架：标题、三条边界、以及轮换项的优先级声明。
 *  标题必须留在这一块里——`context.test.ts` 用 `# H 场景写法` 做存在与排序锚点。 */
export const H_SCENE_WRITING_CORE = [
  "# H 场景写法",
  "场景仍在进行时，围绕本轮已结算的行为或仍在持续的联系，选一处有依据的现场细节展开，让读者感到这一刻正在发生；本轮没有新变化时，承接已有状态和交流，不为写法另造转折。",
  "",
  "让台词、停顿和身体反应随人物自然交错，每轮聚焦一个表现重心，篇幅服从 generation.rhythm；亲密、犹疑、抗拒或疲惫的表达从人物当下的投入生长，不套固定的情欲声调或流程。",
  "",
  "若 runtime.scene_context.event_phase.progress=ended 已标明退出，承接实际结果和余韵，不强行延长正在进行的动作。",
  "",
  "以下侧重项每轮随机给出若干条，只作本轮描写的注意方向，不是必须逐条完成的清单。它们与本轮事实、角色卡或关系冲突时以事实为准；不适用的直接忽略。",
].join("\n");

/** 10 项技法。对照例是整块最贵的部分（每轮 H 都作为输入付费），保持单行。 */
export const H_SCENE_WRITING_TECHNIQUES = [
  {
    id: "fluid",
    directive: "体液和湿度是有状态的物理对象——有位移、有量、会停留。写它们此刻在哪里、怎么变化。",
    bad: "她下面已经湿了。",
    good: "他退出来的时候带出一小股，顺着往下淌了一指就断了，剩下的那点顺着她的腿根蹭到床单上。",
  },
  {
    id: "sound",
    directive: "写具体的声音，不用「呻吟」概括。发声随程度变化：完整的词 → 碎片 → 只剩声音 → 又拼回带字的呜咽。",
    bad: "她发出甜美的呻吟。",
    good: "他撞到底的时候她的声音断在中间，只剩一个没成形的气音顶在喉咙口。第二下她咬住了，手指抓紧他后背，第三下才从牙缝里漏出半个带字的音。",
  },
  {
    id: "smell",
    directive: "让气味和体温可感：汗、体温、皮肤上的味道、呼吸的温度。",
    bad: "房间里弥漫着暧昧的气息。",
    good: "他的鼻尖贴在她耳后，呼出来的气是烫的，烫到耳廓发麻。汗味从他鬓角那边压过来，和她自己身上那股温吞的体味搅在一起，贴得够近才闻得清哪一层是谁的。",
  },
  {
    id: "anatomy",
    directive: "不写尺寸，写相互作用：贴紧、撑开、退开时的落差、某一处被顶到的感觉。用中文里自然的说法。",
    bad: "他很大，她觉得很涨。",
    good: "他退到只剩头顶抵着那道口，停了一下，又慢慢压回去。里面先是一圈被撑开的紧，紧到发麻，等他压到底才松开，松开的瞬间她的脚趾整个蜷了起来。",
  },
  {
    id: "consequence",
    directive: "每个动作都要产生一个可观察的后果，让后果带动下一个动作，不要写成动作的并列清单。",
    bad: "他动了动。她叫了一声。他又动了动。",
    good: "他往里压，她的腰跟着塌下去，膝盖不自觉地并拢夹住他的胯。角度因此变了，抵到的地方从前面滑到更深的一处，他停下来，等她的呼吸自己落回去。",
  },
  {
    id: "interior",
    directive: "被淹没时内心会缩成一件事、反复回到同一处。写那种循环，不是有条理的感想。",
    bad: "她脑子里很乱，什么都想不清楚。",
    good: "外面的声音都还在，她却只剩一个念头在打转：再来一次，还没有到。她试着想别的，一想就散了，过两秒又绕回这上面来。",
  },
  {
    id: "weight",
    directive: "让动作本身带情绪——抓握里的急、停顿里的忍、避开视线的羞。不要直接命名情绪，让动作说明。",
    bad: "他充满占有欲地抓住她的腰。",
    good: "他捏着她腰侧的那只手忽然用了力，指节压进肉里，随即松开几分，像怕留下印子。松开之后那只手没有拿开，停在原处，掌心的温度还留着。",
  },
  {
    id: "repeat",
    directive: "同一个部位、同一种反应，一轮之内不写第二次。换一个动词、换一个感官，或换成对方的。",
    bad: "同一处反复描写，同一个动词反复用。",
    good: "上一句还在他腰侧收着的那只手，这回挪到了膝弯。他扣住那里的时候她的脚背绷了一下，脚趾在床单上抓出声音来。",
  },
  {
    id: "identity",
    directive: "强度上升时人物仍是自己。措辞、习惯、脾气不因为露骨而改变；安静的人不会突然变得很会叫。",
    bad: "她说着从没说过的粗话。",
    good: "她一直用那种对上司说话的调子，句子还是完整的敬语。越到后面那个调子越托不住，最后几个字散在喉咙里，一个词说到一半就断了，她干脆闭了嘴，把脸埋进枕头里。",
  },
  {
    id: "aftermath",
    directive: "事后要落地：酸软、残留、气味、还没平下来的呼吸、忽然的安静或一句不相关的话。",
    bad: "他们一起到达高潮，然后相拥而眠。",
    good: "她还在喘，胸口一下一下地起伏，手搭在他背上没有拿开，也没有力气改成别的姿势。过了很久她才想起该拉被子，手臂抬到一半又落下去，最后是用脚把被角勾过来的。",
  },
] as const satisfies readonly HSceneTechnique[];

/** 输出预算低于这个值时只抽 2 项：短轮次不需要 3 条侧重。 */
const FULL_COUNT_MIN_TOKENS = 512;
const MIN_COUNT = 2;

/** 按 seed 抽 2–3 项，一轮内不重复。
 *
 * count-first + 部分 Fisher–Yates，而不是「抽 3 丢 1」——条数是可断言的输出，也让
 * 预算以后能影响条数而不必动洗牌。Fisher–Yates 天然去重，不用「抽到重复就重试」的
 * 循环（那在池子变小时会变成死循环）。
 *
 * 相邻回合抽到部分重叠项是设计内结果（从 10 项抽 2–3 项，重叠是常态），不是缺陷。
 * seed 带上每回合都变的 `requestId` 即可；**不要**加防重复窗口——那是有状态，会破坏
 * 「同一份 prepared request 重放得到同一份文本」的确定性契约。 */
export function selectHSceneWritingEntries(
  seed: number,
  maxTokens: number,
  tier: HKojoLengthTier = "long",
): readonly HSceneTechnique[] {
  const allowed = tier === "short" ? ["weight", "identity"]
    : tier === "medium" ? ["weight", "identity", "sound", "consequence"] : null;
  const pool: readonly HSceneTechnique[] = allowed
    ? H_SCENE_WRITING_TECHNIQUES.filter((entry) => allowed.includes(entry.id))
    : H_SCENE_WRITING_TECHNIQUES;
  const mixed = (seed ^ (seed >>> 16)) >>> 0;
  // 条数位与洗牌种子取自 mixed 的不同位置。同一位会让「抽几项」与「抽到哪几项」相关。
  const target = tier === "short" ? 1
    : tier === "medium" ? 2
    : maxTokens >= FULL_COUNT_MIN_TOKENS ? MIN_COUNT + ((mixed >>> 7) & 1) : MIN_COUNT;
  const count = Math.min(target, pool.length);
  const indices = pool.map((_, index) => index);
  let state = (mixed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < count; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // 取高位：LCG 的低位周期短，对小的 (n - i) 取模会有偏。
    const j = i + ((state >>> 16) % (indices.length - i));
    const swap = indices[i] as number;
    indices[i] = indices[j] as number;
    indices[j] = swap;
  }
  return indices.slice(0, count).map((index) => pool[index] as HSceneTechnique);
}

/** 骨架 + 选中项拼成一块。池子为空时仍返回骨架，标题不会消失。 */
export function formatHSceneWriting(entries: readonly HSceneTechnique[]): string {
  const blocks = entries.map((entry) =>
    [`- ${entry.directive}`, `  反：${entry.bad}`, `  正：${entry.good}`].join("\n"));
  return [H_SCENE_WRITING_CORE, ...blocks].join("\n\n");
}

/** 生产调用点用这个：一次拿到可插入 system 的完整文本。 */
export function buildHSceneWriting(seed: number, maxTokens: number, tier: HKojoLengthTier = "long"): string {
  return formatHSceneWriting(selectHSceneWritingEntries(seed, maxTokens, tier));
}
