/**
 * 肉体情報 (PAGE 4 身体情报) — the nine organ sections, transcribed from
 * `ERB/BODY_INFO/BODY_INFO.ERB` + the MASTER-only `@ちん遍歴`
 * (PRINT_STATE2.ERB:391).
 *
 * Layout (PRINT_STATE2.ERB:361-389):
 *   表 (front): BODY → FINGER → B → C
 *   里 (back) : HEART → M → A → V → W (+ ちん遍歴 when MASTER)
 *
 * Every line is gate-transcribed 1:1: talent prose gates, EXP counters
 * (`SIF EXP:x` — zero hides the line), ABL 技巧/感度/中毒 ladders, 履历
 * (処女/キス未経験/記念日 CFLAGs), 积攒度 hints. Sections whose upstream
 * gates read state the modern runtime never writes (妊娠/生理周期/EX 精液残量
 * /CSTR 喪失履歴 prose) evaluate false with 0-defaults and simply don't
 * render — faithful (they are exactly the lines a fresh save doesn't show).
 *
 * Tones map the upstream SETCOLOR ladder: red > pink > orange > yellow >
 * green > aqua > plain; cream = flavor prose; purple = hint prose.
 */

import type { CharaSlot, GameState } from "./game-state.js";
import { ABL_ID, BASE_ID, CFLAG_ID, EXP_ID, TALENT_ID } from "./settlement.js";

export type BodyTone = "red" | "pink" | "orange" | "yellow" | "green" | "aqua" | "cream" | "purple" | "plain";

export interface BodyLine {
  text: string;
  tone: BodyTone;
}

export interface BodySection {
  title: string;
  lines: BodyLine[];
}

export interface BodyInfo {
  front: BodySection[];
  back: BodySection[];
}

const TONE_LADDER_7: ReadonlyArray<BodyTone> = ["plain", "aqua", "green", "yellow", "orange", "pink", "red"];

function line(text: string, tone: BodyTone = "plain"): BodyLine {
  return { text, tone };
}

/** 技巧 ladder (指/舌/胸/膣/肛門 share the tier→tone shape). */
function skillLadder(value: number, texts: Readonly<Record<number, string>>): BodyLine {
  const tier = value >= 6 ? 6 : Math.max(0, Math.min(5, value));
  return line(texts[tier]!, TONE_LADDER_7[tier]!);
}

/** 感度 ladder (≥16/≥12/≥8/≥4/2/1/0). */
function senseLadder(value: number, texts: readonly [string, string, string, string, string, string, string]): BodyLine {
  if (value >= 16) return line(texts[0], "red");
  if (value >= 12) return line(texts[1], "pink");
  if (value >= 8) return line(texts[2], "orange");
  if (value >= 4) return line(texts[3], "yellow");
  if (value === 2) return line(texts[4], "green");
  if (value === 1) return line(texts[5], "aqua");
  return line(texts[6], "plain");
}

