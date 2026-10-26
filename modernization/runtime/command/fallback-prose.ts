/**
 * Localize the small amount of migration-fallback prose that can still be
 * emitted when a command has no authored TRAIN_MESSAGE route.
 *
 * This is deliberately presentation-only. It does not change command labels,
 * settlement, or authored DIALOGUE_LINE text. The source command definitions
 * remain the upstream-facing data; this boundary keeps their temporary
 * Japanese/English labels from reaching the player while the authored routes
 * are filled in.
 */

const JAPANESE_ACTIONS: ReadonlyArray<readonly [string, string]> = [
  // Full labels first: several of these contain shorter labels below.
  ["Ａパールを入れられる", "被放入肛门拉珠"],
  ["相手主導後背位Ａ", "对方主导后背位A"],
  ["正常位（相手主導）", "正常位（对方主导）"],
  ["浣腸器＋プラグ", "灌肠器＋肛塞"],
  ["アナル愛撫される", "被爱抚肛门"],
  ["アナル舐めされる", "被舔肛"],
  ["アナル開帳(慰)", "张开肛门（自慰）"],
  ["アナル愛撫(慰)", "肛门爱抚（自慰）"],
  ["アナルバイブ(慰)", "肛门振动棒（自慰）"],
  ["アナルビーズ(慰)", "肛门拉珠（自慰）"],
  ["アナル愛撫", "肛门爱抚"],
  ["アナル奉仕", "肛门侍奉"],
  ["アナルフィスト", "肛门拳交"],
  ["アナル電極", "肛门电极"],
  ["アナルバイブ", "肛门振动棒"],
  ["アナルビーズ", "肛门拉珠"],
  ["正常位アナル", "肛门正常位"],
  ["後背位アナル", "肛门后背位"],
  ["騎乗位アナル", "肛门骑乘位"],
  ["対面座位アナル", "肛门对面坐位"],
  ["背面座位アナル", "肛门背面坐位"],
  ["Ａ正常位される", "被肛门正常位"],
  ["Ａ後背位される", "被肛门后背位"],
  ["Ａ騎乗位する", "主动肛门骑乘位"],
  ["相手主導後背位", "对方主导后背位"],
  ["対面座位される", "被对面坐位"],
  ["背面座位される", "被背面坐位"],
  ["正常位される", "被正常位"],
  ["後背位される", "被后背位"],
  ["乳首吸い(継続)", "持续吸吮乳头"],
  ["乳首責め(慰)", "玩弄乳头（自慰）"],
  ["胸愛撫(慰)", "爱抚胸部（自慰）"],
  ["胸揉み(慰)", "揉胸（自慰）"],
  ["指挿れ(慰)", "手指插入（自慰）"],
  ["手淫(慰)", "手淫（自慰）"],
  ["セルフフェラ(慰)", "自慰口交（自慰）"],
  ["ローター(慰)", "跳蛋（自慰）"],
  ["Ｅマッサージャ(慰)", "电动按摩器（自慰）"],
  ["オナホール(慰)", "自慰杯（自慰）"],
  ["ニプルキャップ(慰)", "乳头夹（自慰）"],
  ["搾乳機(慰)", "榨乳机（自慰）"],
  ["乳首ローター(慰)", "乳头跳蛋（自慰）"],
  ["秘貝開帳(慰)", "张开阴部（自慰）"],
  ["アナル開帳", "张开肛门"],
  ["秘貝開帳", "张开阴部"],
  ["乳首ローター", "乳头跳蛋"],
  ["乳首ロータ", "乳头跳蛋"],
  ["乳スパンキング", "拍打乳房"],
  ["乳の揉み合い", "互相揉胸"],
  ["乳首吸い", "吸吮乳头"],
  ["アナル舐め", "舔肛"],
  ["クンニ強制", "强制舔阴"],
  ["クンニ", "舔阴"],
  ["イラマチオ", "深喉口交"],
  ["フェラチオ", "口交"],
  ["フェラする", "进行口交"],
  ["セルフフェラ", "自慰口交"],
  ["バキュームフェラ", "真空口交"],
  ["フィストファック", "拳交"],
  ["両穴フィスト", "双穴拳交"],
  ["パイズリする", "进行乳交"],
  ["パイズリ", "乳交"],
  ["足コキする", "进行足交"],
  ["足コキ", "足交"],
  ["ゴム精飲", "吞咽精液（避孕套）"],
  ["小人オナホ", "小人自慰杯"],
  ["疑似挿入", "模拟插入"],
  ["逆レイプ", "逆强奸"],
  ["泡踊り", "泡沫舞"],
  ["愛撫させる", "让对方爱抚"],
  ["胸愛撫", "爱抚胸部"],
  ["クリ愛撫", "阴蒂爱抚"],
  ["クリキャップ(慰)", "阴蒂夹（自慰）"],
  ["クリキャップ", "阴蒂夹"],
  ["愛撫(慰)", "爱抚（自慰）"],
  ["愛撫", "爱抚"],
  ["手淫する", "手淫"],
  ["手淫", "手淫"],
  ["指挿入れ", "手指插入"],
  ["指挿れ", "手指插入"],
  ["スパンキング", "打屁股"],
  ["蝋燭", "蜡烛"],
  ["アイマスク", "眼罩"],
  ["ボールギャグ", "口球"],
  ["拘束プレイ", "拘束玩法"],
  ["野外プレイ", "野外玩法"],
  ["羞恥プレイ", "羞耻玩法"],
  ["お風呂場プレイ", "浴室玩法"],
  ["新妻プレイ", "新婚玩法"],
  ["ビデオカメラ", "摄像机"],
  ["シャワー", "淋浴"],
  ["エプロン", "围裙"],
  ["ローション", "润滑液"],
  ["拡張バルーン", "扩张气球"],
  ["排卵誘発剤", "排卵诱发剂"],
  ["睡眠薬", "安眠药"],
  ["利尿剤", "利尿剂"],
  ["媚薬", "媚药"],
  ["お茶を淹れる（薬入り）", "冲泡下药的茶"],
  ["スカートをめくる", "掀裙子"],
  ["膝枕してもらう", "接受膝枕"],
  ["膝枕する", "膝枕"],
  ["お腹を撫でる", "抚摸腹部"],
  ["頬をつまむ", "捏脸颊"],
  ["頬をつつく", "戳脸颊"],
  ["抱き付く", "拥抱"],
  ["読み聞かせ", "读故事"],
  ["スキンシップ", "身体接触"],
  ["キスする", "接吻"],
  ["キス", "接吻"],
  ["誘い受ける", "接受诱导"],
  ["ラジオをいじる", "摆弄收音机"],
  ["空を眺める", "眺望天空"],
  ["介抱する", "照料"],
  ["戦闘訓練", "战斗训练"],
  ["授業を受ける", "上课"],
  ["演奏する", "演奏"],
  ["昼寝する", "午睡"],
  ["休憩", "休息"],
  ["勉強", "学习"],
  ["待つ", "等待"],
  ["何もしない", "什么也不做"],
  // A few source labels are mixed Japanese/English. Keep the replacement
  // here scoped to fallback prose so command-menu labels stay source-faithful.
  ["PLAY", "玩法"],
  ["CASINO", "赌场"],
];

