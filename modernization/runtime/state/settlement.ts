/**
 * Phase 5B/5C — Settlement primitives.
 *
 * Typed accessors for the most-touched numeric ids in eraTW
 * settlement: location (`CFLAG:現在位置`), the player's home room
 * (`CFLAG:初期位置`), the sleep flag, the sleep-start timestamp,
 * companion flags, the named BASE stats, and (5C) the work-help
 * settlement tail (TCVAR wage credit / accumulator, BASE:仕事量,
 * EXP grants).
 *
 * The id constants live here (not in `named-stats.ts`) so handlers
 * can read `CFLAG_ID.現在位置` instead of the magic number `300`,
 * and so the CSV-vs-TS drift is visible in a single file. All ids
 * are sourced from the upstream CSV manifests (rendered into
 * `modernization/out/flags.json`):
 *
 *   - CFLAG ids: `TCVAR.als`/`CFLAG.als` in `flags.json`
 *   - BASE ids:  `Base.als` in `flags.json`
 *   - TCVAR ids: `TCVAR.als` in `flags.json` (5C)
 *   - EXP ids:   `exp.als` in `flags.json` (5C)
 *
 * **Label-vs-usage divergence on TCVAR:315** (see 5C R1): the .als
 * file labels id 315 as `手伝えない` (cannot help), but the ERB code
 * uses `TCVAR:MASTER:315` as the master's wage-accumulated
 * `帮忙工作量` (see `COMF304 仕事を手伝う.ERB` line 421). The id is
 * load-bearing; the .als label is misleading. Phase 7 importer will
 * rename for clarity. Same divergence pattern on id 323 (`.als`:
 * `手伝った量` / ERB: `TCVAR:TARGET:帮忙工作量` — these are actually
 * the SAME concept under different names).
 *
 * If a CSV row changes (e.g. eraTW adds a new flag in the 320s),
 * update here in lockstep. The Phase 7 importer will replace these
 * constants with a programmatically-generated table; for now we
 * pin them by hand.
 *
 * The `forbidden-names.test.ts` guard exempts `modernization/runtime/**`
 * — handlers and settlement primitives may spell `CFLAG`/`BASE`/`TALENT`/etc.
 * directly. `web/app/**` must go through `getNamedStat` / `getLocation`.
 */

import type { GameState, CharaSlot } from "./game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
// Phase 8: `advanceTimeTicks` delegates to the clock authority. This opens
// a benign 3-module cycle (settlement → clock → day-end → settlement);
// every cross-module reference is inside a function body, resolved at call
// time. See `runtime/world/clock.ts` header.
import { advanceClock } from "../world/clock.js";

export { TFLAG_ID } from "./tflag.js";

// ---------------------------------------------------------------------------
// ID constants — pinned from upstream CSV
// ---------------------------------------------------------------------------

/** CFLAG ids used in settlement. All values from `CFLAG.als`. */
export const CFLAG_ID = {
  /** BIT field: 0=接吻 1=えっち 2=恋人 3=Ａ 4=ＳＭ */
  既成事実: 1,
  /** 允许无套 — 0=不可 / 1=生解禁 / 2=危険日生解禁（AutoConst_CFLAG.ERH:31） */
  允许无套: 14,
  /** 好感度 — primary favor counter. Raised by 会話 via FAVOR_CALC (5D). */
  好感度: 2,
  異常経験: 3,
  /** 信頼度 — trust level. Used by FAVOR_CALC. */
  信頼度: 4,
  /** 心情不快 — sulking (CFLAG.csv line 22). Decremented every night;
   *  rebounds to 1 when MARK:反発刻印 > 0. */
  心情不快: 322,
  /** 弱み握り — grasped-weakness / blackmail material. Boosts 態度 by +40 (CHARA_ATTITUDE
   *  ATTITUDE.ERB:58) and lowers 抱き寄せ必要値 by -50 (ATTITUDE.ERB:364). CFLAG.csv line 9. */
  弱み握り: 10,
  /** 被掌握把柄 — "leverage caught on you" (CFLAG.als id=11). Set to 1 when the
   *  master is caught watching ONABARE (masturbation exposure, 窥探/失礼了 arm).
   *  Distinct from 弱み握り (10) — that is the master's grasp on the chara. */
  被掌握把柄: 11,
  /** 合意判定 — per-chara consent-judgment score computed by CHARA_ATTITUDE
   *  (ATTITUDE.ERB:83). Drives both 態度 brackets (line 85-94) and 抱き寄せ's
   *  好意判定値 (ATTITUDE.ERB:148). CFLAG.csv line 18. */
  合意判定: 19,
  態度: 6,
  基本服装SET: 7,
  服装option: 8,
  /** 约会中 — current ODEKAKE/date destination MAPID. 0 = MAIN_MAP / not on a date. */
  约会中: 12,
  /** 认识 — acquaintance flag. 1=met */
  认识: 18,
  宴会参加: 20,
  神社在住: 30,
  /** BIT field: 0=恋慕, 1=恋人, 2=自慰狂, 3=淫壺, 4=尻穴狂, 5=淫乳, 6=接吻魔 */
  引き継ぎ: 31,
  固有コマンド: 35,
  口上実装状況: 36,
  /** 扮演口上有 — whether personal dialogue supports roleplay-player mode. */
  扮演口上有: 373,
  夜這い: 42,
  /** オナバレ — "caught masturbating" flag. Quarters frustration accrual in
   *  欲求不満素質補正 (AFTERTRA.ERB:1185). CFLAG.als id=41. (S-2) */
  オナバレ: 41,
  /** CFLAG.als id=43: ONABARE/NASIKUZUSI marks a consensual join. */
  ヤラせちゃった: 43,
  /** 既成事實 — consent-history BIT field (CFLAG.csv id=1). Bit 1 =
   *  合意_诶嘿嘿 (`DIM.ERH:312 #DIM CONST 合意_诶嘿嘿 = 1p1`): consensual-H
   *  established. ONANISM's type-7 幻想 branch gates on it. */
  既成事實: 1,
  /** 体目当て — "after the body only" (CFLAG.csv id=339). 欲望 demand
   *  ×0.70 (pattern 1) + the 处女觉醒 trigger (AFTERTRA.ERB:162). */
  体目当て: 339,
  /** 子宝補正 — fertility bonus counter (CFLAG.csv id=913). ONANISM bumps it
   *  when 积攒度 stays ≥2000 after the post-masturbation /4 (AFTERTRA:1096). */
  子宝補正: 913,
  勃起度: 284,
  /** 勃起度２ — last turn's 勃起 snapshot. @EVENTCOMEND2:154 each command syncs
   *  `CFLAG:勃起度２ = BASE:勃起` (CFLAG.als id=285). The oracle's batch-3 traces
   *  flagged this: it's master's 勃起 mirrored into CFLAG every command. */
  勃起度２: 285,
  現在位置: 300,
  前一次的位置: 301,
  /** 地位 — rank. 征服/受動 converters branch on TARGET.地位 vs PLAYER.地位. */
  地位: 310,
  初期位置: 311,
  睡眠: 313,
  /** 延迟 — temporary delay flag; blocks 自由行動 and several commands. */
  延迟: 333,
  /** 出禁 — banned from a base (CFLAG.als id=360). A banned chara does NOT lock
   *  their 私室 on sleep (`COMF400.ERB:586-605` skips `CFLAG:出禁`). Not yet
   *  written by any modern path → effectively always 0 (never banned). */
  出禁: 360,
  衰弱: 316,
  /** 徹夜 — all-nighter flag (CFLAG.als id=328). Set when the master didn't
   *  sleep properly; the wake recovery halves 睡眠時間 (`BEFORETRAIN.ERB:347`
   *  `睡眠時間 /= 2`) and the flag is cleared on wake (`BEFORETRAIN.ERB:362`).
   *  The /2 reduction edge is deferred (MVP leaves the flag clear); the id is
   *  wired so the wake path can clear it faithfully. */
  徹夜: 328,
  /** 诶嘿嘿 — playful/intimate interaction mode (うふふ). */
  诶嘿嘿: 317,
  /** 站立式切换 — QOL standing-sex toggle (`CFLAG_STANDING_TOGGLE`, id 9118). */
  站立式切换: 9118,
  /** 勃然大怒 — full anger / rage flag. ERB alias `ブチギレ`. Gates 303 謝る
   *  (must be set to apologize) and is cleared on a successful reconcile.
   *  CFLAG.als:80. */
  勃然大怒: 318,
  同室: 319,
  同行: 320,
  /** 不機嫌 — sulking / bad-mood flag. ERB alias `心情不快`. Cleared by a
   *  successful 303 謝る / 333 愚痴を聞く. CFLAG.als:84. */
  不機嫌: 322,
  /** SakuyaWorld private setting: suppress Sakuya's hate/anger dialogue.
   *  K15C_SAKUYADIM.ERH:14. */
  K15C_憎悪台詞無効: 1101,
  風呂: 323,
  /** 膣内射精 (CFLAG.als:286). Cleared by bathing (`ODEKAKE_OFURO`). */
  膣内射精: 286,
  /** 肛門射精 (CFLAG.als:287). Cleared by bathing. */
  肛門射精: 287,
  /** 口内精液 (CFLAG.als:288). Cleared by bathing. */
  口内精液: 288,
  /** 脸上精液 (CFLAG.als:289). Cleared by bathing. */
  脸上精液: 289,
  /** 手上精液 (CFLAG.als:290). Cleared by bathing. */
  手上精液: 290,
  /** 没穿内裤 — "not wearing panties" flag (AutoConst_CFLAG.ERH:74, id=291).
   *  清于夜结算（AFTERTRA.ERB:77）。 */
  没穿内裤: 291,
  /** 获得胖次 — transient received-panty marker used by confiscation/gift
   *  paths (AutoConst_CFLAG.ERH:78, id=293). */
  获得胖次: 293,
  /** 你的胖次 — master-side panty exchange marker (AutoConst_CFLAG.ERH:80,
   *  id=294). The modern theft path intentionally leaves it unset. */
  你的胖次: 294,
  /** 行动 — current action type. 5=working. */
  行动: 325,
  职场: 326,
  同行準備: 329,
  /** 恶作剧 — "prank" (睡眠恶作剧) mode flag. CFLAG.als id=331. Set by
   *  COMF353 イタズラする (sleep-prank entry); gates other sleep-mode cmds. */
  恶作剧: 331,
  陪睡中: 334,
  /** 招待 — guest/invited flag (CFLAG.als id=336). COMF354 添い寝 reads it to
   *  skip the sleep-induction arm (招待 chara already settled). Defer to 0. */
  招待: 336,
  /** 遭遇位置 — spot-level destination picked by `@遭遇判定` / `@TIMEZONE_MOVE`.
   *  The original stores an odekake point id such as 10/20/210, not a room id. */
  遭遇位置: 337,
  溜まってる度: 340,
  // --- 角色情报看板硬骨头批 (AutoConst_CFLAG.ERH) ---
  /** 继承 — inherited-bond bitfield (bit0 不可思议缘分 / bit1 强烈缘分 /
   *  bits 2..6 肉体情報 per-organ "knows how to please" flags). id=31. */
  继承: 31,
  /** 身体測定 — 0=未测定 / 1=已测定 / 2=要求重新生成系数 (SOMATOMETRY). id=351. */
  身体測定: 351,
  /** バレンタイン — Valentine chocolate record (%100=巧克力种类, >100=已回礼). */
  バレンタイン: 383,
  /** 获得的礼物 — favorite gift id (GIFT_FAVORITE 夜结算写入). */
  获得的礼物: 387,
  /** 送出的礼物 — MASTER 侧计数 (渡した回数*1000+对方). */
  送出的礼物: 388,
  /** 礼物保管库 — latest gift id received (LOOK_GIFT 携带判定). */
  礼物保管库: 389,
  /** 每日礼物 — "already gifted today" per-chara latch (COM_ABLE626 gate). */
  每日礼物: 399,
  処女喪失記念日: 502,
  尻穴処女喪失記念日: 507,
  初吻喪失記念日: 510,
  /** 初吻喪失对手 / ファーストキス喪失相手 (CFLAG.csv id=511). */
  初吻喪失对手: 511,
  /** 初吻喪失対象 / ファーストキス喪失対象 (CFLAG.csv id=512).
   *  `@INIT_STARTINGLV` preserves the special self-loss sentinel `1` when
   *  deciding whether a zero-kiss character should regain キス未経験. */
  初吻喪失対象: 512,
  // 肉体情報 cumulative semen counters (ml) — written by the ejaculation
  // settlement (`semen-residue.ts::depositEjaculate`, porting upstream
  // SOURCE_射精確定後処理; drives the nightly 精液中毒升级 thresholds).
  累計膣内精液: 515,
  累計肛門精液: 516,
  累計精飲: 517,
  累計精浴: 518,
  /** 累計膣内射精 — sender-side lifetime 中出し volume (CFLAG.als:519). */
  累計膣内射精: 519,
  强行内射: 530,
  /** 生理周期 — 0..9 estrus cycle stage (肉体情報_W 危险日梯). */
  生理周期: 900,
  /** 子宮内精子 — persistent uterine-semen flag (AutoConst_CFLAG.ERH:443, id=901).
   *  JYCL 保留路径写它；默认 JYCL==0 时夜结算清零。 */
  子宮内精子: 901,
  /** 無自覚妊娠 — pregnancy is not yet consciously recognized (CFLAG.csv id=906). */
  無自覚妊娠: 906,
  身に覚え_母: 910,
  /** 身に覚え_父 — donor consciously recognizes the pregnancy (CFLAG 915). */
  身に覚え_父: 915,
  /** 産休タイプ — work-leave threshold: 0/30日, 1/40日, 2/60日, -1/none. */
  産休タイプ: 916,
  妊娠経過日数: 903,
  産休中: 914,
  出産経過日: 908,
  育児人数: 909,
  兒童人数: 912,
  誰の子: 917,
  胎児愛情値: 534,
  乳ランクアップ: 904,
  回復速度降低: 905,
  妊娠による追加サイズ: 907,
  WithChildCount: 9170,
  /** 時間停止行動 — per-chara "acted on during time-stop" flag (CFLAG.csv
   *  id=344). 時間停止解除 (TIMESTOP_RESET tail) zeroes it for every chara
   *  on release (P-16, Parity QA Wave 8). Set by the H-mode time-stop
   *  actions (deferred). */
  時間停止行動: 344,
  /** 時間停止バレ — whether the character noticed the time-stop intrusion.
   *  Used by the upstream release settlement for the one-time relationship
   *  reaction. */
  時間停止バレ: 345,
  自慰过了: 347,
  职种: 350,
  来訪時間: 352,
  帰宅時間: 353,
  就寝時間: 354,
  起床時間: 355,
  /** よく行く地域 — favorite map id used by `@遭遇フラグ決定` (0=神社, 2=人間之里). */
  よく行く地域: 356,
  自宅位置: 358,
  /** 拠点来訪 — set by `@来訪フラグ` (来訪フラグ.ERB) each morning for the NPCs
   *  who will drop by the master's base today; consumed by `@主人公物件へ向かう`
   *  (placement) and cleared by `@KITAKU` (departure). CFLAG.als id=359. */
  拠点来訪: 359,
  /** 翌日来訪 — "will visit tomorrow" reservation (危険日 KIKENBIHOUMON / 祈願).
   *  A Phase-1 guaranteed-visit input. CFLAG.als id=362. */
  翌日来訪: 362,
  /** 最後に来訪した日 — DAY of this chara's last visit; drives the recency
   *  damping in `@来訪フラグ` (visits clump less). CFLAG.als id=365. */
  最後に来訪した日: 365,
  /** 最後に会った日 — DAY of this chara's last in-person meeting. Stamped by
   *  @ONABARE (NASIKUZUSI.ERB:6) and other meeting ceremonies. CFLAG.csv id=384. */
  最後に会った日: 384,
  /** Hatate's authored food-report progress gate (`固有依頼042`, CFLAG 1005). */
  はたて美食記事: 1005,
  /** 来訪抑制値 — extra divisor added to the visit RAND (raises = less likely).
   *  CFLAG.als id=366. */
  来訪抑制値: 366,
  /** 来訪不能 — hard "cannot visit" flag (kojo-driven). CFLAG.als id=379. */
  来訪不能: 379,
  /** 依頼状況 — commission state; ==3 (達成) forces a guaranteed visit in
   *  `@来訪フラグ` Phase 1. CFLAG.als id=403. */
  依頼状況: 403,
  /** 依頼内容 — `MAKE_IRAI_ID(client, localId)`, paired with 依頼状況. */
  依頼内容: 404,
  /** 依頼対象1..9 — accepted request target mirrors (`CFLAG:411..419`). */
  依頼対象1: 411,
  依頼対象2: 412,
  依頼対象3: 413,
  依頼対象4: 414,
  依頼対象5: 415,
  依頼対象6: 416,
  依頼対象7: 417,
  依頼対象8: 418,
  依頼対象9: 419,
  /** 移動率補正 — per-chara additive bonus to the base in-base move rate
   *  (`@角色移動率` line 377). CFLAG.als id=363. */
  移動率補正: 363,
  /** 移動節度 — privacy restraint level for roaming (`@角色移動率` line 421-441).
   *  ≥1 avoids 過疎; ≥0 avoids others' プライベート rooms; -2 = goes everywhere.
   *  CFLAG.als id=364. */
  移動節度: 364,
  最后见面的日子: 384,
  喜欢的体位: 500,
  恥じらい: 550,
  别颜有: 562,
  别立有: 563,
  /** 潜伏状態 — per-chara stealth BIT (CFLAG.als id=526). bit0 set by COMF356
   *  物陰に誘う (`SETBIT CFLAG:TARGET:潜伏状態,0`). */
  潜伏状態: 526,
  /** 睡眠姦 — sleep-sex mode tier (CFLAG.als id=527; 0=none 1=恶作剧 2=睡眠姦).
   *  Set to 1 by COMF353 イタズラする (floor at 1). */
  睡眠姦: 527,
  /** 性格傾向 — personality-clique id (CFLAG.als id=560). COMF850 抜け出す
   *  branches the display on it (1=气弱 2=强气 3=坦率 4=真面目 5=其他). Defer to 0. */
  性格傾向: 560,
  /** 変化先 — shape-shift target charaNum (CFLAG.als id=950). COMF358 他者変身
   *  sets/clears it; 0 = original form. */
  変化先: 950,
  /** 変化元 — previous shape-shift target (CFLAG.als id=951). Snapshotted on
   *  change so a revert restores it. */
  変化元: 951,
  /** 口上セレクタ — KOJO variant selector. 0=default, 1-3=variant. */
  口上セレクタ: 998,
  /** 弾幕勝負勝利 — set after MASTER first defeats this character in COMF480. */
  弾幕勝負勝利: 930,
  /** 斗虫直接勝利 — insect-battle win count (CFLAG id=932).
   *  Displayed as ★ in BASIC_STATE. */
  斗虫直接勝利: 932,
  /** 料理勝負勝利 — cooking-battle win count (CFLAG id=933).
   *  Displayed as ★ in BASIC_STATE. */
  料理勝負勝利: 933,
  /** 弾幕特能 — bitset of danmaku battle traits. Read by the full battle system. */
  弾幕特能: 931,
  /** 着替え実行 — bit0/bit1 clothing-change marker used by SET_SLEEP and
   *  CHARA_AWAKE. Modern sleep currently only resets fatigue/depth; the id is
   *  named here so the remaining clothing slice has a stable hook. */
  着替え実行: 700,
  /** 衣装一時変更 — temporary outfit override. `K30_CHECK_HEN_T` treats 62
   *  as Eiki's exceptional outfit. CFLAG.als id=656. */
  衣装一時変更: 656,
  /** 清醒劑 — sobriety counter, raised +180 by `清醒/` dish taste
   *  (COMF414 吃飯 non-DLC). CFLAG.als id=385. Consumer (醒酒) not yet ported. */
  清醒劑: 385,
  /** 今日の運勢 — today's fortune score (0-999), nudged by `奇跡/`/`幸運/` dish
   *  taste. CFLAG.als id=378. Consumer (運勢) not yet ported. */
  今日の運勢: 378,
  /** 不會喝酒 — "can't-handle-drink" counter (COMF332 お酒をふるまう). Raised
   *  +1 when a palatable alcohol (TASTE>=15) is drunk; lowered -1 when a
   *  TASTE<10 alcohol is drunk by a 下戸 (酒耐性==-2). At >=5 a 下戸 will drink
   *  anyway. CFLAG.csv line 246. */
  不會喝酒: 529,
  /** 烂酔奸 — "drunk-rape" flag (COMF332 refusal arm). ==2 && !恋慕 → target
   *  refuses further drinking. CFLAG.csv line 245. */
  烂酔奸: 528,
  /** 妊娠自覚状態 — pregnancy-awareness state. ==1 blocks COMF332. CFLAG.csv
   *  line 316. */
  妊娠自覚状態: 911,
  // ── Act_COM 过滤器 (per-target; Parity QA P-1) ──────────────────────
  // The command-grid filter toggles (`@过滤器表示`, OPTION_COM_FILTER.ERB:71).
  // Each is "on by default"; toggling it OFF hides that command class from
  // the Act_COM grid (`@QUICKFILTER` subtracts). CFLAG.csv 266-275.
  /** Ｖ過濾器 — show 膣 (V) commands. CFLAG.csv:266. */
  Ｖ過濾器: 591,
  /** Ａ過濾器 — show 肛門 (A) commands. CFLAG.csv:267. */
  Ａ過濾器: 592,
  /** 奉仕過濾器 — show 奉仕 (service) commands. CFLAG.csv:270. */
  奉仕過濾器: 595,
  /** ＳＭ過濾器 — show ＳＭ commands. CFLAG.csv:271. */
  ＳＭ過濾器: 596,
  /** 性騷擾過濾器 — show 性骚扰 (sekuhara) commands. CFLAG.csv:273. */
  性騷擾過濾器: 597,
  /**
   * @deprecated Use `没穿内裤` (291). Older modern tests called this alias
   *  "NO_PANTIES_TODAY", but upstream's actual no-panties marker is CFLAG 291.
   */
  NO_PANTIES_TODAY: 291,
  /** Remembered normal-outfit panty type (upstream raw CFLAG:206). */
  当前衣装内裤: 206,
  /** Remembered sleep-outfit panty type (upstream raw CFLAG:246). */
  睡眠衣装内裤: 246,
  /** Current-day panty selector (`CFLAG:きょうのぱんつ`, id 651). */
  きょうのぱんつ: 651,
  /** Sleep panty selector (`CFLAG:睡衣胖次`, id 652). */
  睡衣胖次: 652,
  /** Explicit selected panty (`CFLAG:指定胖次`, id 653). */
  指定胖次: 653,
  /** allowKojoCom — show 個人口上 custom commands (270-299). CFLAG.csv:275. */
  allowKojoCom: 599,
  /** ただならぬ開放感ソース追加 — one-shot time-stop panty reaction latch. */
  ただならぬ開放感ソース追加: 295,
} as const;