/** 中毒 ladder (≥16/≥12/≥8/≥4/2/1/0). */
const addictionLadder = senseLadder;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function sectionM(state: GameState, slot: CharaSlot, masterName: string): BodySection {
  const st = slot.state;
  const lines: BodyLine[] = [];
  const t = (id: number) => st.TALENT[id] ?? 0;
  const e = (id: number) => st.EXP[id] ?? 0;
  const c = (id: number) => st.CFLAG[id] ?? 0;
  const a = (id: number) => st.ABL[id] ?? 0;

  if ((c(CFLAG_ID.继承) >> 6) & 1) lines.push(line(`${masterName}非常清楚该如何让其最有感觉`, "cream"));
  if (t(TALENT_ID.精愛味覚)) lines.push(line("吼啦❤被精液彻底浸润过的身体❤已经…回不去了❤…", "cream"));
  if (t(TALENT_ID.舌使い)) lines.push(line("非同一般的灵活舌头", "cream"));
  if (t(TALENT_ID.猫舌)) lines.push(line("是猫一般的带刺的舌头", "cream"));
  if (t(TALENT_ID.接吻魔)) lines.push(line("开发完成的性感嘴唇❤", "cream"));

  if (e(EXP_ID.接吻経験)) lines.push(line(`接吻过${e(EXP_ID.接吻経験)}次`));
  if (e(EXP_ID.口淫経験)) lines.push(line(`口淫过${e(EXP_ID.口淫経験)}次`));
  if (c(CFLAG_ID.累計精飲)) lines.push(line(`喝过${c(CFLAG_ID.累計精飲)}ml精液`));
  if (e(EXP_ID.Ｍ絶頂経験)) lines.push(line(`用嘴高潮过${e(EXP_ID.Ｍ絶頂経験)}次`));

  lines.push(
    skillLadder(a(ABL_ID.舌), {
      6: "【巅峰】会当凌绝顶❤就用这柔软的舌头让你绝顶吧",
      5: "【凶器】舌头的灵活程度即便是幻想乡也很难找到更厉害的了",
      4: "【大师】舌的技巧已经可以开班授徒了",
      3: "【达人】舌头的使用技巧已经变得十分上道了",
      2: "【熟练】舌头的使用开始熟练了",
      1: "【生疏】接下来的路还长着呢",
      0: "【笨拙】还是笨拙的舌头呢",
    }),
  );
  lines.push(
    senseLadder(a(ABL_ID.Ｍ感覚), [
      "【敏感度远超常人】日常都在不自觉的发痒，不管是接吻还是侍奉只要刺激到都会翻着白眼强烈高潮",
      "【极度敏感】即便本身的设计并不是用来寻欢作乐的，但如今可说这里已经变成完美的性器官了",
      "【感度拔群】就连日常咀嚼与吞咽也会产生快感，烦恼着如何正常生活",
      "【十分敏感】经过开发，即便只用嘴也能舒服的高潮",
      "【敏感】口部已经可以产生明显的快感了，继续调教下去这里也能成为合格的性器。",
      "【素质】嘴唇很容易受到刺激，很有调教价值",
      "【未开发】即便被爱抚也没什么特别的感觉",
    ]),
  );

  // 初吻履历
  const kissless = t(TALENT_ID.キス未経験);
  const firstKiss = state.firstKissHistory?.[slot.charaNum];
  if (kissless > 0) lines.push(line("初吻履历：还保有初吻", "yellow"));
  else if (kissless < 0) lines.push(line("初吻履历：还保有初吻（虽然是这样认为的、但其实……）", "pink"));
  else if (firstKiss) {
    const partner = firstKiss.partner.kind === "anonymous"
      ? firstKiss.partner.label
      : firstKiss.partner.charaNum === 0
        ? masterName
        : state.charas[firstKiss.partner.charaNum]?.callName ?? `#${firstKiss.partner.charaNum}`;
    lines.push(line(
      `初吻履历：第${firstKiss.dayIndex}日，在${firstKiss.location}被${partner}夺走了初吻`,
      "pink",
    ));
  }
  else if (c(CFLAG_ID.初吻喪失記念日)) lines.push(line(`初吻履历：在第${c(CFLAG_ID.初吻喪失記念日)}日失去了初吻`, "pink"));
  else if (slot.charaNum !== 0) lines.push(line(`初吻履历：在和${masterName}相遇之前就失去了`, "aqua"));

  lines.push(
    addictionLadder(a(ABL_ID.精液中毒), [
      "如今只要喝下精液❤、身体就会立刻发情❤",
      `呐…已经很久没有尝到那个味道了…你❤的❤味❤道❤`,
      "嗅嗅…你的…色色的味道很重哦❤都闻到了❤～",
      "啊～已经按你说的都喝下去啦…真是的❤…",
      "吞下去什么的…办不到啦…",
      "嘴吧里黏糊糊的感觉很恶心！",
      "精液这种东西怎么可能含进嘴里？！恶",
    ]),
  );
  return { title: "【口】", lines };
}

