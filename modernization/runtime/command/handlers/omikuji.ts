/**
 * COMF434 おみくじ — the base upstream 幻存神签 flow.
 *
 * Upstream sources:
 *   - `ERB/コマンド関連/COMF/日常系/COMF434 おみくじ.ERB`
 *   - `ERB/イベント関連/FORTUNE.ERB`
 *   - `ERB/DLC/神签/神签.ERB` + `神签.ERH`
 *
 * The 129 slip texts are generated from the read-only upstream source into
 * `fortune-catalog.bundle.json`; this handler owns only deterministic state,
 * money, luck, prompts, and the base (non-optional-DLC) FORTUNE effects.
 * The optional upstream `更丰富的神签效果` DLC is intentionally not folded
 * into the base command because it is separately toggleable and explicitly
 * marked as under construction by the oracle.
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import type { PromptAnswer, PromptSpec } from "../prompt.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  TALENT_ID,
  advanceTimeTicks,
  getMasterBase,
} from "../../state/settlement.js";
import { buffBase } from "../../state/buff.js";
import { canAfford, grant, pay } from "../../state/money.js";
import { getTflag, setTflag, TFLAG_ID } from "../../state/tflag.js";
import { fortuneCharacterId, fortuneMaxNum, fortuneSlip } from "../../state/fortune.js";
import { pickOne } from "../prompt.js";

const COST_OMIKUJI = 200;
const TIME_COST = 2;
const OMIKUJI_SPOT = "神社:賽銭箱";

// Upstream also clears M_TFLAG:转运魔法CD here. The modern state schema has
// no owner or consumer for that master-only cooldown, so this remains an
// explicit no-op until the teleport-magic namespace is migrated.

/** FLAG:おみくじ (999) bits used by COMF434. */
const BIT_NOTICE_READ = 1 << 0;
const BIT_TODAY_DRAWN = 1 << 1;
const BIT_WINNING = 1 << 10;

/** The exact DATAFORM list in FORTUNE.ERB. */
export const FORTUNE_ADS = [
  "恭喜你中奖了！如果对今天的签不满意的话可以再抽一次（下次抽神签时会退款·对定期契约无效）",
  "博丽神社！超过守矢神社的，幻想乡最强的神社！",
  "现订阅《文文。新闻》还送美女记者特殊♥服务——（所谓特殊服务，指的是订阅者可以作为本报的独家新闻素材——主编S.Aya氏）",
  "雾雨牌魔女扫把——一把可以拿来打扫卫生的扫把（飞行功能暂未实装）",
  "博丽神社最新幻存神签服务——十分准！不准不要钱！（广告夸张说法，请以实际情况为准）",
  "FumoFumo～（下面画了一个巨大的Fumo）",
  "如果对结果有所不满请明天再试一次吧——请继续支持幻存神签！",
  "铃奈庵借书服务——知名作家稗……阿加莎克里斯Q新书绝赞公开中！",
  "骚灵乐团演唱会二手门票低价出售——详情请咨询二岩女士（售票地点：妖怪狸森林，卖假票的不是人）",
  "通缉：鬼人正邪 Dead or Alive 赏金：到时候再说",
  "鲵吞亭推出最新酒水超Zun啤酒，第二杯半价。",
  "博丽神社狛犬出租服务——时租金请到博丽神社与现任博丽巫女面谈。",
  "博丽神社能乐表演——主演团队：KKR 48（冉冉升起的新星！）",
  "博丽神社夏日祭典",
  "在结界内发现了神秘的眼镜啤酒男？！",
  "能力卡片——居家旅行必备的绝佳收藏品（详情请咨询AAA卡牌批发天弓姐）",
  "地灵殿火焰猫殡葬服务——死人安息，活人放心",
  "《东方非想天则》全乡争霸大赛将于不久后于玄武之泽举行",
  "支持东方M1漫才，这就是现在的你们要积累的善行。（四季映姬）",
  "永远亭烈小龙侦探事务所（侦探打烈车拳为正常现象，无需慌张）",
  "宫出口牌咒具，百年老字号。纸人形，稻草人形，蛊毒，让你的仇人如被怨灵缠身般痛苦！（对怨灵凭依可能导致的副作用概不负责）",
] as const;

const OMIKUJI_CHOICE = pickOne("抽御神签一次￥200，要怎么做呢？", [
  { id: 1, label: "抽一抽试试" },
  { id: 0, label: "还是算了" },
]);