/** Top-level FLAG ids (global state, not per-chara). From `FLAG.als`. */
export const FLAG_ID = {
  妊娠開关: 1025,
  妊娠日程倍率: 1056,
  兒童の性別: 1065,
  住宿人物: 15,
  宴会開催FLAG: 30,
  /** Selected alcohol contributed by Reimu's banquet commission (FLAG 37). */
  宴会差し入れ: 37,
  /** Canonical event-start flag (AutoConst_FLAG id 1). */
  SYS_EVENT起動FLAG: 1,
  /** ファッション — global outfit selection. `K30_CHECK_HEN_T` treats 62
   *  as Eiki's exceptional outfit. FLAG.als id=880. */
  ファッション: 880,
  /** 扮演 — roleplay target charaNum. 0 = vanilla ANATA route. */
  扮演: 1030,
  /** 開始時間 — event-start absolute time (FLAG.csv id=43). Set to 3 by
   *  EVENTTURNEND's `FLAG:1 = 3` non-shrine-resident fall-state flag,
   *  signaling "the membership-add event should fire". */
  開始時間: 33,
  /** 魔法强度 — magic-power level (FLAG.als id=1098, DLC). COMF233 五重绝顶魔法
   *  floors every pleasure SOURCE at `MAX(FLAG:魔法强度, 1000)`. Set by the DLC
   *  magic-DLC option menu; defaults 0 in a non-DLC trial → MAX(0,1000)=1000.
   *  Modeled in `flagStore`. */
  魔法强度: 1098,
  /** 魔法印记开关 — magic-mark toggle (FLAG.als id=1099, DLC). When on, COMF233
   *  sets `SOURCE:魔力印记 = 1` (the magic-mark settlement arm). Modeled in
   *  `flagStore`. */
  魔法印记开关: 1099,
  /** Five_Orgasm_Magic — DLC global SAVEDATA (not a FLAG; lives in `DLC.ERH`).
   *  0=off / 1=正常 / 2=EX / 3=EX-PANI. `@COM_ABLE233` gates `== 0 → RETURN 0`.
   *  Modeled in `flagStore` under sentinel id 9001 (outside the FLAG/TFLAG
   *  ranges; trial never sets it → execCheck blocks, faithful to DLC-off). */
  五重绝顶魔法: 9001,
  /** おもらし有効 — omorashi (urination) option toggle. `@COM_ABLE144` gates
   *  `FLAG:おもらし有効 == 0 → RETURN 0`. Off by default → COMF144 放尿 is
   *  unreachable in a clean trial (faithful). FLAG.csv id=1075. */
  おもらし有効: 1075,
  /** 本日の累計好感度上昇量 — today's total favor increase. */
  好感度上昇率: 28,
  /** 難易度 — global difficulty (FLAG.csv id=4). Scales the 反発刻印 好感度/
   *  信頼度 penalty: `(FLAG:難易度 + 1) * MARK:反発刻印`. Default 0 in a clean
   *  state → coefficient 1. Modeled in `flagStore`. */
  難易度: 4,
  /** 每日变更事件 — daily random-event selector used by Ellen's forest job. */
  每日变更事件: 9,
  /** 時間停止 — global time-stop active. */
  時間停止: 70,
  /** 收藏隙間 — portable collection-gap ownership/date marker. */
  收藏隙間: 86,
  /** C隙間自動仕様 — automatically send acquired panties to the gap. */
  C隙間自動仕様: 87,
  /** 澆水代行 — ホフゴブリンに依頼: 家庭菜園 watering proxy for the month. */
  澆水代行: 85,
  /** 天滴坤神 — 三粒の天滴 blessing armed (COMF418 planting/watering sets it;
   *  YASAI's dry-rescue + HERVEST's +2 grow roll consume it).
   *  `AutoConst_FLAG.ERH:118 #DIM CONST FLAG_天滴坤神 = 590`. */
  天滴坤神: 590,
  /** 上门清扫 — ホフゴブリンに依頼: current-map cleaning proxy. */
  上门清扫: 214,
  /** 家事過濾器 — show 家事 (chore) commands in Act_COM. GLOBAL (not per-target,
   *  unlike the other filters). On by default; toggling OFF hides chore
   *  commands. Parity QA P-1. FLAG.csv:250 id=1055. */
  家事過濾器: 1055,
  /** オナ禁 — masturbation-prohibition counter. COMF421 option 1 (精力精力超群)
   *  does `FLAG:71 ++`; option 2 (心の平安) resets `FLAG:71 = 0`. FLAG.als id=71. */
  オナ禁: 71,
  /** 祈願内容 — today's wish content. Named alias for FLAG:560
   *  (`AutoConst_FLAG.ERH:105 #DIM CONST FLAG_祈願内容 = 560`). COMF421 sets it;
   *  COM_ABLE421 gates `FLAG:祈願内容 > 0` (= already wished today).
   *  Values: 0=none, 201=心の平安, 202=内裤扫除, 203=H气氛 (+patch values).
   *  Reset to 0 daily by `BEFORETRAIN.ERB:523`. */
  祈願内容: 560,
  /** 精力強化回数 — 精力 wish bonus counter. COMF421 option 1: when
   *  `FLAG:561 < 11` and EXP:11 threshold met, `FLAG:561 += 1` (+100 bonus).
   *  FLAG.als id=561. Option 2 (this MVP) does not touch it. */
  精力強化回数: 561,
  /** おみくじと守矢くじ関係 — COMF434 BIT field (FLAG.als id=999).
   *  bit0 = 告示既読 (first-visit notice shown), bit1 = 今日已抽 (1/day gate),
   *  bit10 = 当たり (set by FORTUNE → triggers 200 円 refund). */
  おみくじ: 999,
  /** 守矢神簽約会的対象 — Moriya shrine lottery date target (CHARA_ATTITUDE/抱き寄せ
   *  bypass arm). Defer to 0 unless explicitly set. FLAG.csv line 190. */
  守矢神簽約会的対象: 998,
  /** 地主 — landowner flag. NOUMIN.ERB landlord-farming subsystem is
   *  deferred, so this flag is always 0 in the current build. The crop-damage
   *  system now gates on kitchen-garden plots (hasPlantedCrops) instead of
   *  this flag. FLAG.csv id=820. */
  地主: 820,
  /** 田地工作的成果 — accumulated field-work yield from COMF470 (deferred).
   *  Not used by the kitchen-garden crop-damage system. FLAG.csv id=821. */
  田地工作的成果: 821,
  /** 甲斐性無 — "no guts" — master cowardice flag (COM_ABLE350 line 430). If 1,
   *  押し倒す / most H-entry commands are gated off. FLAG.csv line 238. */
  甲斐性無: 1040,
  /** 追加恋人枠 — extra lover slots beyond the default 1 (CAN_MAKE_恋人,
   *  DATE_CMN.ERB:294-302). FLAG.csv id=50. */
  追加恋人枠: 50,
  /** 立絵種類 — portrait kind (AutoConst_FLAG.ERH:288 `#DIM CONST FLAG_立絵種類
   *  = 1047` / CSV/FLAG.als:246). 0=立絵 (full-body), 1=顔絵 (face). GET_BASESTYLE
   *  (IMAGE.ERB:862-894) picks the resource-name prefix; CALC_EXPRESSION_CORE
   *  layers (QOL_IMAGE.ERB) resolve the expression. Stored in `flagStore`. */
  立絵種類: 1047,
  /** NEWGAME_OPTION bitfield initialized before the opening option loop. */
  NEWGAME_OPTION初期化: 1000,
  /** 潜伏 — stealth/ambush mode BIT field (FLAG.als id=99). bit0 = 潜伏中.
   *  Set by COMF356 物陰に誘う (`SETBIT FLAG:潜伏,0`) which opens the うふふ
   *  潜伏 scene; cleared on exit. COM_ABLE356 gates `GETBIT(FLAG:潜伏,0)`.
   *  Modeled in `flagStore`. */
  潜伏: 99,
  /** 催眠強度 — hypnosis strength (CHARA_ATTITUDE line 84 adds ×4 to 合意判定;
   *  押し倒す催眠 bypass arm). Defer to 0 unless explicitly set. FLAG.csv line 305. */
  催眠強度: 9021,
  /** デート相手 — current single-date partner charaNum (FLAG.als id=73).
   *  `IS_DATING_WITH_PLAYER` consumes this canonical flag; MOREDATES group
   *  rosters remain deferred. */
  デート相手: 73,
  /** 新聞購読 - whether the player receives authored newspaper notices. */
  新聞購読: 75,
  /** 気絶中断 — fainted/interrupted sleep marker. BEFORETRAIN divides sleep
   *  recovery time by 5 and then clears this flag. */
  気絶中断: 200,
  /** 抱負 — new-year resolution buff (FLAG.csv id=72). ==1 → 中毒-ABL jewel
   *  demand ×0.75 (ABL_UP_DATA.ERB:1837). */
  抱負: 72,
  /** 無知自動喪失禁止 — "never auto-lose 無知" option (FLAG.csv id=1062).
   *  Gates the ONANISM 無知-loss arm (AFTERTRA.ERB:935). */
  無知自動喪失禁止: 1062,
  /** 自室施錠 — master locked their own private room (FLAG.csv id=1021).
   *  @INFO_SITUATION shows `<已锁门>`. READ-SIDE ONLY: the 自锁房 write-side
   *  mechanism is not modeled yet, so the tag stays dormant until then. */
  自室施錠: 1021,
  /** 異常気象 — abnormal-weather overlay (FLAG.als id=77). 0=none; 1-5=DLC
   *  sensitive-only (deferred); 6=裙子 event; 7=胖次 (pantsu blown);
   *  8=桃色之风 (PINK_WIND raises CFLAG:积攒度 + TCVAR:発情);
   *  9=台風 (WeatherBCg 理性 -1/turn outdoor); 10=暴風雪 (精 -1/turn);
   *  11=钻石尘 (sleep recovery ×0.5); 12=黄沙 (気力 -1/turn);
   *  13=烈日 (体力 -1/turn); 14=極光 (TSP -1/turn).
   *  Wired by weather-system S1 (2026-07-02). Modeled in `flagStore`. */
  異常気象: 89,
  /** 最後に酒屋に訪れた日 - persistent liquor-store visit marker. */
  最後に酒屋に訪れた日: 861,
  /** 酒屋買取強化 - remaining boosted-purchase days. */
  酒屋買取強化: 865,
  /** 折畳伞耐久度 — foldable-umbrella durability (FLAG.als id=189, the
   *  `ITEM:折畳伞耐久度` slot). Decrements in `WEATHERCHECK` per weather
   *  (-1 雾雨 / -5 雨雪 / -50 大雨-暴雨-暴風雪). Defer: not wired in S1. */
  折畳伞耐久度: 189,
  /** 背景色推移 — background-color shift counter (FLAG.als id=133). Used by
   *  `SET_MAP_WEATHER_BGCOLOR` to step the map's CSS color over time. Defer:
   *  UI stage (S6). Modeled in `flagStore`. */
  背景色推移: 1077,
  /** 市場の神 — market-god flag (FLAG.als id=124). Used by 魔理沙/Marisa
   *  marketplace weather roll. Defer. Modeled in `flagStore`. */
  市場の神: 874,
  /** WEATHERDLC — DLC weather-patch on/off (FLAG.als id=78). 0 = non-DLC path
   *  (16-weather table); 1 = DLC path (23-weather + extra branches).
   *  Modern runtime uses non-DLC path → default 0. Modeled in `flagStore`. */
  WEATHERDLC: 78,
  /** チュート文累計 — read by `SleepSoundly` to cap the sweet pillow bonus. */
  チュート文累計: 591,
  /** 出禁人数 — global count of banned (出禁) characters. `@来訪フラグ` derives
   *  the base visit rate from its ratio to CHARANUM. FLAG.als id=1023.
   *  Modeled in `flagStore` (0 in a fresh game). */
  出禁人数: 1023,
  /** 交流来訪模式 — visit mode: 0/1 favor-gated (好感度>50), 2 relationship-only,
   *  3 off. `@来訪フラグ` + `@来訪可能` read it. FLAG.als id=1024. Default = 1.
   *  Modeled in `flagStore`. */
  交流来訪模式: 1024,
  /** 脱衣選択 — undress quick-mode (USERCOM 820). 0=picker, 1=always full,
   *  2=always half. FLAG.als id=1027. Set via OPTION menu. */
  脱衣選択: 1027,
  /** 胖次泥棒 — panty confiscation mode. 0=ask each time (ASK_YN MVP→drop),
   *  1=auto confiscate, 2=only remove. FLAG.als id=1029. Set via OPTION menu. */
  胖次泥棒: 1029,
  /** 獲得胖次種数 — total unique panty species in permanent collection.
   *  FLAG.als id=700. Recounted by COMF401. */
  獲得胖次種数: 700,
  /** 胖次BONUS取得状況 — bitmask of claimed collection bonuses.
   *  FLAG.als id=705. CHECK_BONUS_2. */
  胖次BONUS取得状況: 705,
  /** 胖次輸送 — panties are in transit (PANTS_TEMP non-empty). FLAG.als id=853.
   *  Set by PANTS_GETTING, cleared by COMF401. */
  胖次輸送: 853,
  /** 宴会会場 — banquet venue map id. `@来訪フラグ` Phase 1: a 宴会参加 guest
   *  visits iff `IN_HOME(宴会会場)`. FLAG.als id=32. The modern banquet
   *  scheduler mirrors this field while an event is active. */
  宴会会場: 32,
  /** 借书借出 — bitmask of which 鈴奈庵 books are checked out (bit N = book N,
   *  N=1..10 ↔ item 100+N). FLAG.als id=1011. Modeled in `flagStore`. */
  借书借出: 1011,
  /** 借书返还期限 — the held book's return deadline (8 = just borrowed, 1 week).
   *  FLAG.als id=1012. Base game has no auto-decrement writer (the loan holds
   *  until you borrow another), so this is a display/extend value. flagStore. */
  借书返还期限: 1012,
  /** 陥落路線変化 — fall-state route-change permission (FLAG.als id=1060).
   *  Blocks automatic `infeasible` markings in the fall-state display. */
  陥落路線変化: 1060,
  宴会的有無: 3,
  宴会开始日: 34,
  宴会開催フラグ: 30,
  宴会会場開始時刻: 33,
  /** Modern convenience mirrors; upstream has no dedicated end-day slots. */
  宴会終了日: 38,
  宴会終了時刻: 39,
  宴会规模: 31,
  宴会参加者数: 35,
  加護: 90,
  土産屋特价销卖: 872,
  banquetEnabled: 3,
  banquetStartDay: 34,
  banquetTemplate: 30,
  banquetVenueStart: 33,
  banquetEndDay: 38,
  banquetEndTime: 39,
  banquetScale: 31,
  banquetParticipantCount: 35,
  blessing: 90,
  souvenirSale: 872,
  marketGod: 874,
} as const;