function sectionB(slot: CharaSlot, masterName: string): BodySection {
  const st = slot.state;
  const lines: BodyLine[] = [];
  const t = (id: number) => st.TALENT[id] ?? 0;
  const e = (id: number) => st.EXP[id] ?? 0;
  const a = (id: number) => st.ABL[id] ?? 0;

  if ((st.CFLAG[CFLAG_ID.继承] ?? 0) >> 5 & 1) lines.push(line(`${masterName}非常清楚该如何让其最有感觉`, "cream"));
  const cup = t(TALENT_ID.胸围);
  // Upstream `IF TALENT:胸围` — the ==0 branch ("普普通通的大小") is dead code
  // (the outer IF already filtered 0); only nonzero sizes print.
  if (cup !== 0) {
    const cupText =
      cup === 2 ? "能把人晃晕的爆乳" : cup === 1 ? "手掌抓不住的巨乳" : cup === -1 ? "有些可爱的贫乳" : "……绝壁";
    lines.push(line(cupText, "cream"));
  }
  if (t(TALENT_ID.淫乳)) {
    const noun = cup < 0 ? "胸" : cup > 0 ? "巨乳" : "乳房";
    lines.push(line(`被彻底调教过的${noun}稍微碰到、全身就会瘫软下来。自己都没发现，偶尔会无意识的揉搓起来`, "cream"));
  }
  if (t(TALENT_ID.母乳体質)) {
    lines.push(
      line(e(EXP_ID.噴乳経験) >= 100 ? "满满甘甜的母乳只要稍微刺激就会喷射" : "揉捏的话就会轻易渗出甘甜的母乳吧", "cream"),
    );
  }

  if (e(EXP_ID.噴乳経験)) lines.push(line(`喷过${e(EXP_ID.噴乳経験)}次乳汁`));
  if (e(EXP_ID.乳交経験)) lines.push(line(`乳交${e(EXP_ID.乳交経験)}次`));
  if (e(EXP_ID.Ｂ絶頂経験)) lines.push(line(`用胸部高潮过${e(EXP_ID.Ｂ絶頂経験)}次`));

  lines.push(
    skillLadder(a(ABL_ID.胸), {
      6: "【巅峰】欧派赛高！",
      5: "【凶器】使用胸部的技巧即便是幻想乡也很难找到更厉害的了",
      4: "【大师】胸的榨精技巧已经可以开班授徒了",
      3: "【达人】胸部的使用技巧已经变得十分上道了",
      2: "【熟练】胸部的使用开始熟练了",
      1: "【生疏】接下来的路还长着呢",
      0: "【笨拙】胸部？该…怎样做呢？",
    }),
  );
  lines.push(
    senseLadder(a(ABL_ID.Ｂ感覚), [
      "【敏感度远超常人】任何时候只要掐住乳头，就会吐着舌头强烈高潮",
      "【极度敏感】如今要是裸露着乳房，即便是微风吹过的刺激也能产生快感了",
      "【感度拔群】就连走路时的衣服摩擦都会兴奋起来，时常能看到乳头挺立着",
      "【十分敏感】发情时胸部会胀痛着刺激大脑，如果用力揉就会舒服的高潮",
      "【敏感】胸部已经可以产生明显的快感了，利用优秀的技巧，可以只靠胸部达到高潮",
      "【素质】只要有技巧的爱抚，乳头就会挺起，很有调教价值",
      "【未开发】没什么特别的感觉",
    ]),
  );
  return { title: "【胸】", lines };
}

function sectionFinger(slot: CharaSlot): BodySection {
  const st = slot.state;
  const lines: BodyLine[] = [];
  if (st.TALENT[TALENT_ID.器用な指]) lines.push(line("非同一般的灵活手指", "cream"));
  const shuin = st.EXP[EXP_ID.手淫経験] ?? 0;
  if (shuin) lines.push(line(`手淫${shuin}次`));
  lines.push(
    skillLadder(st.ABL[ABL_ID.指] ?? 0, {
      6: "【巅峰】手指究竟怎样用这种速度做出这般动作的…如今已经❤不重要了…",
      5: "【凶器】手指的灵活程度即便是幻想乡也很难找到更厉害的了",
      4: "【大师】指的技巧已经可以开班授徒了",
      3: "【达人】手指的使用技巧已经变得十分上道了",
      2: "【熟练】手指的使用开始熟练了",
      1: "【生疏】接下来的路还长着呢",
      0: "【笨拙】手…不是这样弄的",
    }),
  );
  return { title: "【指】", lines };
}

