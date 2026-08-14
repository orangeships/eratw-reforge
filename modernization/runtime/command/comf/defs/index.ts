/**
 * Phase 7 — COMF settlement-def registry.
 *
 * Every Tier-A/B command ported via `makeComfHandler` lives in its own
 * `comfNNN.ts` here and is collected into `COMF_HANDLER_ENTRIES`.
 * `registerDailyHandlers` spreads this array, so adding a command is one
 * new file + one line below — no churn in the handler orchestrator.
 */

import type { HandlerEntry } from "../../types.js";
import { comf302HandlerEntry } from "./comf302.js";
import { comf307HandlerEntry } from "./comf307.js";
import { comf308HandlerEntry } from "./comf308.js";
import { comf313HandlerEntry } from "./comf313.js";
import { comf314HandlerEntry } from "./comf314.js";
import { comf315HandlerEntry } from "./comf315.js";
import { comf316HandlerEntry } from "./comf316.js";
import { comf331HandlerEntry } from "./comf331.js";
import { comf336HandlerEntry } from "./comf336.js";
import { comf363HandlerEntry } from "./comf363.js";
import { comf416HandlerEntry } from "./comf416.js";
import { comf335HandlerEntry } from "./comf335.js";
import { comf412HandlerEntry } from "./comf412.js";
import { comf411HandlerEntry } from "./comf411.js";
import { comf403HandlerEntry } from "./comf403.js";
import { comf417HandlerEntry } from "./comf417.js";
import { comf440HandlerEntry } from "./comf440.js";
import { comf441HandlerEntry } from "./comf441.js";
import { comf495HandlerEntry } from "./comf495.js";
import { comf496HandlerEntry } from "./comf496.js";
import { comf0HandlerEntry } from "./comf0.js";
import { comf9HandlerEntry } from "./comf9.js";
import { comf22HandlerEntry } from "./comf22.js";
import { comf79HandlerEntry } from "./comf79.js";
import { comf40HandlerEntry } from "./comf40.js";
import { comf41HandlerEntry } from "./comf41.js";
import { comf42HandlerEntry } from "./comf42.js";
import { comf43HandlerEntry } from "./comf43.js";
import { comf44HandlerEntry } from "./comf44.js";
import { comf45HandlerEntry } from "./comf45.js";
import { comf46HandlerEntry } from "./comf46.js";
import { comf47HandlerEntry } from "./comf47.js";
import { comf48HandlerEntry } from "./comf48.js";
import { comf49HandlerEntry } from "./comf49.js";
import { comf60HandlerEntry } from "./comf60.js";
import { comf61HandlerEntry } from "./comf61.js";
import { comf62HandlerEntry } from "./comf62.js";
import { comf63HandlerEntry } from "./comf63.js";
import { comf64HandlerEntry } from "./comf64.js";
import { comf65HandlerEntry } from "./comf65.js";
import { comf66HandlerEntry } from "./comf66.js";
import { comf67HandlerEntry } from "./comf67.js";
import { comf68HandlerEntry } from "./comf68.js";
import { comf69HandlerEntry } from "./comf69.js";
import { comf70HandlerEntry } from "./comf70.js";
import { comf130HandlerEntry } from "./comf130.js";
import { comf131HandlerEntry } from "./comf131.js";
import { comf132HandlerEntry } from "./comf132.js";
import { comf133HandlerEntry } from "./comf133.js";
import { comf320HandlerEntry } from "./comf320.js";
import { comf322HandlerEntry } from "./comf322.js";
import { comf323HandlerEntry } from "./comf323.js";
import { comf80HandlerEntry } from "./comf80.js";
import { comf100HandlerEntry } from "./comf100.js";
import { comf101HandlerEntry } from "./comf101.js";
import { comf102HandlerEntry } from "./comf102.js";
import { comf103HandlerEntry } from "./comf103.js";
import { comf104HandlerEntry } from "./comf104.js";
import { comf105HandlerEntry } from "./comf105.js";
import { comf106HandlerEntry } from "./comf106.js";
import { comf107HandlerEntry } from "./comf107.js";
import { comf108HandlerEntry } from "./comf108.js";
import { comf140HandlerEntry } from "./comf140.js";
import { comf141HandlerEntry } from "./comf141.js";
import { comf142HandlerEntry } from "./comf142.js";
import { comf143HandlerEntry } from "./comf143.js";
import { comf145HandlerEntry } from "./comf145.js";
import { comf146HandlerEntry } from "./comf146.js";
import { comf147HandlerEntry } from "./comf147.js";
import { comf148HandlerEntry } from "./comf148.js";
import { comf150HandlerEntry } from "./comf150.js";
import { comf180HandlerEntry } from "./comf180.js";
import { comf181HandlerEntry } from "./comf181.js";
import { comf182HandlerEntry } from "./comf182.js";
import { comf183HandlerEntry } from "./comf183.js";
import { comf184HandlerEntry } from "./comf184.js";
import { comf186HandlerEntry } from "./comf186.js";
import { comf187HandlerEntry } from "./comf187.js";
import { comf188HandlerEntry } from "./comf188.js";
import { comf189HandlerEntry } from "./comf189.js";
import { comf190HandlerEntry } from "./comf190.js";
import { comf191HandlerEntry } from "./comf191.js";
import { comf192HandlerEntry } from "./comf192.js";
import { comf700HandlerEntry } from "./comf700.js";
import { comf702HandlerEntry } from "./comf702.js";
import { comf703HandlerEntry } from "./comf703.js";
import { comf705HandlerEntry } from "./comf705.js";
import { comf706HandlerEntry } from "./comf706.js";
import { comf707HandlerEntry } from "./comf707.js";
import { comf708HandlerEntry } from "./comf708.js";
import { comf709HandlerEntry } from "./comf709.js";
import { comf712HandlerEntry } from "./comf712.js";
import { comf713HandlerEntry } from "./comf713.js";
import { comf740HandlerEntry } from "./comf740.js";
import { comf741HandlerEntry } from "./comf741.js";
import { comf742HandlerEntry } from "./comf742.js";
import { comf743HandlerEntry } from "./comf743.js";
import { comf744HandlerEntry } from "./comf744.js";
import { comf745HandlerEntry } from "./comf745.js";
import { comf746HandlerEntry } from "./comf746.js";
import { comf747HandlerEntry } from "./comf747.js";
import { comf748HandlerEntry } from "./comf748.js";
import { comf749HandlerEntry } from "./comf749.js";
import { comf751HandlerEntry } from "./comf751.js";
import { comf1HandlerEntry } from "./comf1.js";
import { comf2HandlerEntry } from "./comf2.js";
import { comf3HandlerEntry } from "./comf3.js";
import { comf4HandlerEntry } from "./comf4.js";
import { comf5HandlerEntry } from "./comf5.js";
import { comf6HandlerEntry } from "./comf6.js";
import { comf7HandlerEntry } from "./comf7.js";
import { comf8HandlerEntry } from "./comf8.js";
import { comf10HandlerEntry } from "./comf10.js";
import { comf11HandlerEntry } from "./comf11.js";
import { comf12HandlerEntry } from "./comf12.js";
import { comf13HandlerEntry } from "./comf13.js";
import { comf15HandlerEntry } from "./comf15.js";
import { comf20HandlerEntry } from "./comf20.js";
import { comf21HandlerEntry } from "./comf21.js";
import { comf81HandlerEntry } from "./comf81.js";
import { comf82HandlerEntry } from "./comf82.js";
import { comf83HandlerEntry } from "./comf83.js";
import { comf84HandlerEntry } from "./comf84.js";
import { comf85HandlerEntry } from "./comf85.js";
import { comf88HandlerEntry } from "./comf88.js";
import { comf89HandlerEntry } from "./comf89.js";
import { comf90HandlerEntry } from "./comf90.js";
import { comf91HandlerEntry } from "./comf91.js";
import { comf92HandlerEntry } from "./comf92.js";
import { comf93HandlerEntry } from "./comf93.js";
import { comf94HandlerEntry } from "./comf94.js";
import { comf95HandlerEntry } from "./comf95.js";
import { comf96HandlerEntry } from "./comf96.js";
import { comf120HandlerEntry } from "./comf120.js";
import { comf121HandlerEntry } from "./comf121.js";
import { comf123HandlerEntry } from "./comf123.js";
import { comf124HandlerEntry } from "./comf124.js";
import { comf125HandlerEntry } from "./comf125.js";
import { comf126HandlerEntry } from "./comf126.js";
import { comf127HandlerEntry } from "./comf127.js";
import { comf305HandlerEntry } from "./comf305.js";
import { comf306HandlerEntry } from "./comf306.js";
import { comf311HandlerEntry } from "./comf311.js";
import { comf312HandlerEntry } from "./comf312.js";
import { comf330HandlerEntry } from "./comf330.js";