export const EVENT_FLAG_ALIASES = {
  宴会的有無: 3,
  宴会开始日: 34,
  宴会開催フラグ: 30,
  宴会会場開始時刻: 33,
  宴会終了日: 38,
  宴会終了時刻: 39,
  宴会规模: 31,
  宴会参加者数: 35,
  加護: 90,
  土産屋特价销卖: 872,
  市場の神: 874,
  banquetEnabled: 3,
  banquetStartDay: 34,
  banquetTemplate: 30,
  banquetVenueStart: 33,
  banquetEndDay: 38,
  banquetEndTime: 39,
  banquetScale: 31,
  banquetParticipantCount: 35,
  blessing: 90,
  souvenirSale: 872,
  marketGod: 874,
} as const;

/** BASE ids used in settlement. All values from `Base.als`. */
export const BASE_ID = {
  体力: 0,
  気力: 1,
  射精: 2,
  母乳: 3,
  尿意: 4,
  勃起: 5,
  精力: 6,
  法力: 7,
  TSP: 8,
  情緒: 10,
  理性: 11,
  憤怒: 12,
  仕事量: 13,
  深度: 14,
  酒気: 15,
  /** 絶頂余韻 — post-climax afterglow (AutoConst_Base.ERH:51, id=35).
   *  `@INFO_EMOTION` 高潮余韵显示用。 */
  絶頂余韻: 35,
  // --- 三围 (SIZE.ERB header: BASE:20..24 hold the computed measurements;
  //     MAXBASE:20..24 hold the ×1000 coefficients MAKE_SIZE generates) ---
  身長: 20,
  体重: 21,
  /** バスト (Base.csv:22). NOTE: TALENT_ID.胸围 is the cup-size TALENT;
   *  this is the computed BASE measurement (mm). */
  胸圍: 22,
  腰圍: 23,
  臀圍: 24,
  /** 潜伏率 — stealth success rate (Base.als id=16). Set to 100 by COMF356
   *  物陰に誘う on ambush entry. */
  潜伏率: 16,
} as const;

/**
 * TCVAR ids used in 5C settlement. All values from `TCVAR.als`.
 *
 * **WARNING — label divergence on id 315.** The `.als` file labels
 * id 315 as `手伝えない` ("cannot help" — a binary flag), but the
 * work command uses `TCVAR:MASTER:315` as the master's
 * wage-accumulated `帮忙工作量` (accumulator). Same slot, two
 * different names depending on character scope. ERB reference:
 * `COMF304 仕事を手伝う.ERB` line 421.
 *
 * Id 323 is genuinely the same concept under two names: `.als` says
 * `手伝った量` ("amount helped") and the ERB variable alias is
 * `帮忙工作量` ("work done"). Both mean "target's accumulated work".
 */