function sectionC(slot: CharaSlot): BodySection | null {
  const st = slot.state;
  const gender = st.TALENT[TALENT_ID.性別] ?? 0;
  if (gender !== 1 && gender !== 3) return null;
  const lines: BodyLine[] = [];
  const ecst = st.EXP[EXP_ID.Ｃ絶頂経験] ?? 0;
  if (ecst) lines.push(line(`阴蒂高潮过${ecst}次`));
  lines.push(
    senseLadder(st.ABL[ABL_ID.Ｃ感覚] ?? 0, [
      "【敏感度远超常人】哪怕是在日常里都时刻充血挺立着，只需对着吹口气就能高潮",
      "【极度敏感】如今可说这里已经变成完美的性器了，不经意触碰到都会吐着舌头强烈高潮",
      "【感度拔群】就连走路也会有快感，烦恼着如何减少衣物的摩擦",
      "【十分敏感】轻轻一捏就会舒服的高潮",
      "【敏感】阴蒂已经可以产生明显的快感了",
      "【素质】只要爱抚小豆豆就会一颤一颤的，很有调教价值",
      "【未开发】即便被爱抚也没什么特别的感觉",
    ]),
  );
  return { title: "【阴蒂】", lines };
}

function sectionBody(slot: CharaSlot, masterName: string): BodySection {
  const st = slot.state;
  const lines: BodyLine[] = [];
  const t = (id: number) => st.TALENT[id] ?? 0;
  const e = (id: number) => st.EXP[id] ?? 0;
  const c = (id: number) => st.CFLAG[id] ?? 0;

  if ((c(CFLAG_ID.继承) >> 2) & 1) lines.push(line(`${masterName}非常清楚怎样做能让其爱上自我安慰的滋味`, "cream"));
  const wet = t(TALENT_ID.濡れやすさ);
  const leak = t(TALENT_ID.漏尿癖);
  if (wet !== 0 || leak) {
    let text = "这副身体";
    if (wet < 0) text += "不太容易湿";
    else if (wet > 0) text += "非常容易湿";
    if (leak) text += " 尿道变得敏感，只要高潮就会喷出尿来";
    lines.push(line(text, "cream"));
  }

  if (e(EXP_ID.絶頂経験)) lines.push(line(`总共绝顶过${e(EXP_ID.絶頂経験)}次`, "red"));
  if (e(EXP_ID.自慰経験)) lines.push(line(`自慰过${e(EXP_ID.自慰経験)}次`, "red"));
  if (e(EXP_ID.道具使用経験)) lines.push(line(`使用过成人玩具${e(EXP_ID.道具使用経験)}次`, "red"));
  if (e(EXP_ID.奉仕快楽経験)) lines.push(line(`侍奉快乐${e(EXP_ID.奉仕快楽経験)}次`, "red"));
  if (e(EXP_ID.露出快楽経験)) lines.push(line(`露出快乐${e(EXP_ID.露出快楽経験)}次`, "red"));
  if (e(EXP_ID.放尿経験)) lines.push(line(`漏过${e(EXP_ID.放尿経験)}次圣水`, "red"));
  if (c(CFLAG_ID.累計精浴)) lines.push(line(`被浇上过${c(CFLAG_ID.累計精浴)}次精液`, "red"));
  if (e(EXP_ID.緊縛経験)) lines.push(line(`被捆绑过${e(EXP_ID.緊縛経験)}次`, "red"));
  if (e(EXP_ID.出産経験)) lines.push(line(`生过${e(EXP_ID.出産経験)}次孩子`, "red"));
  if (e(EXP_ID.異常経験)) lines.push(line(`遭遇过${e(EXP_ID.異常経験)}次异常事件`, "red"));

  if (c(CFLAG_ID.强行内射)) lines.push(line(`有被${masterName}强行中出过`, "purple"));
  const sleepR = c(CFLAG_ID.睡眠姦);
  if (sleepR === 1) lines.push(line(`被${masterName}在睡着时恶作剧的侵犯过`, "purple"));
  if (sleepR === 2) lines.push(line(`被${masterName}在睡着时侵犯过`, "purple"));
  const drunkR = c(CFLAG_ID.烂酔奸);
  if (drunkR === 2) lines.push(line(`有被${masterName}趁醉侵犯过`, "purple"));
  else if (drunkR === 1) lines.push(line(`有被${masterName}趁醉侵犯过而且没有察觉`, "purple"));
  return { title: "【身】", lines };
}