const SELF_DECIDED_FORTUNE = pickOne("那么，就决定一下今天的运势吧～", [
  { id: 0, label: "大吉" },
  { id: 1, label: "吉" },
  { id: 2, label: "末吉" },
  { id: 3, label: "末凶" },
  { id: 4, label: "凶" },
  { id: 5, label: "大凶" },
  { id: 6, label: "不需要" },
]);

const GUESS_FORTUNE = pickOne("那么，就请猜测一下今天的运势吧？", [
  { id: 0, label: "吉" },
  { id: 1, label: "凶" },
]);

function sequence(answer: PromptAnswer | undefined): readonly (number | string)[] {
  if (answer?.kind === "pick_sequence") return answer.values;
  if (answer?.kind === "pick_one") return [answer.value];
  return [];
}

function firstVisitNotice(): string[] {
  return [
    "赛钱箱的一角贴着告示。",
    "┌─────────┐",
    "｜　　　　　　　　　｜",
    "｜幻想御神签　　　　｜",
    "｜　　为了幻想存续　｜",
    "｜　　　　　　　　　｜",
    "｜　　　　　　　　　｜",
    "｜　1日1回 200日元　｜",
    "｜　　请把钱放这里　｜",
    "｜　　　　　　　　　｜",
    "└─────────┘",
    "……",
    "只要把钱投进赛钱箱里就行了吧,所以说那个“为了幻想存续”是啥意思？",
    "至于神签本身好像是要从旁边的小台拿取……",
  ];
}

function drawPrelude(boxRoll: number): string[] {
  if (boxRoll === 0) {
    return [
      "在把钱投入赛钱箱后，%CALLNAME:MASTER%将手探向了一旁放御神签的台子……",
      "盒内的签塞得满满当当。",
      "%CALLNAME:MASTER%闭上眼睛，凭借着直觉从神签堆里拿了一张……",
    ];
  }
  if (boxRoll === 1) {
    return [
      "在把钱投入赛钱箱后，%CALLNAME:MASTER%将手探向了一旁放御神签的台子……",
      "盒内的签塞得满满当当。",
      "由于懒得思考，%CALLNAME:MASTER%随手拿起了签堆最上方的那一张神签……",
    ];
  }
  if (boxRoll <= 3) {
    return [
      "在把钱投入赛钱箱后，%CALLNAME:MASTER%将手探向了一旁放御神签的台子……",
      "盒内的签零零散散地摆放着。",
      "%CALLNAME:MASTER%闭上眼睛，凭借着直觉从神签堆里拿了一张……",
    ];
  }
  if (boxRoll <= 5) {
    return [
      "在把钱投入赛钱箱后，%CALLNAME:MASTER%将手探向了一旁放御神签的台子……",
      "盒内的签零零散散地摆放着。",
      "由于懒得思考，%CALLNAME:MASTER%随手拿起了签堆最上方的那一张神签……",
    ];
  }
  if (boxRoll <= 14) {
    return [
      "在把钱投入赛钱箱后，%CALLNAME:MASTER%将手探向了一旁放御神签的台子……",
      "盒内只剩下了零星一两张神签",
      "%CALLNAME:MASTER%犹豫不决地从这仅剩的签里拿了一张……",
    ];
  }
  return [
    "在把钱投入赛钱箱后，%CALLNAME:MASTER%将手探向了一旁放御神签的台子……",
    "盒内只剩下了最后一张神签",
    "%CALLNAME:MASTER%……好吧%CALLNAME:MASTER%好像没得选",
  ];
}

function replaceMasterName(text: string, ctx: CommandContext): string {
  const name = ctx.state.master.callName || "你";
  return text.replaceAll("%CALLNAME:MASTER%", name);
}

/** Two-argument ERA RAND uses an exclusive upper bound, like RAND:n. */
function randomRange(ctx: CommandContext, min: number, maxExclusive: number): number {
  return min + ctx.rng.int(Math.max(1, maxExclusive - min));
}

function checkOmikujiEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const master = ctx.state.master;
  const omikuji = ctx.state.flagStore[FLAG_ID.おみくじ] ?? 0;
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法抽签。" } };
  }
  if (master.location !== OMIKUJI_SPOT) {
    return { ok: false, reason: { kind: "precondition", message: "只有在神社的赛钱箱前才能抽御神签。" } };
  }
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "气力不足，无法抽签。" } };
  }
  if ((omikuji & BIT_TODAY_DRAWN) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "抽御神签是1天1次。" } };
  }
  return { ok: true };
}

/** Which later FORTUNE branch needs a second player choice? */
function previewInteractiveBranch(ctx: CommandContext): number | null {
  ctx.rng.int(18); // COMF434's box state roll.
  const slip = ctx.rng.int(fortuneMaxNum());
  ctx.rng.int(FORTUNE_ADS.length); // FORTUNE's DATAFORM selection precedes SELECTCASE.
  return slip === 68 || slip === 108 ? slip : null;
}

function fortunePrompt(ctx: CommandContext): PromptSpec | null {
  if (!canAfford(ctx.state, COST_OMIKUJI)) return null;
  const values = sequence(ctx.promptAnswer);
  if (values.length === 0) return OMIKUJI_CHOICE;
  if (Number(values[0]) !== 1) return null;
  const branch = previewInteractiveBranch(ctx);
  if (branch === 68) return SELF_DECIDED_FORTUNE;
  if (branch === 108) return GUESS_FORTUNE;
  return null;
}

function setMoodMiracle(next: ReturnType<typeof cloneGameState>): void {
  for (const slot of Object.values(next.charas)) {
    slot.state.TALENT[TALENT_ID.心情] = 1;
    slot.state.BASE[BASE_ID.憤怒] = 0;
  }
  next.master.state.BASE[BASE_ID.体力] = next.master.state.MAXBASE[BASE_ID.体力] ?? 0;
  next.master.state.BASE[BASE_ID.気力] = next.master.state.MAXBASE[BASE_ID.気力] ?? 0;
  next.master.state.BASE[BASE_ID.精力] = next.master.state.MAXBASE[BASE_ID.精力] ?? 0;
  next.master.state.BASE[BASE_ID.TSP] = next.master.state.MAXBASE[BASE_ID.TSP] ?? 0;
  next.master.state.BASE[BASE_ID.酒気] = 0;
}