export const TCVAR_ID = {
  /** 清掃経験 — daily cleaning mirror used by GO_OUT_EV05. */
  清掃経験: 70,
  /** 强行 — command-local coercion marker read by authored acceptance
   * helpers such as Ruukoto's K2_CONSCIOUS_AND_TOLERANT. TCVAR.als id=200. */
  强行: 200,
  /** 口服避孕薬 — command/day contraception marker (TCVAR.csv id=109). */
  口服避孕薬: 109,
  /** 避孕魔法 — MAGIC_DLC-only contraception marker (id=210). The current
   * non-DLC runtime deliberately does not activate this arm. */
  避孕魔法: 210,
  /** `DATUI_MESSAGE` target flags. When all four are zero, the shared
   * COUNTER dispatcher enters EVENT_COUNTER_MESSAGE with `有主语 = 0`. */
  脱衣主角下半身: 22,
  脱衣目标下半身: 23,
  脱衣主角上半身: 24,
  脱衣目标上半身: 25,
  /** MASTER's wage-accumulated `帮忙工作量` (ERB: `TCVAR:MASTER:帮忙工作量`).
   *  `.als` label is `手伝えない` (binary flag) — see warning above. */
  帮忙工作量_MASTER: 315,
  /** TARGET-side meaning of the same slot: 1 blocks COM304, while 2 lets
   * the command run without reducing the target's remaining workload. */
  没法帮忙: 315,
  /** TARGET's wage rate / multiplier (ERB: `TCVAR:TARGET:工资`).
   *  `.als` label is `給料` (Japanese for salary). */
  工资: 316,
  /** TARGET's work-done accumulator (ERB: `TCVAR:TARGET:帮忙工作量`).
   *  `.als` label is `手伝った量` ("amount helped") — same concept. */
  帮忙工作量_TARGET: 323,
  /** Work-lifecycle setup fields from `JOB_仕事内容.ERB`. */
  工作的有無: 322,
  工作礼物: 324,
  工作開始: 325,
  工作結束: 326,
  /** TARGET's running 会話 accumulator (ERB: `TCVAR:301`, .als 会話累計値).
   *  COMF300 会話 / COMF23 ピロートーク add to it each talk. The scheduler
   *  (`MOVEMENT_SUB.ERB`) decays it by TIME_PROGRESS and, while it is `> 100`,
   *  raises the SEPARATE `会話不能` (302) gate; once it hits 0 it clears 302.
   *  That 301→302 conversion is Phase-8 WorldScheduler territory and is NOT
   *  modeled here — handlers accumulate into 301 and read the gate from 302. */
  会話累計: 301,
  /** TARGET's "can't-talk" fatigue gate (ERB: `TCVAR:302`, .als 会話不能).
   *  0 = talkable, ≥1 = non-恋慕 talk refused. The scheduler derives it from
   *  会話累計値 (301) `> 100`; COMF23 ピロートーク / COMF300 会話 read it but
   *  do NOT set it directly (the >100→1 conversion is the deferred Phase-8
   *  scheduler tick — see 会話累計 above). Kept distinct from 301 so the
   *  fatigue early-return doesn't trip on the same turn the accumulator grows. */
  会話不能: 302,
  /** Last-tea-brewed timestamp (ERB: `TCVAR:300 = 1440*DAY+TIME`, .als 饮茶时刻).
   *  Gates COMF301 お茶を淹れる's `TIME_PROGRESS(TCVAR:300) < 60 → RETURN 0`
   *  60-minute cooldown. Tracked on the served chara (TARGET) when one is
   *  present, else on MASTER for the solo-tea (P-20) path. */
  饮茶时刻: 300,
  /** TARGET's last-head-patted timestamp (ERB: `TCVAR:304 = 1440*DAY+TIME`).
   *  Gates COMF309's 1-hour cooldown. (5E) */
  摸頭時刻: 304,
  /** TARGET's last-skinship timestamp (ERB: `TCVAR:303 = 1440*DAY+TIME`).
   *  Gates COMF302's 1-hour cooldown. (7A) */
  身体接触時刻: 303,
  /** TARGET's drunk flag (ERB: `TCVAR:泥酔`). Used by SHIRAHU() in
   *  COMMON.ERB:833 to refuse interactive actions when set. TCVAR.als id=145. */
  泥酔: 145,
  /** 睡眠薬強度 — sleeping-drug strength; SET_SLEEP multiplies 睡眠深度 by it. */
  睡眠薬強度: 148,
  /** 睡眠深度 — current sleep depth, reset on SET_SLEEP(0). */
  睡眠深度: 149,
  /** 疲労度 — fatigue counter, reset on SET_SLEEP(0). */
  疲労度: 151,
  /** 休憩中 — weakened/resting marker cleared once stamina recovers above half.
   *  TCVAR.csv id=328. */
  休憩中: 328,
  /** お宅訪問 — "visited a home today" 1/day latch (TCVAR.als id=329). COMF697
   *  部屋を訪ねる stamps it so the visit ceremony only runs once per day. */
  お宅訪問: 329,
  /** 弾幕勝負結果 — last danmaku result for the target (-1 lose / 1 win). */
  弾幕勝負結果: 296,
  /** 弾幕勝負不能 — target has already done a danmaku battle today. */
  弾幕勝負不能: 297,
  // --- cooking / meal subsystem (B7-eat, COMF414/415) — TCVAR.als ---
  /** 空腹時刻 — hunger-clock timestamp (`1440*DAY+TIME+満腹度`). Eating sets
   *  it forward; `TIME_PROGRESS(空腹時刻)` (hungry now?) gates 414/415. id=312. */
  空腹時刻: 312,
  /** 甜点空腹時刻 — separate hunger clock for 甜点 (desserts don't sate the
   *  main-meal clock). id=313. */
  甜点空腹時刻: 313,
  /** 料理評価値 — this chara's evaluation of the current dish (0-999). Set by
   *  REVIEW_DISH (non-master) or the KOJO pre-loop; drives COM414_実食 SOURCE +
   *  吃飯 recovery multiplier. id=306. */
  料理評価値: 306,
  /** 前回料理評価値 — previous evaluation (snapshot). id=308. */
  前回料理評価値: 308,
  /** 料理评价补正 — DLC (MAGIC_DLC_料理相关) kojo-side evaluation override.
   *  Non-DLC path leaves it 0. id=212. */
  料理评价补正: 212,
  /** 祝福 — dish-granted buff flag (妊娠率↑; consumer = pregnancy subsystem,
   *  not yet ported). TCVAR.als id=341. Set by `祝福/` taste tag. */
  祝福: 341,
  /** 附魔 — dish-granted buff flag (弾幕 骰子目↑). id=342. Set by `附魔/` tag. */
  附魔: 342,
  /** 加護 — dish-granted buff flag (弾幕 对手骰子目↓). id=343. Set by `加護/` tag.
   *  (Distinct from FLAG:加護=90 — the player buff; this is the per-chara TCVAR.) */
  加護: 343,
  /** 豊穣 — dish-granted buff flag (野菜収穫量↑). id=344. Set by `豊穣/` tag. */
  豊穣: 344,
  /** なるべく動かない — "try not to move" flag set after eating. id=185. Also
   *  set to 1 after any roam move (roam.ts) to prevent back-and-forth flicker. */
  なるべく動かない: 185,
  /** 引力点 — gravity-point destination (TCVAR.csv id=97). When set, NPC
   *  gradually moves toward it (multi-hop pathfinding). 0 = no gravity point. */
  引力点: 194,
  /** 追い出され地点 — "evicted-from" location (TCVAR id not in .als, bare int).
   *  After ワンルーム eviction, the evicted chara avoids re-entering this room.
   *  Cleared on next roam. */
  追い出され地点: 193,
  /** 寄り道日時 — COMF605 寄り道's last-use timestamp (`1440*DAY+TIME`).
   *  `@COM_ABLE605` blocks on `TIME_PROGRESS(TCVAR:309) < 30` (30-min
   *  cooldown). TCVAR.als id=309. */
  寄り道日時: 309,
  /** 随便 — "anything goes" BIT field (TCVAR.als id=320). bit0 set during
   *  partner-led (诶嘿嘿==2) H mode; COMF850 抜け出す reads `GETBIT(随便,0)`
   *  for the struggle arm. Per-chara (target scope). */
  随便: 320,
  /** Counter行動 — current counter-action id (TCVAR.als id=20). The
   *  partner-led (诶嘿嘿==2) counter subsystem index; COMF360/361 read it to
   *  pick the COUNTER_SIKOU slot to nudge. Defer to 0 (no counter active). */
  Counter行動: 20,
  // --- H-mode insertion / thrust (COMF317 腰を動かす V, COMF318 …Ａ) — TCVAR.als ---
  /** 射精箇所 — ejaculation-site flag (TCVAR.als id=2). -1=避孕套 1=膣内
   *  2=肛門 3=手淫 4=口淫 5=乳交 6=素股 7=足交 8=体表 9=肛門奉仕 10=道具
   *  11=触手 12=Ａ責め 13=Ｖ責め. Set on both PLAYER (where master cums)
   *  and TARGET (where target is being stimulated) by thrust commands. */
  射精箇所: 2,
  /** 射精快感強度 — thrust strength (TCVAR.als id=4). `500 + ABL:腰*50 +
   *  ABL:膣(or 肛門)*50` on PLAYER; flat 1500 on TARGET. */
  射精快感強度: 4,
  /** V挿入管理フラグ — "PLAYER is inserted into TARGET's V" (TCVAR.als id=100).
   *  Set = PLAYER by the insertion command; `@COM_ABLE317` gates on
   *  `TCVAR:TARGET:100 == PLAYER`. (Insertion itself deferred → COMF317/318
   *  execCheck reads it but trial never sets it; the bare id is modeled so
   *  the gate is faithful.) */
  V挿入管理: 100,
  /** A挿入管理フラグ — anal-insertion mirror of {@link V挿入管理} (id=101).
   *  `@COM_ABLE318` gates on `TCVAR:TARGET:101 == PLAYER`. */
  A挿入管理: 101,
  /** 行為者 — "who is acting this turn" (TCVAR id=116, bare int — no .als
   *  label). PLAYER for master-initiated thrust. COMF317/318 set
   *  `TCVAR:116 = PLAYER` (=0, the master index) each thrust. */
  行為者: 116,
  /** 亲热 — intimacy intensity on the actor (TCVAR.als id=130). `@COM_ABLE317`
   *  requires `TCVAR:MASTER:亲热 >= 2` (unless sleeping). Set by the foreplay
   *  ladder; deferred (clean trial = 0 → gate blocks awake thrust unless the
   *  test seeds it). */
  亲热: 130,
  /** 奉仕フラグ — service-pleasure flag (TCVAR.als id=108). Set on both PLAYER
   *  and TARGET by foreplay commands (COMF19 キス継続 / COMF25 二穴愛撫) to mark
   *  "this turn is service-pleasure-driven". Read by SOURCE converters; defer
   *  consumption (clean trial = no converter arm). */
  奉仕フラグ: 108,
  /** ＦＫ喪失 — first-kiss-lost flag (TCVAR.als id=63). Set to 1 by COMF19
   *  キス継続 on the target (marks "has been kissed"). */
  ＦＫ喪失: 63,
  /** 利尿剤 — diuretic effect timer (TCVAR.csv id=141). Set to 60 by COMF182
   *  利尿剤; decremented by WorldScheduler. `@COM_ABLE144` 放尿 gates
   *  `TCVAR:利尿剤 == 0 && TALENT:漏尿癖 == 0 → RETURN 0`; `@COM144` clears
   *  `TCVAR:利尿剤 = 0` after the act. */
  利尿剤: 141,
  /** 新鲜精液 — 仕込み (drugged-dish) fresh-semen effect (TCVAR.csv id=137).
   *  Set to 下药强度(210) by COMF414 when the eater consumes a laced dish. */
  新鲜精液: 137,
  /** 催情薬 — 仕込み aphrodisiac (TCVAR.csv id=139). Set to 210 on eat. */
  催情薬: 139,
  /** 媚薬 — 仕込み charm-drug (TCVAR.csv id=140). Set to 210 on eat. */
  媚薬: 140,
  /** 糖 — sugar-intake timer (AutoConst_TCVAR.ERH:88, id=138). Set to 20 by
   *  COMF490 糖 (sweets), consumed by flavor flows. No modern consumer yet —
   *  written for fidelity; read side stays unmodeled. */
  糖: 138,
  /** 薬 — "took a drug today" marker (AutoConst_TCVAR.ERH:98, id=144). Written
   *  by COMF490 drug uses. The upstream repeat-use gate is commented out, so
   *  this is a fidelity marker with no consumer. */
  薬: 144,
  /** 破瓜 — V-defilement record (TCVAR.csv id=15). Cleared by NASIKUZUSI
   *  consensual H (the deflowering is stamped to 処女喪失記念日 instead). */
  破瓜: 15,
  /** 発情 — heat state (TCVAR.csv id=142). Set by weather/sexual-state flows. */
  発情: 142,
  /** 睡眠薬茶使用 — sleeping-drug-via-drink marker (TCVAR.csv id=150). Set to 1
   *  alongside 睡眠薬強度 when a 睡眠薬-laced dish is eaten (COMF414). */
  睡眠薬茶使用: 150,
  /** 強制排卵 — forced-ovulation timer (TCVAR.csv id=152). Set to 180 by
   *  COMF192 排卵誘発剤; decremented by the clock. */
  強制排卵: 152,
  /** 欲求不満度管理 — last-settled 欲情 PALAM level marker (TCVAR.als/csv id=147).
   *  `@SOURCE_CHECK` (SOURCE.ERB:1200-1234) raises `CFLAG:溜まってる度` by
   *  `(GETPALAMLV(欲情,15) − this) * 30` whenever the target's 欲情 level grew,
   *  then snapshots `this = GETPALAMLV(欲情,15)`. A pure marker (not an
   *  accumulator): it records the level at which frustration was last banked,
   *  so the same level isn't double-counted. (S-2) */
  欲求不満度管理: 147,
  /** 今天有否见面 — met-the-master-today flag (AutoConst_TCVAR.ERH:120,
   *  id=182). Halves the nightly frustration accrual (AFTERTRA.ERB:1130). */
  今天有否见面: 182,
} as const;

/**
 * EX ids — the per-character `EX:n` namespace (sized 100,
 * `CSV/VariableSize.csv:101`), same index space as `EX:MASTER:…`.
 * Constants from `ERB/Headers/AutoConst_ex.ERH`.
 */