function sectionHeart(slot: CharaSlot, masterName: string): BodySection | null {
  const st = slot.state;
  const t = (id: number) => st.TALENT[id] ?? 0;
  const unaware = st.EXP[EXP_ID.無自覚絶頂経験] ?? 0;
  if (!t(TALENT_ID.自慰しやすい) && !t(TALENT_ID.自慰狂) && !unaware && !t(TALENT_ID.反発抑制) && !t(TALENT_ID.合意誤認)) {
    return null;
  }
  const lines: BodyLine[] = [];
  if (t(TALENT_ID.自慰しやすい)) lines.push(line("天生拥有一个容易自慰的灵魂❤…", "cream"));
  if (t(TALENT_ID.自慰狂)) lines.push(line("❤无时无刻都在想着自我安慰❤…", "cream"));
  if (unaware) lines.push(line(`在不知情的情况下绝顶过${unaware}次`));
  if (t(TALENT_ID.反発抑制)) lines.push(line(`处于催眠状态中、无法对${masterName}的出格行为生气`, "purple"));
  if (t(TALENT_ID.合意誤認)) lines.push(line(`处于催眠状态中、认为自己和${masterName}是互诉终身的恋人`, "purple"));
  return { title: "【心】", lines };
}

function sectionA(slot: CharaSlot, masterName: string): BodySection {
  const st = slot.state;
  const lines: BodyLine[] = [];
  const t = (id: number) => st.TALENT[id] ?? 0;
  const e = (id: number) => st.EXP[id] ?? 0;
  const c = (id: number) => st.CFLAG[id] ?? 0;
  const a = (id: number) => st.ABL[id] ?? 0;

  if ((c(CFLAG_ID.继承) >> 4) & 1) lines.push(line(`能打开肛门快感的开关已经被${masterName}知晓了`, "cream"));
  if (t(TALENT_ID.尻穴狂い)) {
    lines.push(line(e(EXP_ID.肛射経験) >= 100 ? "菊穴只要被浓稠滚烫的精液射进去就会高潮" : "已经无法想象菊花不被玩弄的日子了", "cream"));
  }

  if (e(EXP_ID.肛射経験)) lines.push(line(`后庭被射入过${e(EXP_ID.肛射経験)}次`));
  if (c(CFLAG_ID.累計肛門精液)) lines.push(line(`现在为止被${c(CFLAG_ID.累計肛門精液)}ml精液注入了`));
  if (e(EXP_ID.Ａ絶頂経験)) lines.push(line(`后庭高潮过${e(EXP_ID.Ａ絶頂経験)}次`));

  if (slot.charaNum !== 0) {
    const skill = a(ABL_ID.肛門);
    if (skill >= 6) lines.push(line(`【极上名器】完全调适为${masterName}专用形态的菊穴肉襞一张一缩地蠢动着`, "red"));
    else if (skill === 5) lines.push(line("【名器】收缩力可以使手嗦里、吸力相当犀利", "pink"));
    else if (skill === 4) lines.push(line("【大师】使用后面的技巧可以算得上是独领风骚了", "orange"));
    else if (skill === 3) lines.push(line("【达人】变成了非常好用极为融洽的穴了", "yellow"));
    else if (skill === 2) lines.push(line("【熟练】已经习惯被插入了", "green"));
    else if (skill === 1) lines.push(line("【生疏】开始柔软并变得好使了", "aqua"));
    else if (!c(CFLAG_ID.尻穴処女喪失記念日)) lines.push(line("【未开通】崭新出厂的新货"));
    else if (e(EXP_ID.Ａ経験) < 20) lines.push(line("【笨拙】还不太习惯被异物插入的样子"));
  }

  lines.push(
    senseLadder(a(ABL_ID.Ａ感覚), [
      "【敏感度远超常人】日常都在不自觉的发痒，任何东西刺激到都会吐着舌头强烈高潮",
      "【极度敏感】即便本身的设计并不是用来寻欢作乐的，但如今可说这里已经变成完美的性器官了",
      "【感度拔群】就连日常排泄也会有快感，烦恼着如何清洁",
      "【十分敏感】可以说这里是好用的第二个穴了，用力插进去就会舒服的高潮",
      "【敏感】后庭已经可以产生明显的快感了，继续调教下去这里也能成为合格的性器。",
      "【素质】只要爱抚周围就会一缩一缩的，很有调教价值",
      "【未开发】即便被爱抚也没什么特别的感觉",
    ]),
  );

  // 肛门处女丧失履历
  if (!e(EXP_ID.Ａ性交経験)) lines.push(line("肛门处女丧失履历：还没有被使用过", "yellow"));

  lines.push(
    addictionLadder(a(ABL_ID.肛射中毒), [
      `精子❤！精子❤！精子❤！${masterName}的精子❤～啊❤～${masterName}请灌满我吧❤～`,
      "呐～下次就用后面吧…嗯？因为…因为不用带套嘛…才不是想让你射进来…八嘎❤",
      "为什么射进去后会微笑？哪…哪里笑了…哎呀❤讨厌❤",
      "总是这样不听人说就射进来…嘛～因为很舒服所以原谅你…",
      "射进去以后痒痒的…唔…没…没什么…",
      "不会怀孕也不是射进来的理由啊…真是的…",
      "射进后面？你到底在想什么啊？",
    ]),
  );

  if ((st.ABL[ABL_ID.Ａ感覚] ?? 0) >= 5 && (c(CFLAG_ID.溜まってる度) > 300) && slot.charaNum !== 0) {
    lines.push(line("后庭不自觉蠕动着，渴望被什么东西插进来", "purple"));
  }
  return { title: "【肛】", lines };
}