const SORTED_JAPANESE_ACTIONS = [...JAPANESE_ACTIONS].sort(
  ([left], [right]) => right.length - left.length,
);

function removeUnresolvedTokens(text: string): string {
  return text
    .replace(/%CALLNAME:(?:MASTER|PLAYER|0)%/gi, "主人公")
    .replace(/%CALLNAME:(?:TARGET|CHARA)%/gi, "对方")
    .replace(/%CALLNAME:[^%\r\n]+%/gi, "对方")
    .replace(/%MASTERNAME:\d+%/gi, "主人公")
    .replace(/\[\[([^\]\r\n]*)\]\]/g, "$1")
    .replace(/%[A-Z][A-Z0-9_]*(?::[^%\r\n]+)?(?:\([^%\r\n]*\))?%/gi, "")
    .replace(/\\?@[^@\r\n]+\\?@/g, "");
}

/** Convert migration-fallback action prose to player-facing Chinese. */
export function localizeFallbackProse(text: string): string {
  let out = removeUnresolvedTokens(text);

  // These four phrases are the remaining English fragments in the current
  // generated Comf definitions. Match the noun with the phrase so the result
  // remains grammatical after `%CALLNAME%` substitution.
  out = out
    .replace(/inserted a finger into\s+([^\s，。；;]+)'s vagina/gi, "将手指插入$1的阴道")
    .replace(/inserted a finger into\s+([^\s，。；;]+) vagina/gi, "将手指插入$1的阴道")
    .replace(/a story aloud for\s+([^\s，。；;]+)/gi, "给$1讲了故事")
    .replace(/'s\s+cheeks?/gi, "的脸颊")
    .replace(/\bvagina\b/gi, "阴道")
    .replace(/\bTSP\b/gi, "时间停止点数");

  for (const [source, replacement] of SORTED_JAPANESE_ACTIONS) {
    out = out.replaceAll(source, replacement);
  }

  // No Japanese kana is meaningful in the generated fallback sentence after
  // the known action labels above have been handled. Collapse any unknown
  // source token to a readable Chinese diagnostic rather than leaking it.
  out = out.replace(/[\u3040-\u30ff]+/gu, "相关动作");

  out = out
    .replace(/\b(?:inserted|a|an|aloud|story|for|cheeks?|vagina)\b/gi, "")
    .replace(/\s*;\s*(?=好感度)/g, "；")
    .replace(/\s*\.\s*$/g, "。")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([，。；：、！？）】])/g, "$1")
    .replace(/([（【])\s*/g, "$1")
    .trim();

  return out || "本次行动已完成。";
}