export const EX_ID = {
  /** `EX:MASTER:今日的掃除回数` (AutoConst_ex.ERH:33, id 16). Accumulates the
   *  dirt swept today (COMF410:77 `+= SWEEP_YOGORE`); cashed out at day-end
   *  as `EX/10` yen (`EVENTTURNEND.ERB:309` RANK_POINT), then cleared. */
  今日的掃除回数: 16,
  /** `EX:MASTER:上次的入浴時间` (ex.csv:17). Set to `DAY*1440+TIME` when
   *  MASTER bathes (COMF431/432 via ODEKAKE_OFURO); COMF431 gates on the
   *  interval since this (`< 0` after a魔改 — effectively no cooldown). */
  上次的入浴時间: 17,
  /** 膣内精液 — residual semen in the vagina (ex.csv:16, id=14). ONANISM's
   *  精液中毒 type-3 branch gates on it (AFTERTRA.ERB:920). */
  膣内精液: 14,
  // --- 絶頂回数 board (PAGE 1 调教中 PRINT_STATE_EX, PRINT_STATE2.ERB:61) ---
  Ｃ絶頂: 0,
  Ｖ絶頂: 1,
  Ａ絶頂: 2,
  Ｂ絶頂: 3,
  Ｍ絶頂: 4,
  噴乳: 10,
  射精: 11,
  放尿: 12,
  /** 寸止め 各部位计数 (AutoConst_ex.ERH:41-45). @INFO_STATUS 黄→紫渐变显示用. */
  Ｃ寸止め: 20,
  Ｖ寸止め: 21,
  Ａ寸止め: 22,
  Ｂ寸止め: 23,
  Ｍ寸止め: 24,
  /** 肛門内精液 — residual semen in the rectum (Ex.csv id=15). 肉体情報_A 填充段. */
  肛門内精液: 15,
  /** 子宮内精液 — semen in the uterus (Ex.csv id=18). 肉体情報_W 填充段. */
  子宮内精液: 18,
  /** 精液残量 — current vaginal residue used by `充填率(..., 1)`. */
  精液残量: 25,
  /** アナル精液残量 — current anal residue used by `充填率(..., 2)`. */
  アナル精液残量: 26,
  /** 妊娠判定用精液量 — conception-check amount used by `充填率(..., 5)`. */
  妊娠判定用精液量: 80,
} as const;

/**
 * PALAM ids used in settlement. All values from `Palam.als`.
 * The CUP/CDOWN accumulators share this index space.
 */
export const PALAM_ID = {
  快Ｃ: 0,
  快Ｖ: 1,
  快Ａ: 2,
  快Ｂ: 3,
  快Ｍ: 4,
  潤滑: 9,
  恭順: 10,
  欲情: 11,
  屈服: 12,
  習得: 13,
  恥情: 14,
  苦痛: 15,
  恐怖: 16,
  好意: 20,
  優越: 21,
  反感: 30,
  不快: 31,
  抑鬱: 32,
  眠姦: 33,
} as const;

/**
 * SOURCE ids used in 5D settlement. All values from `source.als` —
 * a **separate namespace** from PALAM (SOURCE 歓楽=20 ≠ PALAM 好意=20).
 * SOURCE is a per-turn transient quantum produced by the command and
 * consumed by `applySourceCheck`; it is not persisted in `GameState`.
 */
export const SOURCE_ID = {
  快Ｃ: 0,
  快Ｖ: 1,
  快Ａ: 2,
  快Ｂ: 3,
  快Ｍ: 4,
  /** 液体 — fluid production (licking/saliva/etc.). source.als id=9. Foreplay family. */
  液体: 9,
  情愛: 10,
  性行動: 11,
  達成: 12,
  苦痛: 13,
  恐怖: 14,
  欲情: 15,
  恭順: 16,
  露出: 17,
  屈従: 18,
  歓楽: 20,
  征服: 21,
  受動: 22,
  不潔: 30,
  鬱屈: 31,
  逸脱: 32,
  反感: 33,
  /** 加虐 — sadistic-pleasure SOURCE (source.als id=55). Added by kiss/equipment
   *  arms when the target has 猫舌 (COMF19 EQUIP_COM19). */
  加虐: 55,
  /** 魔力印记 — magic-mark SOURCE (source.als id=233). Set to 1 by COMF233
   *  五重绝顶魔法 when `FLAG:魔法印记开关` is on; consumer = the 魔力印记
   *  settlement arm (DLC, deferred). */
  魔力印记: 233,
} as const;

/**
 * EQUIP slots (装備部位) — `Equip.csv`. `EQUIP:chara:slot` holds the
 * category-local id of the piece worn in that slot (0 = nothing). CLOTHES
 * Phase 0 (read-only). Slot → clothing-category is `clothesPartsToCategory`
 * (`state/clothing.ts`); the piece's 名前 is read from `clothing-catalog.ts`.
 */
export const EQUIP_SLOT = {
  飾品: 1,
  帽子: 2,
  靴: 3,
  襪子: 4,
  下半身内衣１: 5, // ずらし不可
  下半身内衣２: 6, // ずらし可
  上半身内衣１: 7, // はだけ不可
  上半身内衣２: 8, // はだけ可
  レオタード: 9,
  ボディースーツ: 10,
  裤子: 11, // ずらし不可
  下身衣服: 12, // ずらし可
  連衣裙: 13, // ワンピース
  和服: 14,
  裙子: 15,
  上身衣服２: 16, // はだけ可
  上身衣服１: 17, // はだけ不可
  外搭: 18, // 外衣
  其他１: 19,
  其他２: 20,
  其他３: 21,
  腕部装束: 22,
} as const;

/**
 * TEQUIP ids (`Tequip.csv`) — clothing/toy state bitmasks parallel to EQUIP.
 * Phase 0 uses the two exposure masks; P1 adds the half-undress and
 * top-stripped flags. The toggleable equipment ids (11-20/25/29-35/45) are
 * the per-chara equipment state — read/write via `state/tequip.ts`, NEVER via
 * EQUIP (slots 11-22 are clothing). `TEQUIP:0` bits (下半身): 1=裙子 / 2=ずらし可 / 4=ずらし不可 /
 * 8=下身衣服ずらし不可 / 16=突っ込み不可 (`@SHOW_下半身内衣` line 472-486 +
 * `CLOTHES_SETTING_TRAIN` 763-790). `TEQUIP:1` bits (上半身): 1=はだけ可 /
 * 2=はだけ不可 / 4=突っ込み不可 (`@SHOW_TOP` line 511-514 + 795-820).
 * `TEQUIP:3` = 上半身裸露状態 (set by `@CTRL_CLOTHES_SET "..._半脱"` /
 * `@DATUI_TOP_T_LATE` half-arm); clearing effect on TEQUIP:1 bit2 in
 * `CLOTHES_SETTING_TRAIN:823-824`. `TEQUIP:5` = 上衣脱衣完毕 (set by
 * `DATUI_TOP_T_LATE:163/170` / `CTRL_CLOTHES_SET "..._下着姿"`).
 * `TEQUIP:2` = 下半身挪開状態 (CSV row 10 — 已禁用, not modeled).
 * `TEQUIP:4` = not registered in CSV (dead code in CLOTHES.ERB:825 — skipped).
 */
export const TEQUIP_ID = {
  下半身着衣状況: 0,
  上半身着衣状況: 1,
  /** Ｖ性交 — active vaginal intercourse partner (TEQUIP.csv id=50). */
  Ｖ性交: 50,
  /** Ａ性交 — active anal intercourse partner (TEQUIP.csv id=51). */
  Ａ性交: 51,
  上半身裸露状態: 3,
  上衣脱衣完毕: 5,
  /** 避孕套 — equipped condom (TEQUIP.csv id=35). */
  避孕套: 35,
  /** Slice C — 调教装备 TEQUIP 槽 (Tequip.csv 11-20/25). 由 COMF40-49/104-107
   *  toggle; EQUIP_CHECK 在 SOURCE 结算时读它们产生持续效果. */
  陰蒂夾: 11,
  飛機杯: 12,
  振動棒: 13,
  肛用振動棒: 14,
  後庭拉珠: 15,
  乳頭夾: 16,
  搾乳機: 17,
  眼罩: 18,
  縄: 19,
  口球: 20,
  拘束: 25,
  /** Slice D — PLAY 模式 TEQUIP 槽 (Tequip.csv 29-34). 四者互斥:
   *  野外PLAY(29)/羞耻PLAY(30)/浴室PLAY(31)/新妻PLAY(33); 圍裙(34). */
  野外PLAY: 29,
  羞耻PLAY: 30,
  浴室PLAY: 31,
  新妻PLAY: 33,
  圍裙: 34,
  /** 継続接吻 — continuous-kiss state (Tequip.csv id=45). Master-side. */
  継続接吻: 45,
  /** 相合伞 — shared-umbrella state; suppresses outdoor weather damage. */
  相合伞: 201,
  /** 挑逗モード — teasing mode (Tequip.csv id=80). @INFO_SITUATION shows
   *  `<挑逗中>` while the master has it equipped. */
  挑逗モード: 80,
  /** SWIMMING — swimming state (Tequip.csv id=900). @INFO_SITUATION shows
   *  `<游泳中>` / `<和X约会中玩水>` while equipped. */
  SWIMMING: 900,
} as const;

/** TALENT ids read by converters / FAVOR_CALC / KOJO predicates.
 *  All values from `Talent.als`. */