function sectionV(slot: CharaSlot, masterName: string): BodySection | null {
  const st = slot.state;
  const gender = st.TALENT[TALENT_ID.性別] ?? 0;
  if (gender !== 1 && gender !== 3) return null;
  const lines: BodyLine[] = [];
  const t = (id: number) => st.TALENT[id] ?? 0;
  const e = (id: number) => st.EXP[id] ?? 0;
  const c = (id: number) => st.CFLAG[id] ?? 0;
  const a = (id: number) => st.ABL[id] ?? 0;

  if ((c(CFLAG_ID.继承) >> 3) & 1) lines.push(line(`最有感觉的地方${masterName}都非常清楚`, "cream"));
  if (t(TALENT_ID.淫壺)) {
    lines.push(line(e(EXP_ID.膣射経験) >= 100 ? "淫穴只要被浓稠滚烫的精液射进去就会高潮" : "已经开发完成的淫穴❤", "cream"));
  }

  if (e(EXP_ID.膣射経験)) lines.push(line(`膣内被射入过${e(EXP_ID.膣射経験)}次`));
  if (c(CFLAG_ID.累計膣内精液)) lines.push(line(`现在为止被${c(CFLAG_ID.累計膣内精液)}ml精液注入了`));
  if (e(EXP_ID.Ｖ絶頂経験)) lines.push(line(`小穴高潮过${e(EXP_ID.Ｖ絶頂経験)}次`));

  if (slot.charaNum !== 0) {
    const skill = a(ABL_ID.膣);
    const unaware = t(TALENT_ID.処女) === -1;
    if (skill >= 6)
      lines.push(line(unaware ? `【极上名器】本人不知情的情况下、已经开发到极致的处女穴早已准备好随时取悦${masterName}` : `【极上名器】肉襞中每一个褶皱都是为了更容易榨取${masterName}的精液而努力蠕动着`, "red"));
    else if (skill === 5)
      lines.push(line(unaware ? `【名器】在本人不知情的情况下、已经变成了只是为取悦${masterName}的穴` : `【名器】完全调适为${masterName}专用形态的膣腔肉壁一张一缩地蠢动着`, "pink"));
    else if (skill === 4)
      lines.push(line(unaware ? `【大师】在本人不知情的情况下、开发成能让${masterName}流连忘返的小穴` : "【大师】开发后的膣腔肉壁吸力惊人、任何肉棒都抵抗不住榨精的程度", "orange"));
    else if (skill === 3)
      lines.push(line(unaware ? `【达人】不知不觉间变为了能让${masterName}感到非常舒服的小穴` : "【达人】变成了非常好使极为融洽的穴了", "yellow"));
    else if (skill === 2)
      lines.push(line(unaware ? `【熟练】是能让${masterName}兴奋不已的小穴了、但其本人还并不知晓` : `【熟练】已经习惯了${masterName}的插入了`, "green"));
    else if (skill === 1)
      lines.push(line(unaware ? `【生疏】不知不觉间被${masterName}搞到感到柔软了、十分好用` : "【生疏】开始柔软并变得好使了", "aqua"));
    else if (t(TALENT_ID.処女) === 1) lines.push(line("【处女】不懂性的未使用过的阴道"));
    else if (e(EXP_ID.Ｖ経験) < 10) lines.push(line("【笨拙】开始懂得性、惶恐的接触着性知识的阴道用力的夹着"));
    else if (e(EXP_ID.Ｖ経験) < 20) lines.push(line("【笨拙】几乎没怎么用阴道里还很僵硬"));
  }

  lines.push(
    senseLadder(a(ABL_ID.Ｖ感覚), [
      "【敏感度远超常人】时时刻刻都在不自主的收缩，任何东西插入都会吐着舌头强烈高潮",
      "【极度敏感】就连子宫也会配合着寻求快感了，插入进去的物体想拿出来都困难",
      "【感度拔群】阴道内壁已经像G点一样敏感了，任何东西进去都会被强力的吮吸",
      "【十分敏感】有东西插进去就会舒服的高潮，阴道收缩的力度已经非常厉害了",
      "【敏感】内部已经可以产生明显的快感了，G点的位置也已经被完全摸清楚了",
      "【素质】收缩的很厉害，很有调教价值",
      "【未开发】还产生不了什么特别的感觉",
    ]),
  );

  // 处女丧失履历 (性別 bit0)
  if ((st.TALENT[TALENT_ID.性別] ?? 0) & 1) {
    const virgin = t(TALENT_ID.処女);
    if (virgin === 1) {
      const extra = (a(ABL_ID.Ｖ感覚) >= 5) ? "，尽管如此、敏感到只要给予刺激就会轻易的陷入绝顶" : "";
      lines.push(line(`处女丧失履历：还没被任何人进入${extra}`, "yellow"));
    } else if (virgin === -1) {
      lines.push(line("处女丧失履历：没有意识到已经被夺走了处女", "pink"));
    } else if (virgin === 0 && c(CFLAG_ID.処女喪失記念日)) {
      lines.push(line(`处女丧失履历：在第${c(CFLAG_ID.処女喪失記念日)}日失去了`, "pink"));
    } else if (virgin === 0 && slot.charaNum !== 0) {
      lines.push(line(`处女丧失履历：在和${masterName}相遇之前失去了`, "aqua"));
    }
  }

  lines.push(
    addictionLadder(a(ABL_ID.膣射中毒), [
      `精子❤！精子❤！精子❤！无时无刻都在渴求${masterName}的精子❤～啊❤让我怀孕吧${masterName}大人❤～`,
      "射进来❤射进来❤～把我灌得满满的❤～什么？会怀孕？事到如今不要管那种事情啦❤～",
      `一被膣内射精就会有强烈的幸福感，失去了${masterName}的精子恐怕就无法活下去了吧`,
      `子宫内缺少${masterName}的精子就会主动渴求，无法想象没有${masterName}精子的日子了`,
      `一被膣内射精子宫就会躁动难耐，已经离不开${masterName}精子的灌溉了`,
      `膣内已经被${masterName}的精子完全污染、子宫也正逐步被浸染`,
      "不行！为什么总是想射进来！不行！",
    ]),
  );

  if ((a(ABL_ID.Ｖ感覚) >= 5) && (c(CFLAG_ID.溜まってる度) > 300) && slot.charaNum !== 0) {
    lines.push(line(`自己的手指根本无法排解，现在想和${masterName}做想的不得了`, "purple"));
  }
  return { title: "【膣】", lines };
}