function applyFortuneBranch(
  next: ReturnType<typeof cloneGameState>,
  ctx: CommandContext,
  slip: number,
  choice: number | string | undefined,
): string[] {
  const lines: string[] = [];
  const setLuck = (value: number) => setTflag(next, TFLAG_ID.幸運補正, value);

  // Explicit SETs from FORTUNE.ERB's normal 129-slip table.
  const plusFive = new Set([6, 12, 23, 24, 34, 36, 41, 42, 44, 57, 69, 70, 73, 93, 94, 98, 103, 104, 105, 106, 109, 113, 119, 127]);
  const zero = new Set([3, 118]);
  const plusThree = new Set([1, 5, 9, 13, 14, 15, 17, 18, 26, 31, 38, 39, 43, 49, 53, 54, 55, 58, 60, 61, 64, 74, 78, 79, 82, 83, 84, 92, 95, 96, 100, 101, 102, 107, 114, 117, 120, 121, 122, 125]);
  const plusOne = new Set([4, 11, 16, 21, 29, 33, 35, 47, 62, 63, 65, 67, 71, 72, 75, 76, 91, 115, 124, 126]);
  const minusOne = new Set([22, 30, 45, 66, 110]);
  const minusThree = new Set([0, 10, 20, 25, 27, 32, 48, 59, 80, 81, 86, 97, 99]);
  const minusFive = new Set([2, 8, 28, 37, 46, 50, 56, 77, 87, 89, 90, 111, 116, 123]);

  if (plusFive.has(slip)) setLuck(5);
  else if (zero.has(slip)) setLuck(0);
  else if (plusThree.has(slip)) setLuck(3);
  else if (plusOne.has(slip)) setLuck(1);
  else if (minusOne.has(slip)) setLuck(-1);
  else if (minusThree.has(slip)) setLuck(-3);
  else if (minusFive.has(slip)) setLuck(-5);
  else {
    switch (slip) {
      case 7:
      case 19:
      case 85:
      case 112:
        setLuck(ctx.rng.int(2) === 1 ? 3 : -3);
        break;
      case 40:
        setMoodMiracle(next);
        lines.push("你感觉自己似乎受到了守矢神社风祝的奇迹护佑……", "情绪也变得格外平稳，身体似乎轻了不少。");
        break;
      case 51:
        setLuck(-5);
        buffBase(next.master, BASE_ID.体力, 50);
        buffBase(next.master, BASE_ID.気力, 50);
        buffBase(next.master, BASE_ID.精力, 50);
        buffBase(next.master, BASE_ID.TSP, 5);
        lines.push("健康一栏发出了象征着厄运的暗红光，但身体暂时得到了强化。");
        break;
      case 52: {
        const positive = ctx.rng.int(2) === 1;
        const magnitude = ctx.rng.int(5);
        setLuck(positive ? magnitude : -magnitude);
        break;
      }
      case 68: {
        const selected = typeof choice === "number" ? choice : Number(choice);
        const luck = [5, 3, 1, -1, -3, -5, 0][selected];
        if (luck === undefined) return ["没有决定今天的运势。"];
        setLuck(luck);
        lines.push(["果然只要脑子没问题的话就会选这个呢……", "嘛，也算是妥当的结果呢……", "只要是吉就很不错……", "这是为了所谓的运气守恒定律吗？", "明明可以选择大吉却非要选择凶……", "大凶就是大凶而已……", "你这是，懒得决定了吗……？"][selected]!);
        break;
      }
      case 88: {
        const result = ctx.rng.int(3);
        setLuck([3, -3, -5][result]!);
        lines.push(["在地球之赫卡提亚的影响下，运势变成了“吉”。", "在月球之赫卡提亚的影响下，运势变成了“凶”。", "在异界之赫卡提亚的影响下，运势变成了“大凶”。"][result]!);
        break;
      }
      case 108: {
        const guess = Number(choice);
        const correct = ctx.rng.int(2) === 1;
        const guessedGood = guess === 0;
        const good = correct ? guessedGood : !guessedGood;
        setLuck(good ? 3 : -3);
        lines.push(correct ? "猜对了！" : "猜错了！", "不过无论猜对猜错，也不会改变运势本身就是了……");
        break;
      }
      case 128:
        setLuck(3);
        next.master.state.EXP[EXP_ID.清掃経験] = (next.master.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
        lines.push("为什么这张签上会写着你的名字……");
        break;
      default:
        // 40 is the only intentional neutral branch without a TFLAG write.
        break;
    }
  }
  return lines;
}

function dailyFortuneScore(ctx: CommandContext, luck: number): number {
  if (luck <= -5) return randomRange(ctx, 0, 480);
  if (luck <= -3) return randomRange(ctx, 100, 520);
  if (luck <= -1) return randomRange(ctx, 200, 520);
  if (luck <= 0) return randomRange(ctx, 480, 520);
  if (luck <= 1) return randomRange(ctx, 500, 800);
  if (luck <= 3) return randomRange(ctx, 700, 980);
  return randomRange(ctx, 700, 1000);
}

function dailyFortuneLabel(score: number): string {
  if (score <= 199) return "差";
  if (score <= 479) return "较差";
  if (score <= 519) return "平";
  if (score <= 799) return "较好";
  if (score <= 979) return "好";
  return "非常幸运！";
}

function refundLines(roll: number): string[] {
  if (roll <= 4) {
    return [
      "神签的最后写着奇怪的字：",
      "┌─・─剪切线─・─┐",
      "｜　幻想乡共通商品券　｜",
      "｜　　　　　200日元　｜",
      "｜　可以找零　无使用期限　｜",
      "仔细想想这东西就是所谓的代金券吧？",
    ];
  }
  if (roll <= 6) {
    return ["仔细一看，神签的下面似乎还粘着什么……", "是昭和年间发行的“里白”200日元纸币。"];
  }
  if (roll <= 11) return ["叮铃铛啷♪　○彡", "转身望去，赛钱箱里飞出了应该是刚才投进去的钱。"];
  if (roll <= 13) return ["神明大人似乎赐予了你一张和神签叠放在一起的200日元纸钞。", "满怀感激地将纸币拿走了。"];
  return ["某种物品突然从天而降，刚好砸到了你的头上。", "低头一看，是刚才投入赛钱箱的钱。"];
}

export const omikujiHandlerEntry: HandlerEntry = {
  commandNo: 434,
  gateStatus: "complete",
  stagedPrompt: true,
  prompt: fortunePrompt,
  execCheck: (ctx) => {
    const result = checkOmikujiEligible(ctx);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const previous = next.flagStore[FLAG_ID.おみくじ] ?? 0;
    const notice = (previous & BIT_NOTICE_READ) === 0 ? firstVisitNotice() : [];
    next.flagStore[FLAG_ID.おみくじ] = previous | BIT_NOTICE_READ;

    if (!canAfford(next, COST_OMIKUJI)) {
      return {
        state: next,
        events: [
          ...notice,
          "望了望钱包可是没带够钱。",
          "如果不付钱的话……算了，那样肯定不灵验的。",
        ].map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text: replaceMasterName(text, ctx) })),
        outcome: "noop" as const,
        failReason: { kind: "precondition" as const, message: "金钱不足" },
      };
    }

    const values = sequence(ctx.promptAnswer);
    const drawChoice = values.length === 0 ? null : Number(values[0]);
    if (drawChoice === null) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "请先选择是否抽御神签。" }],
        outcome: "blocked" as const,
        failReason: { kind: "precondition" as const, message: "等待御神签选择" },
      };
    }
    if (drawChoice !== 1) {
      return {
        state: next,
        events: [...notice, "收回了准备投钱的手。"].map((text) => ({
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: replaceMasterName(text, ctx),
        })),
        outcome: "noop" as const,
      };
    }

    pay(next, COST_OMIKUJI);
    advanceTimeTicks(next, TIME_COST);
    next.flagStore[FLAG_ID.おみくじ] = (next.flagStore[FLAG_ID.おみくじ] ?? 0) | BIT_TODAY_DRAWN;

    const boxRoll = ctx.rng.int(18);
    const slipNumber = ctx.rng.int(fortuneMaxNum()) + 1;
    const adIndex = ctx.rng.int(FORTUNE_ADS.length);
    const interactiveChoice = values[1];
    // A fresh command starts with a neutral fortune correction. Individual
    // FORTUNE cases then overwrite it exactly like the upstream SELECTCASE.
    setTflag(next, TFLAG_ID.幸運補正, 0);
    const branchLines = applyFortuneBranch(next, ctx, slipNumber - 1, interactiveChoice);
    const luck = getTflag(next, TFLAG_ID.幸運補正);
    const score = dailyFortuneScore(ctx, luck);
    next.master.state.CFLAG[CFLAG_ID.今日の運勢] = score;

    // FORTUNE's DATAFORM result 0 is the one-time scratch-ticket winner;
    // a 神簽契約 explicitly disables the refund.
    if (adIndex === 0 && (next.flagStore[FLAG_ID.神簽契約] ?? 0) === 0) {
      next.flagStore[FLAG_ID.おみくじ] |= BIT_WINNING;
    }
    const won = (next.flagStore[FLAG_ID.おみくじ] & BIT_WINNING) !== 0;
    const refundRoll = won ? ctx.rng.int(15) : null;
    if (won) {
      grant(next, COST_OMIKUJI);
      next.flagStore[FLAG_ID.おみくじ] &= ~BIT_WINNING;
    }

    const slip = fortuneSlip(slipNumber);
    const slipLines = slip?.lines.length
      ? slip.lines
      : [`第${slipNumber}签`, `签文资料未载入（对应角色编号 ${fortuneCharacterId(slipNumber)}）。`];
    const resultTexts = [
      ...notice,
      ...drawPrelude(boxRoll),
      "看了看拿到的幻存神签的内容。",
      "……",
      `今日的幻存神签：第${slipNumber}签。`,
      ...slipLines,
      `签后广告时间：${FORTUNE_ADS[adIndex] ?? FORTUNE_ADS[0]}`,
      ...branchLines,
      `今日的运势：${dailyFortuneLabel(score)}（${score}）。`,
      "再提醒一句：根据这个去行动吧",
      ...(won ? ["……", ...refundLines(refundRoll ?? 0)] : []),
    ];
    const events = resultTexts.map((text) => {
      const tone = text.startsWith("签后广告时间")
        ? "notice" as const
        : luck > 0
          ? "auspicious" as const
          : luck < 0
            ? "ominous" as const
            : "plain" as const;
      return {
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: replaceMasterName(text, ctx),
        surface: "omikuji" as const,
        tone,
      };
    });

    return { state: next, events, outcome: "ok" as const };
  },
};