export const TALENT_ID = {
  処女: 0,
  性別: 2,
  恋慕: 3,
  淫乱: 4,
  服従: 5,
  キス未経験: 6,
  /** 恋人 — mutual lover status (one person). KOJO primary branch gate. */
  恋人: 7,
  思慕: 8,
  /** 胆量 — courage (-1 coward, 1 brave). CHARA_ATTITUDE/抱き寄せ arms read it
   *  but the 押し倒す entry doesn't branch on it directly. Talent.csv line 16. */
  胆量: 10,
  /** 自尊心 — self-esteem (-1 low / 1 high). 抱き寄せ必要値 adds +30 when high
   *  (ATTITUDE.ERB:347). Talent.csv line 25. */
  自尊心: 13,
  心情: 15,
  /** 性的兴趣 — interest-in-sex (-1 dislike / 1 likes). 抱き寄せ必要値 subtracts -20
   *  when high (ATTITUDE.ERB:347). Talent.csv line 39. */
  性的兴趣: 23,
  /** 一線越えない — "has not crossed the line" (all ABL hard to raise). */
  一線越えない: 25,
  /** 無知 — ignorance of sexual matters. 抱き寄せ必要値 subtracts -50
   *  (ATTITUDE.ERB:362); also a gate in 抱き寄せ for 初次拥抱=2 vs =1. Talent.csv line 47. */
  無知: 27,
  貞操: 30,
  /** 羞恥心 — shame (-1 shameless / 1 shy). COMF356 物陰に誘う gate
   *  (`ABL:露出癖 + TALENT:羞恥心 < 3` → refuse). Talent.csv line 57. */
  羞恥心: 33,
  /** 自己愛 — self-love. Negative → adds 鬱屈 SOURCE under coercion (toys). */
  自己愛: 31,
  /** 抵抗 — resistance. Adds 鬱屈 SOURCE; commands harder to run. */
  抵抗: 32,
  /** 性別嗜好 — sexual-orientation preference (-1 both sexes, 0 hetero,
   *  1 same-sex). CHARA_ATTITUDE/抱き寄せ必要値 gate (ATTITUDE.ERB:351, 369).
   *  Talent.csv line 104. */
  性別嗜好: 81,
  /** 風騷 — "lewd / easy". +400 to 合意判定 (ATTITUDE.ERB:77) → 態度 almost
   *  always 3 → 抱き寄せ unblockable. Talent.csv line 148. */
  風騷: 142,
  /** 妊娠願望 — pregnancy wish (Talent.als id=9). Gates long-form personal-prose
   *  paragraph at night (AFTERTRA.ERB:259-264). */
  妊娠願望: 9,
  /** 千客万来 — "ever-busy host" talent on the MASTER; raises the daily
   *  visitor cap 20→30 in `@来訪フラグ`. Talent.als id=175. */
  千客万来: 175,
  /** 施虐狂 — sadist (commands easier as 調教者; reverses 身を任せる/抵抗
   *  direction). Talent.csv line 109. */
  施虐狂: 82,
  /** 変化 — shape-shift ability holder. COMF358 他者変身 gates on it.
   *  Talent.csv line 145. */
  変化: 139,
  /** 愛欲 — "wanton love" (a 陥落素質). +80 to 合意判定 (ATTITUDE.ERB:42).
   *  Talent.csv line 185. */
  愛欲: 184,
  /** 炮友 — "fuck-buddy" (a 陥落素質). +30 to 合意判定 (ATTITUDE.ERB:42).
   *  Talent.csv line 186. */
  炮友: 185,
  /** 嫉妬 — jealousy (Talent.als id=84). L1 of CALC_EXPRESSION_CORE: 嫉妬 &&
   *  デート相手==CHARA && TARGET!=CHARA → forced 憤怒 (QOL_IMAGE.ERB:1434-1435). */
  嫉妬: 84,
  /** セフレ — sex-friend (Talent.als id=185). Alias for 炮友 (upstream 同一 ID). */
  セフレ: 185,
  /** 精愛味覚 — refined-semen-taste (Talent.als id=122). Unlocks `Qol_Dates_LoveSemen`. */
  精愛味覚: 122,
  /** 合意誤認 — "consent mistakenly believed". When 態度<2 floors 態度=2
   *  and 合意判定=300 (ATTITUDE.ERB:95-99). Talent.csv line 245. */
  合意誤認: 299,
  /** 路人 — generic/faceless NPC ("汎用角色"). @COM_ABLE357 炮友契約 rejects
   *  `TALENT:TARGET:路人` (can't form a contract with a faceless mob).
   *  Talent.csv line 246. */
  路人: 300,
  痛覚: 40,
  /** 釣りLv — fishing level. Added to 釣魚パワー (COMF621). Talent.als id=47. */
  釣りLv: 47,
  /** 採集Lv — gathering level. ×10 on 採集パワー (COMF445). Talent.als id=48. */
  採集Lv: 48,
  /** 調合Lv / 伐採Lv — the two remaining non-combat life-skill talents
   *  raised by `@SOURCE_ABLUP`. Talent.als ids 49 / 46. */
  調合Lv: 49,
  伐採Lv: 46,
  /** 習得速度 — learning speed (-1 slow / 1 fast). Cooking: added to a helper's
   *  料理経験 gain (COMF413:362) & ×5 in 練習 LEARNED_MENU (COMF413:644).
   *  Talent.csv id=50. */
  習得速度: 50,
  /** 母性 — motherly love. Cooking: a mother's dish gains 母亲的味道 taste
   *  (DISH_TASTE_FROM_CHARA, DISHDATA:1428). Talent.csv id=155. */
  母性: 155,
  /** Race tribes — value selects the tribe (GET_TRIBENAME). Cooking P3b reads
   *  these for 流派/race taste (DISH_TASTE_FROM_CHARA). Talent.csv ids. */
  狐: 90,
  妖狐: 91,
  動物耳: 143,
  /** 水棲 — aquatic race talent; rain is restorative and summer sun hurts. */
  水棲: 163,
  氷精: 164,
  半白澤: 166,
  人間: 190,
  妖怪: 191, // 1妖怪 2鬼 3吸血鬼 4河童 5天狗 6妖兽 7妖鸟 8妖虫 9恶魔 10小人 11座敷童子 12山童
  幽霊: 194,
  付喪神: 195,
  人形: 196,
  魔界人: 200,
  /** 回復速度 — recovery speed talent (Talent.csv id=130). -1=回復慢 / 0=普通 /
   *  +1=回復快. Drives the wake-recovery 快眠係数
   *  (`BEFORETRAIN.ERB:339 快眠係数 = 480 - 60*回復速度 - 安眠補正`):
   *  +1 shrinks the denominator (more recovery), -1 grows it (less). */
  回復速度: 130,
  /** NESTING — egg-incubation instinct used exclusively by FREE_ACT_19. */
  NESTING: 311,
  /** 掃除係 — cleaning-duty holder. While a shrine resident, in-base move rate
   *  is pulled toward dirty rooms during cleaning hours (`@角色移動率`).
   *  Talent.csv id=182. */
  掃除係: 182,
  /** 器用な指 — "skillful fingers". ×1.5 on 愛撫 C/B 快感 (comf0 line 93). Talent.als id=51. */
  器用な指: 51,
  /** 舌使い / 灵舌 — "tongue technique". ×1.5 on 情愛 / フェラ 系 (comf0 line 97). Talent.als id=52. */
  舌使い: 52,
  /** 猫舌 — "cat tongue" (heat-sensitive). EXP:嗜虐快楽経験 on kiss/foreplay (comf0 line 64). Talent.als id=54. */
  猫舌: 54,
  汚臭耐性: 61,
  /** 禁断的知識 — forbidden knowledge (Talent.csv id=144, 魔法DLC). Granted by
   *  buying 【禁断的知識】(item 62); unlocks 触媒/符咒 use & DLC item purchases. */
  禁断的知識: 144,
  /** 左拥右抱 — "two-timing / polyamory" talent on MASTER. When set, the
   *  嫉妬/浮気 bystander check in `@COM697/698` is skipped (allows 2-timing
   *  without the jealousy gate). Talent.csv line 95-96, id=96. */
  左拥右抱: 176,
  /** 漏尿癖 — incontinence tendency. Makes COMF144 放尿 always usable
   *  (Talent.csv:81 `@COM_ABLE144` gate bypass). Talent.als id=57. */
  漏尿癖: 57,
  献身的: 62,
  /** 魅惑 — enchantment talent (Talent.csv id=93). Halves the trust drop on
   *  consensual H (NASIKUZUSI.ERB:519-520). */
  魅惑: 93,
  /** 謎之魅力 — mysterious charisma (Talent.csv id=94). Same trust-drop
   *  halving as 魅惑. */
  謎之魅力: 94,
  快感応答: 70,
  中毒しやすい: 71,
  人类: 190,
  /** 追加種族 — value 4 is 蓬莱人 (Talent.csv id=197). */
  追加種族: 197,
  /** ズボラ — slovenly (ERB alias 懒散). Room dirties faster; raises the
   *  cleaning threshold ×10 (COMF410 OSOUJI_LIMIT). Talent.als id=18. */
  ズボラ: 18,
  /** 体型 — body size (-5=小人 … 3=巨人). 小人 (==-5) cuts cleaning power /5
   *  (COMF410 SWEEP_POWER_CALC). Talent.als id=100. Also gates entry to
   *  P54 小人的虫籠 via `@MAP_CAN_MOVE_0` (only 体型 ≤ -5 may enter). */
  体型: 100,
  /** 力持ち — strength talent used by `CAN_STANDING_SEX` for heavy poses. */
  力持ち: 223,
  /** 妖精 — fairy race (Talent.csv:191, id=192). Gates entry to the
   *  P27-P35 三妖精之家 rooms via `@MAP_CAN_MOVE_0` (妖精 may enter freely). */
  妖精: 192,
  /** 清掃中毒 — cleaning addiction. +3 cleaning power per level and lowers
   *  the cleaning threshold /10 (COMF410). Talent.als id=174. */
  清掃中毒: 174,
  /** 居場所察知 — "location sensing". Gates the 察知模式 1 (presence) map
   *  overlay: color each room by who's there + activity (@GETMAP/DRAW_MAP.ERB
   *  :133). MASTER-acquired (椛 has it innately). Talent.csv id=159. */
  居場所察知: 159,
  /** 汚部屋察知 — "dirty-room sensing". Gates the 察知模式 2 (dirt) map
   *  overlay: color each room by its YOGORE (DRAW_MAP.ERB:163). Talent.csv
   *  id=160. */
  汚部屋察知: 160,
  /** 劣情察知 — collection achievement bitmask (Talent.csv id=157).
   * Bit 0/1 are unlocked by panty milestones 2/4. */
  劣情察知: 157,
  /** 音楽知識 — music knowledge. Talent.als id=161. */
  音楽知識: 161,
  /** 音感 — sense of pitch. -1=音痴, 1=音感, 2=絶対音感. Talent.als id=162. */
  音感: 162,
  /** 接吻魔 / キス魔 — "kiss maniac" (M系 commands amplified). Talent.als id=77. */
  接吻魔: 77,
  /** キス魔 — JP alias for 接吻魔 (Talent.als id=77). */
  キス魔: 77,
  /** ポルチオ性感 / 子宮口性感 — cervix-sensitivity flavor talent.
   *  Talent.als id=78. */
  ポルチオ性感: 78,
  子宮口性感: 78,
  /** 淫壺 — lewd-vagina flavor talent (Talent.als id=74). Gate for 肉体情報_V 段落. */
  淫壺: 74,
  /** 尻穴狂い — anal-mania flavor talent (Talent.als id=75). Gate for 肉体情報_A 段落. */
  尻穴狂い: 75,
  /** 淫乳 — lewd-breast flavor talent (Talent.als id=76). Gate for 肉体情報_B 段落. */
  淫乳: 76,
  /** 受虐狂 — masochist (commands easier to obey; M-系 ABL rise faster).
   *  COMF22 誘い受ける amplifies 露出/液体/欲情. Talent.als id=83. */
  受虐狂: 83,
  /** 幼稚 — "childish" (幼稚 trigger: 苦痛+350 / 恐怖+200 / 逸脱+50 on spank, comf100). Talent.als id=151. */
  幼稚: 151,
  /** Ｃ感度 — clitoral sensitivity (-1 鈍感 / 1 敏感). Talent.als id=101. */
  Ｃ感度: 101,
  /** Ｖ感度 — vaginal sensitivity. id=102. */
  Ｖ感度: 102,
  /** Ａ感度 — anal sensitivity. id=103. */
  Ａ感度: 103,
  /** Ｂ感度 — breast sensitivity. id=104. */
  Ｂ感度: 104,
  /** 胸围 — bust size (-2 絶壁 … 2 爆乳). ONANISM type-5 Ｂ乳 text variants.
   *  Talent.csv id=105. */
  胸围: 105,
  /** 自慰しやすい — prone to masturbation; -200 on the ONANISM trigger
   *  threshold (AFTERTRA.ERB:878). Talent.csv id=60. */
  自慰しやすい: 60,
  /** 容易中毒 — addiction-prone; halves 中毒-ABL jewel demand
   *  (ABL_UP_DATA.ERB:1832). Talent.csv id=71. */
  容易中毒: 71,
  /** 自慰狂 — masturbation mania; -300 on the ONANISM trigger threshold
   *  (AFTERTRA.ERB:879). Talent.csv id=73. */
  自慰狂: 73,
  /** 酒耐性 — alcohol tolerance (-2 下戸 / -1 弱い / 0 普通 / 1 強い / 2 酒豪 /
   *  3 うわばみ). Drives DRUNKEN's central 酒気 multiplier + per-alcohol TASTE
   *  ladders. Talent.als id=121. */
  酒耐性: 121,
  /** 神霊 — divine-spirit race (1=神霊 2=死神 3=閻魔). 神酒 TASTE=30 when set.
   *  Talent.als id=193. */
  神霊: 193,
  /** 酒造家 — brewer (1=酒造家 2=杜氏). 杜氏(>=2) speeds fermentation
   *  (`@酒造`: 醸造日数-1 when >2) and +1 the water-swap 醸造数 (COMF450).
   *  Talent.als id=225. */
  酒造家: 225,
  /** 調合知識 — compounding knowledge. 药酒 TASTE=20 when set. Talent.als id=55. */
  調合知識: 55,
  /** 大胃王 — acquired by MASTER when SOURCE_ABLUP raises 料理技能 to 3+. */
  大胃王: 137,
  /** 薬毒耐性 — drug-poison resistance. 药酒 TASTE=20 when set. Talent.als id=56. */
  薬毒耐性: 56,
  /** 幼児／幼児退行 — infant/regression. 甜酒 TASTE=15 when set. Talent.als
   *  id=150. Quoted key: the fullwidth `／` (U+FF0F) is not a valid TS
   *  identifier character. */
  "幼児／幼児退行": 150,
  /** 反発抑制 — rebellion suppression. When set, MARK_GOT_CHECK skips the
   *  反発刻印 arm entirely (RETURN 0) and FAVOR_CALC's 憤怒上昇値 is /3.
   *  Talent.csv:244 / AutoConst_Talent.ERH:249, id=298. */
  反発抑制: 298,
  /** 態度 — disposition (-1 坦率/honest … 1 叛逆/rebellious). TRUST_CALC reads
   *  it: 叛逆(>0,no恋慕) −1; 坦率(<0,trust>0) +1. Talent.csv:19, id=11. */
  態度: 11,
  /** 开朗／阴郁 — cheerful(>0) / gloomy(<0). TRUST_CALC: both-cheerful or
   *  both-gloomy with MASTER → +1. Talent.csv:42, id=24. Quoted key: the
   *  fullwidth `／` (U+FF0F) is not a valid TS identifier character. */
  "开朗／阴郁": 24,
  // --- 欲求不満素質補正 chain (AFTERTRA.ERB:1166, S-2) — all 0 for a clean chara ---
  /** 自制心 — self-control. Halves frustration accrual (欲求不満素質補正).
   *  Talent.als id=20. */
  自制心: 20,
  /** 初潮 — menarche reached. Gates the 幼稚 /4 frustration cut (only pre-初潮
   *  childish charas get it). Talent.als id=156. */
  初潮: 156,
  /** 妊娠 — pregnant. Quarters frustration accrual (unless HYPERFERTILE).
   *  Talent.als id=153. */
  妊娠: 153,
  /** 育児中 — child-rearing. Halves frustration accrual (unless HYPERFERTILE).
   *  Talent.als id=154. */
  育児中: 154,
  /** HYPERFERTILE — hyper-fertile (DLC). Exempts 妊娠/育児中 frustration cuts.
   *  Talent.als id=313. */
  HYPERFERTILE: 313,
  // --- 角色情报看板硬骨头批 (Talent.csv) ---
  /** 容姿 — looks (-1 丑陋 / 1 俊美). id=16. */
  容姿: 16,
  /** 年齢 — age band (-1 儿童 / 1 中年 / 2 老人). id=17. */
  年齢: 17,
  /** 濡れやすさ — wetness tendency (-1 不易湿 / 1 容易湿). id=41. 肉体情報_BODY. */
  濡れやすさ: 41,
  /** 非童貞 — bit0 膣性交済み / bit1 肛門性交済み. id=1. */
  非童貞: 1,
  /** 魅力 — charm (SIZE 補正: 腰-5% 胸+5% 臀+5% 体重-5%). id=92. */
  魅力: 92,
  /** ヒップサイズ — hip size (-2 纖臀 … 2 豊臀). id=108. SIZE 臀圍補正. */
  ヒップサイズ: 108,
  /** 母乳体質 — lactation (1 可以哺乳 / 2 泌乳体质). id=149. 肉体情報_B. */
  母乳体質: 149,
  /** 形状 — penis shape (1 小 2 短 4 萤光 5 疣凸 6 巨 10 驴). id=250. ちん遍歴. */
  形状: 250,
  /** 濃厚精液 — thick semen. id=120. ちん遍歴素质段. */
  濃厚精液: 120,
  /** 双槍 — twin shafts. id=183. */
  双槍: 183,
  /** 人妻 — married (1 人妻 / 2 未亡人). id=198. */
  人妻: 198,
  /** 妻 — spouse status (1 未婚妻(夫) / 2 妻子(丈夫)). id=221. */
  妻: 221,
  /** 妾 — concubine (1 侧室). id=222. */
  妾: 222,
  /** 風俗嬢 — 温泉从业员 (1 风俗娘 … 4 熟悉的娼妇). id=199. 工作地点/素质高亮. */
  風俗嬢: 199,
} as const;

/**
 * MARK (permanent training-brand) ids. Values from `AutoConst_Mark.ERH`.
 * Parity QA P-15 models 反発刻印 (rebellion brand) + its history; the other
 * brands (苦痛/時姦/快楽/不埒) are deferred (their取得 paths read CUP 快感/
 * 苦痛/恐怖 quanta that 会話/掀裙子 don't produce).
 */