function sectionW(slot: CharaSlot): BodySection | null {
  const st = slot.state;
  const gender = st.TALENT[TALENT_ID.性別] ?? 0;
  if (gender !== 1 && gender !== 3) return null;
  const lines: BodyLine[] = [];
  if (st.TALENT[TALENT_ID.子宮口性感]) lines.push(line("开发完成的柔软子宫口❤学会了吮吸肉棒", "cream"));
  const dev = st.EXP[EXP_ID.子宮口開発経験] ?? 0;
  if (dev) lines.push(line(`子宫被开发过${dev}次`));
  // 生理周期/充填率/妊娠 prose — gated on state the modern runtime doesn't
  // write yet (NOTICE_CYCLE/EX 精液量/TALENT:妊娠); gates false ⇒ hidden.
  if (st.TALENT[TALENT_ID.妊娠]) {
    const days = st.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0;
    if (days < 20) lines.push(line("生理期停了", "red"));
    else lines.push(line(`子宫内正孕育着孩子　现在妊娠${days}日`, "red"));
  }
  return lines.length > 0 ? { title: "【子宫】", lines } : null;
}

/** `@ちん遍歴` (PRINT_STATE2.ERB:391) — MASTER only. */
function sectionPenis(state: GameState, slot: CharaSlot): BodySection | null {
  const st = slot.state;
  if (!((st.TALENT[TALENT_ID.性別] ?? 0) & 2)) return null;
  const lines: BodyLine[] = [];
  const shapeText: Record<number, string> = {
    1: "像儿童般可爱的", 2: "有点寒酸的", 3: "平淡无奇的", 4: "可以发光的",
    5: "布满突起的", 6: "又粗又大的", 10: "像马一样的",
  };
  const shape = st.TALENT[TALENT_ID.形状] ?? 0;
  lines.push(line(`${shapeText[shape] ?? ""}肉棒`, "plain"));

  if (slot.charaNum === 0) {
    // 累计 across all charas
    let drink = 0, bath = 0, vag = 0, anal = 0;
    for (const c of Object.values(state.charas)) {
      drink += c.state.CFLAG[CFLAG_ID.累計精飲] ?? 0;
      bath += c.state.CFLAG[CFLAG_ID.累計精浴] ?? 0;
      vag += c.state.CFLAG[CFLAG_ID.累計膣内精液] ?? 0;
      anal += c.state.CFLAG[CFLAG_ID.累計肛門精液] ?? 0;
    }
    if (!(st.TALENT[TALENT_ID.非童貞] ?? 0)) {
      lines.push(line("至今还是崭新出厂的"));
    } else {
      lines.push(line(`在少女们的嘴里射过${drink}、身体上射过${bath}、小穴里射过${vag}、肛门里射过${anal}的精液`));
    }
    if (st.TALENT[TALENT_ID.濃厚精液]) lines.push(line("积攒了数日份精液的肉棒散发出令人窒息的雄性气味", "cream"));
    const stamina = st.BASE[BASE_ID.精力] ?? 0;
    if (stamina >= 1500) lines.push(line("沉甸甸的阴嚢里蓄积了大量的精子", "cream"));
    if (stamina >= 2000) lines.push(line("勤奋的睾丸还在不断生产大量的精子…给他颁个奖吧…", "cream"));
    if (stamina >= 3000) lines.push(line("话说这个精子的量？！怎么可能？！", "cream"));
    if (stamina >= 5000) lines.push(line("探测器显示这是个拥有53万精子力的男人…真可怕…", "cream"));
  }
  return { title: "【男根】", lines };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Build 肉体情報 front/back panels for a chara (0 = MASTER). */
export function buildBodyInfo(state: GameState, charaNum: number): BodyInfo | null {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return null;
  const masterName = state.master.callName ?? "主人";

  const front: BodySection[] = [];
  front.push(sectionBody(slot, masterName));
  front.push(sectionFinger(slot));
  front.push(sectionB(slot, masterName));
  const c = sectionC(slot);
  if (c) front.push(c);

  const back: BodySection[] = [];
  const heart = sectionHeart(slot, masterName);
  if (heart) back.push(heart);
  back.push(sectionM(state, slot, masterName));
  back.push(sectionA(slot, masterName));
  const v = sectionV(slot, masterName);
  if (v) back.push(v);
  const w = sectionW(slot);
  if (w) back.push(w);
  const p = sectionPenis(state, slot);
  if (p) back.push(p);

  return { front, back };
}