export const COMF_HANDLER_ENTRIES: HandlerEntry[] = [
  // These source-faithful definitions previously existed on disk but were
  // omitted from the canonical catalog array, leaving their personal kojo
  // unreachable through real play.
  comf2HandlerEntry,
  comf3HandlerEntry,
  comf4HandlerEntry,
  comf5HandlerEntry,
  comf6HandlerEntry,
  comf7HandlerEntry,
  comf8HandlerEntry,
  comf10HandlerEntry,
  comf11HandlerEntry,
  comf12HandlerEntry,
  comf13HandlerEntry,
  comf15HandlerEntry,
  comf20HandlerEntry,
  comf21HandlerEntry,
  comf81HandlerEntry,
  comf82HandlerEntry,
  comf83HandlerEntry,
  comf84HandlerEntry,
  comf85HandlerEntry,
  comf88HandlerEntry,
  comf89HandlerEntry,
  comf90HandlerEntry,
  comf91HandlerEntry,
  comf92HandlerEntry,
  comf93HandlerEntry,
  comf94HandlerEntry,
  comf95HandlerEntry,
  comf96HandlerEntry,
  comf120HandlerEntry,
  comf121HandlerEntry,
  comf123HandlerEntry,
  comf124HandlerEntry,
  comf125HandlerEntry,
  comf126HandlerEntry,
  comf127HandlerEntry,
  comf0HandlerEntry, //  愛撫 (7 H foreplay family exemplar)
  comf9HandlerEntry, //  自慰 (7 foreplay — commanded masturbation, 露出/屈従)
  comf22HandlerEntry, // 誘い受ける (7 foreplay — master 受虐属性 露出/液体/欲情)
  comf79HandlerEntry, // 小人オナホ (7 positions — dwarf sleeve, 処女/拡張 arms)
  comf302HandlerEntry, // スキンシップ (7A exemplar)
  comf305HandlerEntry, // 膝枕してもらう (7 daily touch)
  comf306HandlerEntry, // お腹を撫でる (7 daily touch)
  comf307HandlerEntry, // 頬をつまむ (7A batch1)
  comf308HandlerEntry, // 頬をつつく (7A batch1)
  comf311HandlerEntry, // 抱き付く (7 daily touch)
  comf312HandlerEntry, // キスする (7 daily touch)
  comf313HandlerEntry, // 胸愛撫 (7A batch2)
  comf314HandlerEntry, // アナル愛撫 (7A batch2)
  comf315HandlerEntry, // クリ愛撫 (7A batch2)
  comf316HandlerEntry, // 指挿れ (7A batch3)
  comf330HandlerEntry, // スカートをめくる (7 daily touch)
  comf331HandlerEntry, // お茶を淹れる（薬入り） (7A batch3)
  comf336HandlerEntry, // 膝枕する (7A batch4)
  comf363HandlerEntry, // 読み聞かせ (7A batch4)
  comf416HandlerEntry, // 演奏する (7A batch5)
  comf335HandlerEntry, // 介抱する (7A batch1)
  comf412HandlerEntry, // 勉強 (7 chore-help family exemplar)
  comf411HandlerEntry, // 戦闘訓練 (7 chore-help family sibling)
  comf403HandlerEntry, // 休憩 (7 rest/self-care family exemplar — recoverPermil)
  comf417HandlerEntry, // 昼寝する (7 rest family sibling — recovery + 添い寝 SOURCE)
  comf440HandlerEntry, // 待つ (7.5 trivial-wait — 気力 drain + TIME+20)
  comf441HandlerEntry, // 授業を受ける (Wave 1 — 勉強 sibling, 寺子屋+慧音 仕事中, 信頼度管理)
  comf495HandlerEntry, // 空を眺める (7.5 trivial-wait — TIME+1 + clear COMABLE管理)
  comf496HandlerEntry, // ラジオをいじる (thin MVP — 教養 gate flavor + TIME+5; 天気予報 deferred)
  comf40HandlerEntry, //  ローター (7 toys family exemplar — 道具系 40-49)
  comf41HandlerEntry, // Ｅマッサージャ (7 toys family sibling)
  comf42HandlerEntry, // クリキャップ (7 toys family sibling)
  comf43HandlerEntry, // オナホール (7 toys family sibling)
  comf44HandlerEntry, // バイブ (7 toys family sibling — insertion-style)
  comf45HandlerEntry, // アナルバイブ (7 toys family sibling — insertion-style)
  comf46HandlerEntry, // アナルビーズ (7 toys family sibling — toggle-gated)
  comf47HandlerEntry, // ニプルキャップ (7 toys family sibling)
  comf48HandlerEntry, // 搾乳機 (7 toys family sibling — heavy)
  comf49HandlerEntry, // 乳首ロータ (7 toys family sibling)
  comf60HandlerEntry, //  正常位 (7 positions family exemplar — 体位系 60-71)
  comf80HandlerEntry, //  手淫 (7 oral/hand family exemplar — 奉仕系 80-96)
  comf100HandlerEntry, // スパンキング (7 SM family exemplar — SM系 100-192)
  comf101HandlerEntry, // 鞭 (7 SM sibling)
  comf102HandlerEntry, // 蝋燭 (7 SM sibling)
  comf103HandlerEntry, // 針 (7 SM sibling)
  comf104HandlerEntry, // アイマスク (7 SM sibling — equip blindfold)
  comf105HandlerEntry, // 縄 (7 SM sibling — equip rope)
  comf106HandlerEntry, // ボールギャグ (7 SM sibling — equip ball-gag)
  comf107HandlerEntry, // 拘束プレイ (7 SM sibling — equip restraint)
  comf108HandlerEntry, // 乳スパンキング (7 SM sibling — 反感=300, 快Ｂ converter)
  comf140HandlerEntry, // イラマチオ (SM — deep-throat, master 快Ｃ 舌 scale)
  comf141HandlerEntry, // フィストファック (SM — Ｖ fist, EXP/潤滑 苦痛 ladder)
  comf142HandlerEntry, // アナルフィスト (SM — Ａ fist, EXP/潤滑 苦痛 ladder)
  comf143HandlerEntry, // 両穴フィスト (SM — Ｖ+Ａ, 4-ladder 苦痛/反感)
  comf145HandlerEntry, // アナル奉仕 (SM — master 快Ａ, 屈従 bundle)
  comf146HandlerEntry, // 浣腸器＋プラグ (SM — anal enema, 鬱屈/不潔)
  comf147HandlerEntry, // 拡張バルーン (SM — anal expansion, inverted EXP ladder)
  comf148HandlerEntry, // アナル電極 (SM — anal electrode, EXP/潤滑 苦痛 ladder)
  comf150HandlerEntry, // 胸の谷間を犯す (SM — titfuck, master 快Ｃ 胸 scale)
  comf180HandlerEntry, // ローション (7 特殊 family sibling)
  comf181HandlerEntry, // 媚薬 (7 特殊 family sibling)
  comf182HandlerEntry, // 利尿剤 (7 特殊 family sibling)
  comf183HandlerEntry, // ビデオカメラ (7 特殊 family sibling)
  comf184HandlerEntry, // 野外プレイ (7 特殊 family sibling)
  comf186HandlerEntry, // 羞恥プレイ (7 特殊 family sibling)
  comf187HandlerEntry, // お風呂場プレイ (7 特殊 family sibling)
  comf188HandlerEntry, // シャワー (7 特殊 family sibling)
  comf189HandlerEntry, // 新妻プレイ (7 特殊 family sibling)
  comf190HandlerEntry, // エプロン (7 特殊 family sibling)
  comf191HandlerEntry, // 睡眠薬 (7 特殊 family sibling)
  comf192HandlerEntry, // 排卵誘発剤 (7 特殊 family sibling)
  comf61HandlerEntry, //  後背位 (7 positions sibling)
  comf62HandlerEntry, //  正常位アナル (7 positions sibling)
  comf63HandlerEntry, //  後背位アナル (7 positions sibling)
  comf64HandlerEntry, //  逆レイプ (7 positions sibling — target-on-top)
  comf65HandlerEntry, //  騎乗位 (7 positions sibling)
  comf66HandlerEntry, //  騎乗位アナル (7 positions sibling)
  comf67HandlerEntry, //  対面座位 (7 positions sibling)
  comf68HandlerEntry, //  背面座位 (7 positions sibling)
  comf69HandlerEntry, //  対面座位アナル (7 positions sibling)
  comf70HandlerEntry, //  背面座位アナル (7 positions sibling)
  comf130HandlerEntry, // 正常位される (7 される系 sibling)
  comf131HandlerEntry, // 後背位される (7 される系 sibling)
  comf132HandlerEntry, // 対面座位される (7 される系 sibling)
  comf133HandlerEntry, // 背面座位される (7 される系 sibling)
  comf320HandlerEntry, // 正常位（相手主導） (7 相手主導 sibling)
  comf322HandlerEntry, // 相手主導後背位 (7 相手主導 sibling)
  comf323HandlerEntry, // 相手主導後背位Ａ (7 相手主導 sibling)
  comf700HandlerEntry, // 愛撫(慰) (7 self/auto family exemplar — 700 自慰系)
  comf702HandlerEntry, // セルフフェラ(慰) (7 self/auto sibling)
  comf703HandlerEntry, // 指挿れ(慰) (7 self/auto sibling)
  comf705HandlerEntry, // アナル愛撫(慰) (7 self/auto sibling)
  comf706HandlerEntry, // 胸愛撫(慰) (7 self/auto sibling)
  comf707HandlerEntry, // 乳首責め(慰) (7 self/auto sibling)
  comf708HandlerEntry, // 秘貝開帳(慰) (7 self/auto sibling)
  comf709HandlerEntry, // 手淫(慰) (7 self/auto sibling)
  comf712HandlerEntry, // 胸揉み(慰) (7 self/auto sibling — toggle)
  comf713HandlerEntry, // アナル開帳(慰) (7 self/auto sibling)
  comf740HandlerEntry, // ローター(慰) (7 self/auto toy)
  comf741HandlerEntry, // Ｅマッサージャ(慰) (7 self/auto toy)
  comf742HandlerEntry, // クリキャップ(慰) (7 self/auto toy — toggle)
  comf743HandlerEntry, // オナホール(慰) (7 self/auto toy — toggle)
  comf744HandlerEntry, // バイブ(慰) (7 self/auto toy — toggle, virgin penalty)
  comf745HandlerEntry, // アナルバイブ(慰) (7 self/auto toy — toggle)
  comf746HandlerEntry, // アナルビーズ(慰) (7 self/auto toy — toggle)
  comf747HandlerEntry, // ニプルキャップ(慰) (7 self/auto toy — toggle)
  comf748HandlerEntry, // 搾乳機(慰) (7 self/auto toy — toggle)
  comf749HandlerEntry, // 乳首ローター(慰) (7 self/auto toy)
  comf751HandlerEntry, // 自慰終了 (7 self/auto exit gate)
  comf1HandlerEntry, //  クンニ (7 H foreplay family — audited 2026-06-18, spec §6 clean)
];