export const MARK_ID = {
  /** 反発刻印 — rebellion brand (0..3). Set by MARK_GOT_CHECK from accumulated
   *  反感/不快 CUP; read by FAVOR_CALC / TRUST_CALC as a 好感度/信頼度 penalty
   *  floor. AutoConst_Mark.ERH:9, id=3. */
  /** 苦痛 — pain brand (Mark.als id=0). Shown in 7×7 ABL grid. */
  苦痛: 0,
  /** 快乐 — pleasure brand (Mark.als id=1). */
  快乐: 1,
  /** 快楽刻印 — canonical ERB spelling for the pleasure brand. */
  快楽刻印: 1,
  /** 不埒 — lewdness brand (Mark.als id=2). */
  不埒: 2,
  /** 反感 — dislike brand (Mark.als id=3). */
  反感: 3,
  反発刻印: 3,
  /** 履历 — history brand (Mark.als id=4). */
  履历: 4,
  /** 反発取得履歴 — highest 反発刻印 ever earned (makes re-earning harder).
   *  AutoConst_Mark.ERH:10, id=4. */
  反発取得履歴: 4,
  /** 时奸 — time-stop assault brand (Mark.als id=5). */
  时奸: 5,
} as const;

/**
 * ABL (ability) ids used in settlement. All values from `Abl.als`.
 * Note `マゾっ気`=15 is read as 受虐属性 and `サドっ気`=16 as 施虐属性 in
 * the ERB converters.
 */
export const ABL_ID = {
  Ｃ感覚: 0,
  Ｖ感覚: 1,
  Ａ感覚: 2,
  Ｂ感覚: 3,
  Ｍ感覚: 4,
  親密: 9,
  従順: 10,
  欲望: 11,
  技巧: 12,
  奉仕精神: 13,
  露出癖: 14,
  受虐属性: 15,
  施虐属性: 16,
  /** 百合属性 — sapphic preference ABL (Abl.csv id=17). Pattern 0/1 price
   *  欲情 + 屈服 jewels; pattern 0 lifts 百合中毒. JUEL_DEMAND_17 ladder. */
  百合属性: 17,
  /** 断袖属性 — yuri/Yaoi counterpart ABL (Abl.csv id=18). Mirrors the
   *  百合 row. JUEL_DEMAND_18 ladder. */
  断袖属性: 18,
  // 中毒系 (Abl.csv lines 21-26). Raised by the night ABLUP flow; ONANISM
  // reads 自慰中毒 for its threshold/珠入手倍率 and the EXP grant.
  自慰中毒: 30,
  精液中毒: 31,
  百合中毒: 32,
  断袖中毒: 33,
  膣射中毒: 34,
  肛射中毒: 35,
  // 部位技巧 (Abl.csv 50-56) — 肉体情報 技巧 ladder source.
  指: 50,
  舌: 51,
  胸: 52,
  腰: 53,
  膣: 54,
  肛門: 55,
  足: 56,
  清扫技能: 40,
  話術技能: 41,
  战斗能力: 42,
  教養: 43,
  料理技能: 44,
  音楽技能: 45,
} as const;

/**
 * EXP ids used in 5C settlement. All values from `exp.als`.
 *
 * **Reconciliation note**: the upstream .als file also has a
 * `TCVAR.als` entry id=471 named `会話経験`, but that is the TCVAR
 * namespace — a coincidence in numbering. The REAL EXP:会話経験
 * is at `exp.als` id=71 (ERB: `EXP:MASTER:会話経験`).
 */
export const EXP_ID = {
  /** 精液経験 — semen experience used by the source-backed 139/101 request gate. */
  精液経験: 14,
  /** Ｃ経験 — clitoral experience. exp.als id=0. Granted by `跳蛋/` dish taste
   *  (COMF414 吃飯, +30). */
  Ｃ経験: 0,
  会話経験: 71,
  /** 約會経験 — date experience (both master & target; COMF603/610/615 etc. `++`).
   *  exp.als id=77 (ERB `EXP_約會経験 = 77`, `exp.csv:73`). */
  約會経験: 77,
  /** 料理経験 — cooking experience (COMF615 お弁当 `+= LOCAL:2` by 親密+奉仕 tier).
   *  exp.als id=76 (`exp.als:72`). */
  料理経験: 76,
  /** 学習経験 — study/teaching XP. Granted by `412 勉強` (master always
   *  +1; target-present non-DLC branch adds more). From `exp.als` id=75. */
  学習経験: 75,
  /** 採集経験 — gathering XP. Granted by `COMF445 採集する` (+1 base, +2 extra
   *  if nothing found). From `exp.als` id=84. */
  採集経験: 84,
  /** 戦闘経験 — combat XP. Granted by `411 戦闘訓練`. From `exp.als` id=74. */
  戦闘経験: 74,
  /** 睡眠姦経験 — sleep-sex XP (exp.als id=59). Gates 潜入房間 (woke roll needs
   *  <300; 寝室許可 auto-allows at >300). Not written by any modern path yet →
   *  effectively 0 (NPCs always rollable, never auto-permissive). */
  睡眠姦経験: 59,
  /** 撮影経験 — photography XP. Granted by `436 読書` 実用書 arm (RAND:7).
   *  From `AutoConst_exp.ERH:65`, exp.als id=72. */
  撮影経験: 72,
  /** 釣り経験 — fishing XP. Granted by `436 読書` 実用書 arm. exp.als id=82. */
  釣り経験: 82,
  /** 調合経験 — alchemy XP. Granted by `436 読書` 実用書/魔导书 arms.
   *  exp.als id=85. */
  調合経験: 85,
  /** 伐採経験 — logging XP. Granted by `436 読書` 実用書 arm. exp.als id=86. */
  伐採経験: 86,
  /** 道具使用経験 — toy/implement-use XP. Granted by the toys family
   *  (40-49). From `exp.als` id=28. */
  道具使用経験: 28,
  /** 手淫経験 — handjob XP (target, comf80). exp.als id=24. */
  手淫経験: 24,
  /** キス経験 — kiss XP (both, comf0/comf700). exp.als id=27. ERB sometimes
   *  writes `EXP:接吻経験` (same id 27, different label). */
  キス経験: 27,
  /** 自慰経験 — masturbation XP (target, comf700). exp.als id=22. */
  自慰経験: 22,
  /** 調教自慰経験 — instructed-self-pleasure XP. exp.als id=23. */
  調教自慰経験: 23,
  /** 嗜虐快楽経験 — sadistic-pleasure XP (master, on SM/foreplay). exp.als id=43. */
  嗜虐快楽経験: 43,
  /** 放尿経験 — urination XP (target). `EXP:放尿経験 += 2` from COMF144 放尿.
   *  exp.als id=13. */
  放尿経験: 13,
  /** 緊縛経験 — bondage XP (target). Granted by the SM equip family
   *  (104 アイマスク +2 / 105 縄 +5 / 106 ギャグ +2 / 107 拘束 +1) and scales
   *  their target BASE drain down (EXPLV:3/4 brackets → ×1.0/0.9/0.7).
   *  exp.als id=56. */
  緊縛経験: 56,
  /** Ｖ経験 — vaginal experience (target). Positions family. exp.als id=1. */
  Ｖ経験: 1,
  /** Ｖ性交経験 — vaginal intercourse experience (target). exp.als id=20. */
  Ｖ性交経験: 20,
  /** 挿入経験 — insertion experience (master). exp.als id=29. */
  挿入経験: 29,
  /** Ａ経験 — anal experience (target). Positions family (62/63/66/69/70/323).
   *  exp.als id=2 (ERB `EXP:2`). Added in Phase 7 (positions family wave). */
  Ａ経験: 2,
  /** Ｖ拡張経験 — vaginal-expansion XP (target). Fist/insertion SM family
   *  (141/143). exp.als id=54. */
  Ｖ拡張経験: 54,
  /** Ａ拡張経験 — anal-expansion XP (target). Anal-fist/balloon SM family
   *  (142/143/146/147/148). exp.als id=55. */
  Ａ拡張経験: 55,
  /** Ｂ経験 — breast experience (target). exp.als id=3. 感覚 jewel-demand
   *  correction term (ABL_UP_DATA.ERB:410). */
  Ｂ経験: 3,
  // 絶頂経験 family (exp.csv ids 5-8) — the (1+感覚)/(1+GETEXPLV(絶頂経験,8))
  // divisors in the 感覚 jewel-demand tables (ABL_UP_DATA.ERB:145 etc.).
  Ｃ絶頂経験: 5,
  Ｖ絶頂経験: 6,
  Ａ絶頂経験: 7,
  Ｂ絶頂経験: 8,
  Ｍ絶頂経験: 9,
  /** Ｍ経験 — masochist experience (target). exp.als id=4. Kiss/foreplay family. */
  Ｍ経験: 4,
  /** Ａ性交経験 — anal intercourse experience (target). exp.als id=21. */
  Ａ性交経験: 21,
  /** 愛情経験 — affection experience (target, scales with 恋慕). exp.als id=41. */
  愛情経験: 41,
  /** 絶頂経験 — conscious ecstasy XP (target). exp.als id=10. Gated by
   *  愛欲取得条件 to count only "self-aware" climaxes (no 無自覚 term). */
  絶頂経験: 10,
  /** 射精経験 — ejaculation XP (target/master). exp.als id=11. */
  射精経験: 11,
  /** 噴乳経験 — lactation XP (target). exp.als id=12. */
  噴乳経験: 12,
  /** 精飲経験 — semen-drinking XP (target). exp.als id=15. */
  精飲経験: 15,
  /** 膣射経験 — vaginal creampie XP (target). exp.als id=16. */
  膣射経験: 16,
  /** 肛射経験 — anal creampie XP (target). exp.als id=17. */
  肛射経験: 17,
  /** 接吻経験 — kiss XP (target). exp.als id=27. Setter for 接吻魔
   *  talent acquisition at EXP > 300 (EVENTTURNEND:31). */
  接吻経験: 27,
  /** 子宮口開発経験 — cervix XP (target). exp.als id=57. Gates
   *  子宮口性感 talent at > 50. */
  子宮口開発経験: 57,
  /** 演奏経験 — music performance XP. exp.als id=79. Gates 音楽知識
   *  (>= 1000) / 音感 (>= 5000). */
  演奏経験: 79,
  歌唱経験: 80,
  舞踏経験: 83,
  /** 口淫経験 — oral sex experience (self-pleasure セルフフェラ, comf702). exp.als id=25. */
  口淫経験: 25,
  /** 乳交経験 — breast-sex XP (target, COMF150 胸の谷間). exp.als id=26. */
  乳交経験: 26,
  /** 異常経験 — anomaly experience (toy insertion while virgin, comf744). exp.als id=53. */
  異常経験: 53,
  /** 清掃経験 — cleaning XP (master; +1 normally, +2 if helper joins per
   *  COMF410 ERB 174-188). exp.als id=70. */
  清掃経験: 70,
  // --- 肉体情報 (PAGE 4) counters (Exp.csv) ---
  /** 無自覚絶頂経験 — unaware orgasms (id=65). 肉体情報_HEART + 陷落条件. */
  無自覚絶頂経験: 65,
  /** 奉仕快楽経験 — service-pleasure XP (id=40). 肉体情報_BODY. */
  奉仕快楽経験: 40,
  /** 露出快楽経験 — exposure-pleasure XP (id=44). 肉体情報_BODY. */
  露出快楽経験: 44,
  /** 出産経験 — childbirth count (id=81). 肉体情報_BODY. */
  出産経験: 81,
  /** 異常清掃経験 — anomaly-cleaning XP (master; +1 when LOCAL:3 == 1 in
   *  the 诶嘿嘿 arm of COMF410 ERB 145-152, also from time-stop arm). exp.als id=78. */
  異常清掃経験: 78,
} as const;

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/**
 * Read a chara's current location (CFLAG:現在位置). `charaNum === 0`
 * is the MASTER; any other id is an NPC from `state.charas`.
 * Returns `0` when the chara or the CFLAG slot is unset (ERA default
 * for a fresh `Record` lookup).
 */
export function getLocation(state: GameState, charaNum: number): number {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  return slot?.state.CFLAG[CFLAG_ID.現在位置] ?? 0;
}

/**
 * Write a chara's current location. Throws if `charaNum` refers to an
 * NPC slot that does not yet exist in `state.charas` — callers must
 * initialize the chara before moving them.
 */
export function setLocation(
  state: GameState,
  charaNum: number,
  locId: number,
): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) {
    throw new Error(`setLocation: unknown charaNum ${charaNum}`);
  }
  slot.state.CFLAG[CFLAG_ID.現在位置] = locId;
}

// ---------------------------------------------------------------------------
// Default-value convention (5C-review Issue 3)
// ---------------------------------------------------------------------------
//
// An unset numeric slot reads as `undefined`; the default we substitute
// depends on how the value is *used*:
//   - ADDITIVE / accumulator slots (PALAM, EXP, 好感度 deltas, CUP/CDOWN)
//     default `?? 0` — an unset slot starts at zero and `+=` is correct.
//   - MULTIPLICATIVE / rate slots (wage rate TCVAR:316, multipliers)
//     default `?? 1` — an unset slot must not zero the product (the 5C
//     `TCVAR:316` precedent).
// Handlers/converters should pick the default by this rule, not by reflex.

// ---------------------------------------------------------------------------
// ERA BASIC arithmetic helpers (memory `eratw-emuera-language-semantics`)
// ---------------------------------------------------------------------------

/**
 * `TIMES var, f` — ERA multiplies an int var by a float then **discards
 * the fractional part** (truncates toward zero, default config). Model
 * every settlement multiplier with this so hand-traced test numbers are
 * byte-exact. e.g. `times(200, 0.2) === 40`, `times(46, 1.2) === 55`.
 */
export function times(value: number, factor: number): number {
  return Math.trunc(value * factor);
}

/**
 * `@GET_REVISION(value, 上限, 上昇率)` (ERB `COMMON.ERB:133`):
 *   `上限 - 上昇率 * 上限 / (上昇率 + value)`
 * Integer division truncates toward zero. A saturating curve that
 * approaches `上限` as `value` grows.
 */
export function getRevision(value: number, limit: number, rate: number): number {
  return limit - Math.trunc((rate * limit) / (rate + value));
}

/**
 * `@GET_REVISION3(num, TH0, TH1, TH2)` (ERB `COMMON.ERB:156`): below the
 * first threshold returns `num` unchanged; above each threshold the
 * excess is compressed as `TH + floor(sqrt(num - TH)) * 2`. A 0 threshold
 * short-circuits (returns the running value). e.g. `(10000,50,100,200) → 124`.
 */
export function getRevision3(
  num: number,
  th0: number,
  th1: number,
  th2: number,
): number {
  const th = [th0, th1, th2];
  for (let i = 0; i < 3; i++) {
    if (num <= th[i]! || th[i] === 0) return num;
    num = th[i]! + Math.trunc(Math.sqrt(num - th[i]!)) * 2;
  }
  return num;
}

// ---------------------------------------------------------------------------
// Pleasure-settlement tables (快感 converters — B1a)
// ---------------------------------------------------------------------------

/**
 * `PALAMLV` thresholds — the **base-game** table (`初期設定.ERB` 64-79,
 * the `!MAGIC_DLC_好感亲密重做` branch; DLC table deferred). `PALAMLV[16+]`
 * is a flat `10000000` (VARSET fill). Index by level: `PALAMLV[1]` = 100.
 */
export const PALAMLV: readonly number[] = [
  0, 100, 500, 3000, 10000, 30000, 60000, 100000, 150000, 250000, 400000,
  600000, 900000, 1500000, 3000000, 5000000,
];

/** Read `PALAMLV[n]`, clamping ≥16 to the flat cap (`初期設定.ERB` 80). */
export function palamLv(n: number): number {
  return PALAMLV[n] ?? 10000000;
}

/**
 * `@GETPALAMLV(ARG, ARG:1)` (ERB `COMMON.ERB:182`) — return the **level
 * index** (0..cap) such that `PALAMLV[level] ≤ ARG < PALAMLV[level+1]`.
 * Used by `CHARA_ATTITUDE` (ATTITUDE.ERB:46) and the 快感 converters.
 * Distinct from {@link palamLv}, which returns the threshold value.
 */
export function palamLevel(value: number, cap: number): number {
  for (let i = 1; i < PALAMLV.length; i++) {
    if (value < PALAMLV[i]!) return Math.min(i - 1, cap);
  }
  return cap;
}

/** `EXPLV` thresholds (`初期設定.ERB` 111-123). `EXPLV[1]` = 1. */
export const EXPLV: readonly number[] = [
  0, 1, 4, 20, 50, 200, 500, 1000, 2000, 3000, 4000, 5000, 6000,
];

/** Read `EXPLV[n]` (clamps high n to the last entry). */
export function expLv(n: number): number {
  return EXPLV[n] ?? EXPLV[EXPLV.length - 1]!;
}

/**
 * `GETEXPLV(value, cap)` — the **level index** (0..cap) such that
 * `EXPLV[level] ≤ value < EXPLV[level+1]`. The EXP analog of
 * {@link palamLevel}; used by the jewel-demand experience corrections
 * (`ABL_UP_DATA.ERB:144` etc.).
 */
export function expLevel(value: number, cap: number): number {
  for (let i = 1; i < EXPLV.length; i++) {
    if (value < EXPLV[i]!) return Math.min(i - 1, cap);
  }
  return cap;
}

/**
 * `@SOURCE_REVISION1(abl)` (`SOURCE_1.ERB` 886) — 感覚 ABL → pleasure
 * multiplier (the converter divides the result by 10).
 *   0-5: 10+7x · 6-9: 30+4x · 10-15: 45+2x · 16-19: 70+x · ≥20: 90
 */
export function sourceRevision1(abl: number): number {
  if (abl <= 5) return 10 + 7 * abl;
  if (abl <= 9) return 30 + 4 * abl;
  if (abl <= 15) return 45 + 2 * abl;
  if (abl <= 19) return 70 + abl;
  return 90;
}

/**
 * `@SOURCE_REVISION2(abl)` (`SOURCE_1.ERB` 906) — 欲望 ABL → 欲情 multiplier
 * (the converter divides the result by 100).
 *   0-5: 25+7x · 6-9: 45+3x · 10-15: 60+2x · 16-19: 80+x · ≥20: 100
 */
export function sourceRevision2(abl: number): number {
  if (abl <= 5) return 25 + 7 * abl;
  if (abl <= 9) return 45 + 3 * abl;
  if (abl <= 15) return 60 + 2 * abl;
  if (abl <= 19) return 80 + abl;
  return 100;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Advance the in-game clock by `delta` minutes (ERA `TIME` units). This is
 * the per-command time path (~20 handlers + `make-comf-handler`).
 *
 * Phase 8: delegates to the single clock authority `advanceClock`
 * (`runtime/world/clock.ts`), so a command's time advance now also
 * recomputes `hourOfDay` / `dayIndex` AND fires the day-end settlement
 * (`runDayEnd`) on a midnight cross — faithfully to eraTW (day-end fires
 * when `TIME` crosses a day boundary, not only on sleep).
 *
 * **Return value (Phase 8 两图收口, R1 fix):** returns the day-end
 * NARRATION events produced when this advance crosses one or more
 * midnights (the wage/cleaning cashout lines). Callers that surface
 * events to the player (e.g. `makeComfHandler`) splice these into their
 * result so a command run late at night narrates the day rollover the
 * same way sleep does. The TIME_TICK signal is filtered out — it's an
 * internal clock heartbeat the UI reads straight off `state.time`. Most
 * call sites still use this as a `void` statement (no churn); they simply
 * ignore the return, which for the common no-midnight-cross case is `[]`.
 */
export function advanceTimeTicks(
  state: GameState,
  delta: number,
): ObservationEvent[] {
  // DAY-CYCLE-PLAN §S3: runDayEnd defaults to true — a command that crosses
  // midnight (熬夜) now fires day-end (wages / gate resets / dirt / calendar /
  // weather forecast), faithful to eraTW's @INFO_GO_NEXTDAY (INFO.ERB:1232).
  // The prior `{ runDayEnd: false }` (commit 20e0372a, no stated reason) made
  // staying up past midnight silently skip the whole day-end.
  const { events } = advanceClock(state, delta, () => 0);
  // Surface only the day-end NARRATIONs (wage/cleaning cashout); the
  // TIME_TICK is an internal clock signal, not player-facing here.
  return events.filter((e) => e.kind === "NARRATION");
}

// ---------------------------------------------------------------------------
// BASE recovery
// ---------------------------------------------------------------------------

/**
 * `RECOVER_PERMIL(chara, ‰, stat)` — restore `BASE[statId]` by
 * `trunc(MAXBASE[statId] * permille / 1000)`, capped at `MAXBASE[statId]`.
 * Mirrors eraTW's permille recovery (e.g. `COMF403 休憩` / `417 昼寝`'s
 * `回復率/1000 * MAXBASE`).
 *
 * If the stat's cap is unset/≤0 ("no max known"), this **no-ops** — it must
 * never use a 0 cap to zero a positive current value (the additive-slot
 * default-value rule applies to BASE current, but MAXBASE is a ceiling).
 */
export function recoverPermil(
  slot: CharaSlot,
  statId: number,
  permille: number,
): void {
  const max = slot.state.MAXBASE[statId] ?? 0;
  if (max <= 0) return;
  const cur = slot.state.BASE[statId] ?? 0;
  const amount = Math.trunc((max * permille) / 1000);
  slot.state.BASE[statId] = Math.min(max, cur + amount);
}

/**
 * `RECOVER(chara, amount, stat)` — flat restore of `BASE[statId]` by `amount`,
 * capped at `MAXBASE[statId]`. Mirrors eraTW's flat `RECOVER` (used by the
 * alcohol EFFECT arms, e.g. 甜酒 `RECOVER(MASTER, 50, "体力", "甜酒")`).
 *
 * If the stat's cap is unset/≤0 ("no max known"), this **no-ops** — same
 * ceiling rule as `recoverPermil` (never use a 0 cap to clamp a positive
 * current value down).
 */
export function recoverBase(
  slot: CharaSlot,
  statId: number,
  amount: number,
): void {
  const max = slot.state.MAXBASE[statId] ?? 0;
  if (max <= 0) return;
  const cur = slot.state.BASE[statId] ?? 0;
  slot.state.BASE[statId] = Math.min(max, cur + amount);
}

/**
 * TCVAR effect-timer slots decremented by the clock, era minute units
 * (AutoConst_TCVAR: 媚薬140=180min / 利尿剤141=60min / 強制排卵152=180min /
 * 糖138=20min — 原版 WorldScheduler 每 turn -1).
 */
const EFFECT_TIMER_TCVARS = [
  TCVAR_ID.媚薬,
  TCVAR_ID.利尿剤,
  TCVAR_ID.強制排卵,
  TCVAR_ID.糖,
];

/**
 * Decrement every chara's effect-timer TCVAR slots by `minutes` (floor 0).
 * Mirrors the upstream per-turn timer decrement; wired into `advanceClock`
 * so 媚薬/利尿剤/強制排卵/糖 效果自然消退.
 */
export function decrementEffectTimers(state: GameState, minutes: number): void {
  if (minutes <= 0) return;
  for (const slot of [state.master, ...Object.values(state.charas)]) {
    for (const id of EFFECT_TIMER_TCVARS) {
      const cur = slot.state.TCVAR[id] ?? 0;
      if (cur > 0) slot.state.TCVAR[id] = Math.max(0, cur - minutes);
    }
  }
}

// ---------------------------------------------------------------------------
// MASTER CFLAG accessors
// ---------------------------------------------------------------------------

/**
 * Write `state.master.state.CFLAG[id] = value`. Use this for the
 * MASTER's per-character flags (睡眠, 就寝時間, 同行, …). For
 * non-master charas, use `state.charas[N].state.CFLAG[id] = value`
 * directly — Phase 7 will add a `setCharaCflag` helper when the
 * pattern stabilizes.
 */
export function setMasterCflag(
  state: GameState,
  id: number,
  value: number,
): void {
  state.master.state.CFLAG[id] = value;
}

/** Read `state.master.state.CFLAG[id]`. Returns `0` if unset. */
export function getMasterCflag(state: GameState, id: number): number {
  return state.master.state.CFLAG[id] ?? 0;
}

// ---------------------------------------------------------------------------
// Chara-slot CFLAG / BASE accessors (mirror the MASTER helpers)
// ---------------------------------------------------------------------------

/**
 * Resolve the chara slot for `charaNum` (`0` = master, else `state.charas[id]`).
 * Throws if the NPC slot does not exist — callers must initialise the chara
 * before writing.
 */
function resolveSlot(state: GameState, charaNum: number): CharaSlot {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) {
    throw new Error(`resolveSlot: unknown charaNum ${charaNum}`);
  }
  return slot;
}

/** Write a chara's `CFLAG[id] = value`. `charaNum === 0` writes the MASTER. */
export function setCharaCflag(
  state: GameState,
  charaNum: number,
  id: number,
  value: number,
): void {
  resolveSlot(state, charaNum).state.CFLAG[id] = value;
}

/** Read a chara's `CFLAG[id]`. Returns `0` if unset. `charaNum === 0` reads MASTER. */
export function getCharaCflag(
  state: GameState,
  charaNum: number,
  id: number,
): number {
  return resolveSlot(state, charaNum).state.CFLAG[id] ?? 0;
}

/** Write a chara's `ABL[id] = value`. `charaNum === 0` writes the MASTER. */
export function setCharaAbl(
  state: GameState,
  charaNum: number,
  id: number,
  value: number,
): void {
  resolveSlot(state, charaNum).state.ABL[id] = value;
}

/** Read a chara's `ABL[id]`. Returns `0` if unset. `charaNum === 0` reads MASTER. */
export function getCharaAbl(
  state: GameState,
  charaNum: number,
  id: number,
): number {
  return resolveSlot(state, charaNum).state.ABL[id] ?? 0;
}

/** Write a chara's `BASE[id] = value`. `charaNum === 0` writes the MASTER. */
export function setCharaBase(
  state: GameState,
  charaNum: number,
  id: number,
  value: number,
): void {
  resolveSlot(state, charaNum).state.BASE[id] = value;
}

/** Read a chara's `BASE[id]`. Returns `0` if unset. `charaNum === 0` reads MASTER. */
export function getCharaBase(
  state: GameState,
  charaNum: number,
  id: number,
): number {
  return resolveSlot(state, charaNum).state.BASE[id] ?? 0;
}


/** Write `state.master.state.BASE[id] = value`. */
export function setMasterBase(
  state: GameState,
  id: number,
  value: number,
): void {
  state.master.state.BASE[id] = value;
}

/** Read `state.master.state.BASE[id]`. Returns `0` if unset. */
export function getMasterBase(state: GameState, id: number): number {
  return state.master.state.BASE[id] ?? 0;
}

/** Write `state.master.state.TALENT[id] = value` (namespace-safe accessor). */
export function setMasterTalent(
  state: GameState,
  id: number,
  value: number,
): void {
  state.master.state.TALENT[id] = value;
}

/** Read `state.master.state.TALENT[id]`. Returns `0` if unset. */
export function getMasterTalent(state: GameState, id: number): number {
  return state.master.state.TALENT[id] ?? 0;
}

/** Write `state.master.state.ABL[id] = value` (namespace-safe accessor). */
export function setMasterAbl(
  state: GameState,
  id: number,
  value: number,
): void {
  state.master.state.ABL[id] = value;
}

/** Read `state.master.state.ABL[id]`. Returns `0` if unset. */
export function getMasterAbl(state: GameState, id: number): number {
  return state.master.state.ABL[id] ?? 0;
}

/** Write `state.master.state.EXP[id] = value` (namespace-safe accessor). */
export function setMasterExp(
  state: GameState,
  id: number,
  value: number,
): void {
  state.master.state.EXP[id] = value;
}

/** Read `state.master.state.EXP[id]`. Returns `0` if unset. */
export function getMasterExp(state: GameState, id: number): number {
  return state.master.state.EXP[id] ?? 0;
}
