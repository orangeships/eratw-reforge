/**
 * Phase 5B/5C — Daily-system handler barrel + registration orchestrator.
 *
 * The single canonical entry point for catalog registration in the
 * daily-system slice. 5F's `apply_intent` switchover imports
 * `registerDailyHandlers` and calls it once at startup:
 *
 *   import { CommandCatalog } from "../command/catalog.js";
 *   import { registerDailyHandlers } from "../command/handlers/index.js";
 *
 *   const catalog = new CommandCatalog();
 *   registerDailyHandlers(catalog);
 *
 * Adding a 5D/5E handler is one new import + one `catalog.register`
 * line. The handler files themselves stay side-effect-free (they
 * only export `HandlerEntry` objects).
 *
 * `runtime/command/index.ts` (5A's barrel) is intentionally NOT
 * extended to re-export handlers — it stays a pure type/utility
 * surface so test fixtures can import the resolver without
 * triggering catalog registration.
 */

import type { CommandCatalog } from "../catalog.js";
import { moveHandlerEntry } from "./move.js";
import { inviteLocalDate992HandlerEntry } from "./invite-local-date.js";
import { cancelDateAppointment19996HandlerEntry } from "./cancel-date-appointment.js";
import { dateCrossRegion19997HandlerEntry, returnFromDate19998HandlerEntry } from "./date-travel.js";
import { acceptDateInvitation19989HandlerEntry, declineDateInvitation19988HandlerEntry } from "./date-invitation.js";
import { sleepHandlerEntry } from "./sleep.js";
import { workHandlerEntry } from "./work.js";
import { talkHandlerEntry } from "./talk.js";
import { headpatHandlerEntry } from "./headpat.js";
import { teaHandlerEntry } from "./tea.js";
import { lapPillowReceiveHandlerEntry } from "./lap-pillow-receive.js";
import { bellyRubHandlerEntry } from "./belly-rub.js";
import { nightCapHandlerEntry } from "./night-cap.js";
import { moveToShrineHandlerEntry } from "./move-to-shrine.js";
import { moveToReitenHandlerEntry } from "./move-to-reiten.js";
import { moveToVillageHandlerEntry } from "./move-to-village.js";
import { moveToHomeHandlerEntry } from "./move-to-home.js";
import { moveToKoumakanHandlerEntry } from "./move-to-koumakan.js";
import { moveToTikurinHandlerEntry } from "./move-to-tikurin.js";
// Phase 8 (2026-07-09) — six mapId 5-10 cross-movers (forest/meikai/sanroku/
// sanchou/chitei/moon) wired in kuchiku-mark-rescue follow-up. Each carries
// a paired `makeXxxRoomMoveHandlers()` factory for the in-map room-to-room
// transitions (15001+ / 16001+ / … synthetic, generated from upstream
// CAN_MOVE_{05..10} via gen-remaining-map-scenes.mjs 2026-07-09).
import { moveToForestHandlerEntry } from "./move-to-forest.js";
import { moveToMeikaiHandlerEntry } from "./move-to-meikai.js";
import { moveToSanrokuHandlerEntry } from "./move-to-sanroku.js";
import { moveToSanchouHandlerEntry } from "./move-to-sanchou.js";
import { moveToChiteiHandlerEntry } from "./move-to-chitei.js";
import { moveToMoonHandlerEntry } from "./move-to-moon.js";
import { makeForestRoomMoveHandlers } from "./forest-move.js";
import { makeMeikaiRoomMoveHandlers } from "./meikai-move.js";
import { makeSanrokuRoomMoveHandlers } from "./sanroku-move.js";
import { makeSanchouRoomMoveHandlers } from "./sanchou-move.js";
import { makeChiteiRoomMoveHandlers } from "./chitei-move.js";
import { makeMoonRoomMoveHandlers } from "./moon-move.js";
import { goOut405HandlerEntry } from "./go-out.js";
import { mobGirlSearchHandlerEntry } from "./mob-girl-search.js";
import { makeShrineRoomMoveHandlers } from "./room-move.js";
import { makeVillageRoomMoveHandlers } from "./village-move.js";
import { makeReitenRoomMoveHandlers } from "./reiten-move.js";
import { makeKoumakanRoomMoveHandlers } from "./koumakan-move.js";
import { makeTikurinRoomMoveHandlers } from "./tikurin-move.js";
import { oshitaoshiHandlerEntry } from "./oshitaoshi.js";
import { apologizeHandlerEntry } from "./apologize.js";
import { listenComplaintsHandlerEntry } from "./listen-complaints.js";
import { cleaningHandlerEntry } from "./cleaning.js";
import { gatheringHandlerEntry } from "./gathering.js";
import { stallHandlerEntry } from "./stall.js";
import { chickenCoop499HandlerEntry } from "./chicken-coop-499.js";
import { gropeButtHandlerEntry } from "./grope-butt.js";
import { mealHandlerEntry } from "./meal.js";
import { bathRelaxHandlerEntry } from "./bath.js";
import { sentoHandlerEntry } from "./sento.js";
import { clinic616HandlerEntry } from "./clinic-616.js";
import { serveMealHandlerEntry } from "./serve-meal.js";
import { serveDrinkHandlerEntry } from "./serve-drink.js";
import { prayerHandlerEntry } from "./prayer.js";
import { omikujiHandlerEntry } from "./omikuji.js";
import { moriyaOmikujiHandlerEntry } from "./moriya-omikuji.js";
import { whiteDayHandlerEntry } from "./white-day.js";
import { comf364HandlerEntry } from "./mamemaki.js";
import { performMusicHandlerEntry } from "./perform-music.js";
import {
  comf201HandlerEntry,
  comf270HandlerEntry,
  comf999HandlerEntry,
  comf650HandlerEntry,
} from "./sentinels.js";
import { disabledStubEntries } from "./disabled-stubs.js";
import { comf425HandlerEntry } from "./deferred-kitchen.js";
import { itemUse490HandlerEntry } from "./item-use.js";
import {
  comf631HandlerEntry,
  comf632HandlerEntry,
  comf633HandlerEntry,
  comf634HandlerEntry,
} from "./casino.js";
import { comf480HandlerEntry } from "./danmaku.js";
import { comf448HandlerEntry, comf449HandlerEntry } from "./bug-catching.js";
import { comf621HandlerEntry } from "./fishing.js";
import {
  dateMeal610HandlerEntry,
  bento615HandlerEntry,
  holdHands603HandlerEntry,
  detour605HandlerEntry,
} from "./date-meal.js";
import { sansaku604HandlerEntry } from "./sansaku-604.js";
import { sweetsShop617HandlerEntry } from "./sweets-617.js";
import { souvenirShop626HandlerEntry } from "./souvenir-shop.js";
import { confession352HandlerEntry } from "./confession.js";
import { omaneki697HandlerEntry } from "./omaneki-697.js";
import { omaneki698HandlerEntry } from "./omaneki-698.js";
import { omaneki699HandlerEntry } from "./omaneki-699.js";
import { cookHandlerEntry } from "./cook.js";
import { waterDrawingHandlerEntry } from "./water-drawing.js";
import { farm418HandlerEntry } from "./farm.js";
import { sakeBug450HandlerEntry } from "./sake-bug.js";
import { readingHandlerEntry } from "./reading.js";
import { rukoto420HandlerEntry } from "./rukoto-420.js";
import { tennokoe422HandlerEntry } from "./tennokoe-422.js";
import { diary406HandlerEntry } from "./diary-406.js";
import { villageShopEntries } from "./village-shop.js";
import { bookRental620HandlerEntry } from "./book-rental.js";
import { dragonGodStatue627HandlerEntry } from "./dragon-god-statue.js";
import {
  comf366HandlerEntry,
  comf367HandlerEntry,
  comf630HandlerEntry,
} from "./commission.js";
import {
  condom50HandlerEntry,
  pill51HandlerEntry,
  swapRoles24HandlerEntry,
} from "./h-toggles.js";
import {
  comf351HandlerEntry,
  comf353HandlerEntry,
  comf354HandlerEntry,
  comf355HandlerEntry,
  comf356HandlerEntry,
  comf357HandlerEntry,
  comf358HandlerEntry,
  comf360HandlerEntry,
  comf361HandlerEntry,
  comf368HandlerEntry,
  comf850HandlerEntry,
} from "./family7.js";
import {
  comf317HandlerEntry,
  comf318HandlerEntry,
} from "./hip-thrust.js";
import {
  comf19HandlerEntry,
  comf23HandlerEntry,
  comf25HandlerEntry,
} from "./foreplay-extra.js";
import { comf233HandlerEntry } from "./magic-five-orgasm.js";
import {
  comf144HandlerEntry,
  comf71HandlerEntry,
  comf122HandlerEntry,
  comf185HandlerEntry,
  comf511HandlerEntry,
  comf26HandlerEntry,
} from "./h-remainder.js";
import { undress820HandlerEntry, undress821HandlerEntry } from "./undress.js";
import { insertionGSpot72HandlerEntry, insertionCervix73HandlerEntry } from "./insertion-derived.js";
import { comf401HandlerEntry } from "./panty-collection.js";
import { comf430HandlerEntry } from "./panty-change.js";
import { COMF_HANDLER_ENTRIES } from "../comf/defs/index.js";

export { moveHandlerEntry } from "./move.js";
export { sleepHandlerEntry } from "./sleep.js";
export { workHandlerEntry } from "./work.js";
export { talkHandlerEntry } from "./talk.js";
export { headpatHandlerEntry } from "./headpat.js";
export { teaHandlerEntry } from "./tea.js";
export { lapPillowReceiveHandlerEntry } from "./lap-pillow-receive.js";
export { bellyRubHandlerEntry } from "./belly-rub.js";
export { hugHandlerEntry } from "./hug.js";
export { kissHandlerEntry } from "./kiss.js";
export { nightCapHandlerEntry } from "./night-cap.js";
export { moveToShrineHandlerEntry } from "./move-to-shrine.js";
export { moveToReitenHandlerEntry } from "./move-to-reiten.js";
export { moveToVillageHandlerEntry } from "./move-to-village.js";
export { moveToHomeHandlerEntry } from "./move-to-home.js";
export { moveToKoumakanHandlerEntry } from "./move-to-koumakan.js";
export { moveToTikurinHandlerEntry } from "./move-to-tikurin.js";
export { goOut405HandlerEntry } from "./go-out.js";
export { inviteLocalDate992HandlerEntry } from "./invite-local-date.js";
export { cancelDateAppointment19996HandlerEntry } from "./cancel-date-appointment.js";
export { oshitaoshiHandlerEntry } from "./oshitaoshi.js";
export { updateKojoHandlerEntry } from "./update-kojo.js";

/**
 * Register all daily-system command handlers.
 */
export function registerDailyHandlers(catalog: CommandCatalog): void {
  catalog.register(moveHandlerEntry);
  catalog.register(sleepHandlerEntry);
  catalog.register(workHandlerEntry);
  catalog.register(talkHandlerEntry);
  catalog.register(headpatHandlerEntry);
  // Phase 7.2 — Tier 1+2 light-touch handlers (template-driven).
  // 332 (sake) and 336 (lap pillow give) intentionally omitted: 霊夢's
  // main kojo file doesn't define @-funcs for them (we checked in M2).
  catalog.register(teaHandlerEntry);
  catalog.register(lapPillowReceiveHandlerEntry);
  catalog.register(bellyRubHandlerEntry);
  catalog.register(nightCapHandlerEntry);
  // Phase 7.3 — real move handlers for the three locations reachable
  // from the M6 scene roster. The 4.5B mock MOVE table in
  // apply-intent.ts is now a no-op (catalog.has() intercepts first).
  catalog.register(moveToShrineHandlerEntry);
  catalog.register(moveToReitenHandlerEntry);
  catalog.register(moveToVillageHandlerEntry);
  catalog.register(moveToHomeHandlerEntry);
  catalog.register(moveToKoumakanHandlerEntry);
  catalog.register(moveToTikurinHandlerEntry);
  catalog.register(moveToForestHandlerEntry);
  catalog.register(moveToMeikaiHandlerEntry);
  catalog.register(moveToSanrokuHandlerEntry);
  catalog.register(moveToSanchouHandlerEntry);
  catalog.register(moveToChiteiHandlerEntry);
  catalog.register(moveToMoonHandlerEntry);
  // ODEKAKE O1 — COMF405 外出: B9 destination picker + MAPID-backed
  // CFLAG:约会中 writer, unlocking already-ported date commands.
  catalog.register(goOut405HandlerEntry);
  catalog.register(mobGirlSearchHandlerEntry);
  catalog.register(inviteLocalDate992HandlerEntry);
  catalog.register(cancelDateAppointment19996HandlerEntry);
  catalog.register(dateCrossRegion19997HandlerEntry);
  catalog.register(returnFromDate19998HandlerEntry);
  catalog.register(acceptDateInvitation19989HandlerEntry);
  catalog.register(declineDateInvitation19988HandlerEntry);
  // L1 — shrine room-to-room movement (710-749).
  for (const entry of makeShrineRoomMoveHandlers()) {
    catalog.register(entry);
  }
  // 多地图 — 人間の里 (mapId=2) room-to-room movement (12001+ synthetic).
  // GENERATED from CAN_MOVE_2 原版; see village-move.ts header. Opens the
  // second walkable map; the 門 (P201, location "人間之里") is the entry
  // the move-to-village handler lands on.
  for (const entry of makeVillageRoomMoveHandlers()) {
    catalog.register(entry);
  }
  // 多地图 — 命蓮寺 (mapId=1) room-to-room movement (11000+ synthetic).
  // GENERATED from CAN_MOVE_01 原版; see reiten-move.ts header. P101 山門
  // (location "命蓮寺") is the entry the move-to-reiten handler lands on.
  for (const entry of makeReitenRoomMoveHandlers()) {
    catalog.register(entry);
  }
  // 多地图 — 紅魔館 (mapId=3) room-to-room movement (13001+ synthetic).
  // GENERATED from CAN_MOVE_03 原版 type-1/type-3 edges; see
  // koumakan-move.ts header. P301 正門 (location "紅魔館", root) is the
  // entry the move-to-koumakan handler lands on. 44 rooms across 4 map
  // pages (霧之湖/一階&地下/二階&三階/廃洋館).
  for (const entry of makeKoumakanRoomMoveHandlers()) {
    catalog.register(entry);
  }
  // 多地图 — 竹林 (mapId=4) room-to-room movement (14001+ synthetic).
  // GENERATED from CAN_MOVE_04 原版 type-1/type-3 edges; see tikurin-move.ts
  // header. P447 竹林入口 (location "迷途竹林", root) is the entry the
  // move-to-tikurin handler lands on. 60 rooms across 3 map pages
  // (永遠亭/夢幻館/迷途竹林).
  for (const entry of makeTikurinRoomMoveHandlers()) {
    catalog.register(entry);
  }
  // Phase 8 (2026-07-09) — six mapId 5-10 multi-map room-to-room move loops.
  // Each `makeXxxRoomMoveHandlers()` factory yields entries for the
  // intra-map edges (15001+ … 10999+ synthetic) wired by
  // gen-remaining-map-scenes.mjs and registered into the same commandNo
  // slots the scene.bundle.json JSON `exits[].commandNo` references.
  for (const entry of makeForestRoomMoveHandlers()) {
    catalog.register(entry);
  }
  for (const entry of makeMeikaiRoomMoveHandlers()) {
    catalog.register(entry);
  }
  for (const entry of makeSanrokuRoomMoveHandlers()) {
    catalog.register(entry);
  }
  for (const entry of makeSanchouRoomMoveHandlers()) {
    catalog.register(entry);
  }
  for (const entry of makeChiteiRoomMoveHandlers()) {
    catalog.register(entry);
  }
  for (const entry of makeMoonRoomMoveHandlers()) {
    catalog.register(entry);
  }
  // Phase 7 — family 7 H-mode entry gate (C-tier bespoke — ported
  // faithfully as a state machine, NOT a ComfDef; the ComfDef factory's
  // outcome-roll + SOURCE-settlement skeleton doesn't fit a pure
  // consent+mood gate). After this registers, the entire intimate
  // catalog (family 8-13) becomes reachable in the playable slice.
  catalog.register(oshitaoshiHandlerEntry);
  // Phase 7 — mood/anger subsystem (C-tier bespoke state machines, NOT
  // ComfDefs — they SELECTCASE on TFLAG and clear the anger cluster via
  // runtime/state/mood.ts). 303 謝る consumes 勃然大怒; 333 愚痴 consumes
  // 不機嫌 / 憤怒 — ≥2 consumers of the mood subsystem.
  catalog.register(apologizeHandlerEntry);
  catalog.register(listenComplaintsHandlerEntry);
  // Phase 7 — cleaning/dirt subsystem (C-tier; reads/writes the per-room
  // YOGORE dirt via runtime/state/yogore.ts). Solo-clean core; helper
  // settlement deferred to the next slice.
  catalog.register(cleaningHandlerEntry);
  // Phase 7 (P3) — gathering (C-tier bespoke; produces real 素材 ITEM via
  // the P1 ITEM namespace). COMF445 採集する, base algorithm — the gather
  // half of the 采集→売→MONEY loop. The sell→money half is deferred to P6
  // (multi-map town shops); the QOL draw patch + MAGIC_DLC + participant
  // arms are deferred mod-layer/subsystems (see gathering.ts header).
  catalog.register(gatheringHandlerEntry);
  // Phase 7.5 (§3C) — 露店 (C-tier bespoke; sells gathered 素材 ITEM →
  // MONEY, closing the 采集→売→MONEY loop's deferred sell half). COMF447
  // 露店を開く: the mechanism (sellable table / stall-spot / 商人パワー /
  // @STALL_PRICE_SET / 来客 sale loop / settlement) is in
  // runtime/state/stall.ts; this handler is the execCheck + lineup +
  // narration wrapper. Interactive per-item picker (B9) + 酒类招呼 +
  // 贩售事件 + calendar/weather/festival corrections + assistant are
  // deferred (see stall.ts header). master-only — uses the new multi-map
  // (神社境内 spot 1 needs 霊夢親密≥5; 人里中央広場 spot 3 has no gate).
  catalog.register(stallHandlerEntry);
  catalog.register(chickenCoop499HandlerEntry);
  // Phase 7.5 (§3E) — 尻を撫でる (C-tier bespoke; the セクハラ族 root
  // exemplar). COMF310: a 親密 5-tier × TFLAG:193 4-tier two-axis state
  // machine the ComfDef factory can't express (the 親密 branch overrides
  // the roll outcome). Shared skeleton — getSuccessRate / hitoke /
  // kojoForcedFailure / applySekuharaTier — lives in runtime/state/
  // sekuhara.ts so 317/318/332 換皮 siblings reuse it. Time-stop bypass
  // arm (TSP -10) + HITOKE bystander doubling + 好感度 penalty as
  // favorBias. See grope-butt.ts header for the defer list.
  catalog.register(gropeButtHandlerEntry);
  // Phase 7.5 (§3F) — 食事 (C-tier bespoke; the B7-eat eat-loop). COMF414
  // 食事を取る + COMF415 食事をふるまう: the cooking/DISH subsystem's eat
  // half. The mechanism (DISH state, @吃飯 non-DLC recovery, @REVIEW_DISH
  // evaluation, @満腹度上昇, @COM414_実食 SOURCE, @KIGEN_CHANGE) is in
  // runtime/state/dish.ts; these handlers are the execCheck + orchestration
  // (assemble participants → per-NPC 実食 loop → master eat (414) / serve-only
  // (415) → TIME/同行 advance). The dish is seeded via seedDish() — COMF413
  // 料理を作る (B7-cook: COOKING_UI + DISH_TASTE_FROM_CHARA + DISHDATA 170-dish
  // import) is deferred. MAGIC_DLC_料理相关 / INROOM/BATHCHECK / KOJO TFLAG:192
  // / interactive ASK_YN (B9) / 料理リセット defer (see meal.ts header).
  catalog.register(mealHandlerEntry);
  catalog.register(bathRelaxHandlerEntry);
  catalog.register(sentoHandlerEntry);
  catalog.register(serveMealHandlerEntry);
  // Phase 7.5 (§3E follow-up) — COMF332 お酒をふるまう (serve alcohol). The
  // 酒/飲酒 mechanism lives in runtime/state/alcohol.ts (parallel to dish.ts):
  // the @酒データ{N} registry (51浊酒/52清酒/53鬼杀酒/54红酒/55神酒/56甜酒/
  // 58蒸馏酒/59药酒/513一夜奇稻田 — representative subset; ~44 more deferred),
  // @DRUNKEN (酒気 + central 酒耐性 mult, skipped for 一夜奇稻田, master
  // ÷(1+醒酒药), MAXBASE cap), @ALCOHOL_TASTE (per-chara TASTE ladder +
  // 口上特殊補正), @EFFECT_酒データ (甜酒/药酒 flat RECOVER), @COM332_1 SOURCE.
  // 酒一覧表示 picker + 说服 INPUT arm (B9) deferred — auto-serves first
  // drinkable alcohol; 烂酔奸/酒気>2/3/酒耐性==-2 refusal arms modeled as
  // refuse-noop. 鬼 race arm structural-but-inert (isOni→false pending race map).
  catalog.register(serveDrinkHandlerEntry);
  // Phase 7 — MONEY namespace (C-tier bespoke; spends the global yen pool
  // via runtime/state/money.ts). 421 願掛け (option 2 心の平安 only — the
  // other 14 options are IKENIE/ subsystem and deferred) + 434 おみくじ
  // (8-bucket MVP fortune; the full FORTUNE 12-CASE subsystem is deferred).
  // These unblock the家族 4 shrine tail + 家族 5 shop money-gated commands.
  catalog.register(prayerHandlerEntry);
  catalog.register(omikujiHandlerEntry);
  catalog.register(moriyaOmikujiHandlerEntry);
  catalog.register(whiteDayHandlerEntry);
  // Phase 7 (Wave 0) — sentinel / dummy COMF commands. 201 (RETURN 0,
  // disabled), 999 (RETURN 1, dummy), 270 (JUMP KOJO_MESSAGE_SEND, the
  // H-mode 270-299 kojo dispatch shell). Real upstream COMF files with
  // trivial bodies; ported faithfully as thin handlers so coverage
  // reaches 270/270 without fabricating behavior. Resolver-only — none
  // appear in the trial action menu (BASIC_ACTION_NOS).
  catalog.register(comf201HandlerEntry);
  catalog.register(comf999HandlerEntry);
  catalog.register(comf270HandlerEntry);
  // Phase 7 (Wave 3) — COMF650 git, a joke command (RETURN -1 canceled).
  catalog.register(comf650HandlerEntry);
  // COMF490 is a real upstream item menu (its gate returns 1 after the
  // normal menu-reach check), not a disabled stub. The picker currently
  // exposes the deterministic food/dessert arms; other item effects stay
  // safely out of the selectable list until modelled.
  catalog.register(itemUse490HandlerEntry);
  catalog.register(comf425HandlerEntry);
  // COM498 料理之铁人 belongs to the excluded DLC/custom command set for
  // this product. Keep it out of the catalog rather than exposing a deferred
  // command that looks playable in Act_COM.
  // Commission system — promoted from previous disabled-stub posture into a
  // playable V1: 366 listens/reports, 367 executes active slots, 630 is the
  // separate Hobgoblin outsource service.
  catalog.register(comf366HandlerEntry);
  catalog.register(comf367HandlerEntry);
  catalog.register(comf630HandlerEntry);
  // Phase 7 (Wave 2a) — upstream-disabled COMF stubs. ERB audit found
  // their @COM_ABLE<NNN> leads with an unconditional RETURN 0 (;一時停止),
  // so they're not executable upstream — faithful port = execCheck blocked.
  // Their rich @COM bodies (352 告白 268-line ASK_YN, 423 ITEMSALES shop,
  // …) are upstream dead code until the stub gate is lifted. Mirrors the
  // Wave-0 sentinel posture. Resolver-only; not in trial action menu.
  for (const entry of disabledStubEntries) catalog.register(entry);
  // Phase 7 (Wave 2b) — casino/gambling minigame MVP stubs (631-634).
  // Portable gates + TIME/NARRATION; the minigame loops (CASINO_ENTRANCE /
  // BATTLE_SYSTEM / Stone_Entry contest / TOBA 賭場) are DEFERRED per the
  // plan's minigame posture. All four gate on unbuilt locations → live-
  // unreachable (like 364); settlement pinned by direct-call tests.
  catalog.register(comf480HandlerEntry);
  // 捕虫：448 诱捕装置与 449 主动捕虫共用虫笼/图鉴和权威时钟结算。
  catalog.register(comf448HandlerEntry);
  catalog.register(comf449HandlerEntry);
  catalog.register(comf621HandlerEntry);
  catalog.register(comf631HandlerEntry);
  catalog.register(comf632HandlerEntry);
  catalog.register(comf633HandlerEntry);
  catalog.register(comf634HandlerEntry);
  // Phase 7 (Wave 2c) — date-meal settlements (610 食事デート / 615 お弁当).
  // Deterministic (RAND success-tier, no B9); reuse dish.ts 満腹度上昇 +
  // recoverPermil. Reachability gates on a dating subsystem (Wave 3) —
  // execCheck blocks until CFLAG:12 (约会中) is set; settlement pinned by
  // direct-call tests that set the dating flag.
  catalog.register(dateMeal610HandlerEntry);
  catalog.register(bento615HandlerEntry);
  // Phase 7 (Wave 2c) — COMF413 料理を作る, the first real B9 picker. The
  // 400-line COOKING_UI redraw loop collapses to a dish-type pickOne prompt
  // → seedDish → cook-cost settlement; the 414 eat loop then consumes it.
  // DISHDATA 170-menu / ingredients / helper / 練習 DEFERRED (B7-cook full).
  catalog.register(cookHandlerEntry);
  // Phase 7 (Wave 3) — deterministic date-stroll commands 603 手を繋ぐ +
  // 605 寄り道する (no B9; same SOURCE-tier shape as 610/615, gated on
  // TFLAG:约会道中). Reachability via the dating subsystem (execCheck blocks
  // until 约会道中 + 约会中 are set); settlement pinned by direct-call tests.
  catalog.register(holdHands603HandlerEntry);
  catalog.register(detour605HandlerEntry);
  // Phase 7 (Wave 3 ODEKAKE O2) — COMF604 散歩する + COMF617 甘味処.
  // 604 = date-map zone picker (no SOURCE settlement; B9 7-zone picker +
  // Manhattan walk time + partner follow + デート道中 += walkMin). 617 =
  // sweet-shop date-meal variant (reuses 610's computeTier/Sources; smaller
  // RECOVER + "甜点" 満腹度). Both gated on CHK_DATENOW + a dating state
  // that O1 opened.
  catalog.register(sansaku604HandlerEntry);
  catalog.register(sweetsShop617HandlerEntry);
  // Phase 7 (chara-info 硬骨头批) — COMF626 土産屋: gift purchase for TARGET
  // at a gift-shop location (GIFT_GOT acquisition behind PAGE 3 礼物历史).
  catalog.register(souvenirShop626HandlerEntry);
  // Phase 7 (Slice 5) — COMF352 告白する: lover acquisition via ASK_YN +
  // 合意判定 (MVP, 告白女神 subsystem deferred). Promoted from the disabled
  // stub (upstream @COM_ABLE352 no longer returns 0 unconditionally here).
  catalog.register(confession352HandlerEntry);
  // Phase 7 (Wave 3 ODEKAKE O3) — COMF697 部屋を訪ねる + COMF698 部屋に入る +
  // COMF699 外に出る. OMANEKI 私室邀请 三联: 697 = B9 picker (RAND tier +
  // ASK_YN 邀请约会 defer) → omanekiEnter. 698 = chara home + CHK_DATENOW +
  // IS_FALLEN consent gate + 嫉妬/浮気 detect → omanekiEnter. 699 =
  // guest-room-only gate + omanekiLeave back to homeLocation. All three
  // share `runtime/world/omaneki.ts` (OMANEKIBEYA=98 + 汚臭耐性 dirt init).
  catalog.register(omaneki697HandlerEntry);
  catalog.register(omaneki698HandlerEntry);
  catalog.register(omaneki699HandlerEntry);
  // Phase 7 (Wave 3b) — village produce/food shops (614 食料品店 / 618 花屋 /
  // 622 八百屋). B9 picker over a per-shop TYPE-categorized catalog (shop.ts
  // VILLAGE_SHOPS) → shopBuy. Gated on the village shop scene location.
  // Clinic 616 is a bespoke treatment + tool-shop flow. 619/623-625 remain
  // deferred; 617/626 are wired above and 620/627 below.
  for (const entry of villageShopEntries) catalog.register(entry);
  catalog.register(clinic616HandlerEntry);
  catalog.register(bookRental620HandlerEntry);
  catalog.register(dragonGodStatue627HandlerEntry);
  // Phase 7 (Wave 4d) — H-mode toggle/utility commands (50 ゴム装着 /
  // 51 避妊薬 / 24 攻守交替). Bespoke — no SOURCE settlement; they flip
  // EQUIP/TCVAR/CFLAG + consume items + re-route the H scene's initiative.
  // 50/51 are `RETURN 0` (no turn cost, outcome noop); 24 is `RETURN 1`
  // (TIME+5, partner-led). @COM_ABLE gates (TFLAG:100, HAS_PENIS, 欲情
  // GETPALAMLV, equipment locks) are the COMABLE layer, deferred.
  catalog.register(condom50HandlerEntry);
  catalog.register(pill51HandlerEntry);
  catalog.register(swapRoles24HandlerEntry);
  // Phase 7 (Wave 4e) — family 7 H-mode / mode-machine cluster (11 cmds).
  // うふふ mode-control + social/ability siblings of 350 押し倒す: enter /
  // re-route / exit the H-mode session + the partner-led (诶嘿嘿==2) counter
  // economy. Bespoke — consent gates, mode toggles, counter subsystems the
  // ComfDef factory can't express. 351 連れ出す / 353 イタズラ / 354 添い寝 /
  // 355 時間停止 / 356 物陰に誘う / 358 他者変身 / 360 身を任せる / 361 抵抗 /
  // 850 抜け出す port the faithful core; 357 セフレ契約 (理性/欲望 reasonwall)
  // + 368 自由行動 (supported Activity_* source arms) are bespoke ports.
  // See family7.ts header for the per-command defer list.
  catalog.register(comf351HandlerEntry);
  catalog.register(comf353HandlerEntry);
  catalog.register(comf354HandlerEntry);
  catalog.register(comf355HandlerEntry);
  catalog.register(comf356HandlerEntry);
  catalog.register(comf357HandlerEntry);
  catalog.register(comf358HandlerEntry);
  catalog.register(comf360HandlerEntry);
  catalog.register(comf361HandlerEntry);
  catalog.register(comf368HandlerEntry);
  catalog.register(comf850HandlerEntry);
  // Phase 7 (Wave 4f) — COMF317 腰を動かす (V) + COMF318 腰を動かす（Ａ）.
  // H-mode thrust (Ｖ/Ａコンボ + 射精部位 + 快Ｃ/快Ｖ/快Ａ SOURCE). Shared
  // parametric core; Ｖ/Ａコンボ picker + PAIN_CHECK + STAIN + HETEROSEX
  // deferred (hip-thrust.ts header). execCheck reachability = 诶嘿嘿==2 etc.
  catalog.register(comf317HandlerEntry);
  catalog.register(comf318HandlerEntry);
  // Phase 7 (Wave 4g) — COMF19 キス継続 + COMF23 ピロートーク +
  // COMF25 二穴愛撫. Foreplay bespoke (kiss toggle / pillow-talk dynamic
  // roll + recovery / dual V-A fingering). KISS_* helpers + PAIN_CHECK +
  // STAIN + HETEROSEX deferred (foreplay-extra.ts header).
  catalog.register(comf19HandlerEntry);
  catalog.register(comf23HandlerEntry);
  catalog.register(comf25HandlerEntry);
  // Phase 7 (Wave 4i) — COMF233 五重绝顶魔法. DLC-gated magic command;
  // execCheck blocks when Five_Orgasm_Magic==0 (DLC off, faithful). The magic
  // override floors all pleasure SOURCE at MAX(魔法强度,1000).
  catalog.register(comf233HandlerEntry);
  // Phase 7 (Wave 4h) — Wave 4 H-mode remainder. COMF144 放尿 is a full
  // faithful port (gates ride on おもらし有効/利尿剤/漏尿癖/従順, all modeled).
  // COMF71 二穴挿し / COMF122 助手を犯させる / COMF185 助手を犯す /
  // COMF511 二本フェラ / COMF26 抜く are faithful BLOCKED: their @COM_ABLE
  // gates ride on the unmodeled TEQUIP insertion-pose / ASSI subsystems
  // (systematically deferred to the COMABLE/equipment layer). No empty shells.
  catalog.register(comf144HandlerEntry);
  catalog.register(comf71HandlerEntry);
  catalog.register(comf122HandlerEntry);
  catalog.register(comf185HandlerEntry);
  catalog.register(comf511HandlerEntry);
  catalog.register(comf26HandlerEntry);
  // CLOTHES P1-b — USERCOM 820 脱衣服 (B3 picker: 全裸/着衣PLAY/只穿内衣)
  // + USERCOM 821 偷胖次. H-mode only (CFLAG:诶嘿嘿==2, 推倒後).
  // Both strip TARGET + MASTER via the P1-a clothing-write API.
  catalog.register(undress820HandlerEntry);
  catalog.register(undress821HandlerEntry);
  catalog.register(insertionGSpot72HandlerEntry);
  catalog.register(insertionCervix73HandlerEntry);
  // P4 — COMF401 收藏 (panty collection transfer)
  catalog.register(comf401HandlerEntry);
  catalog.register(comf430HandlerEntry);
  // Phase 7 (Wave 1) — COMF364 豆まき. Multi-target bespoke (loops all
  // present NPCs, can't be a ComfDef). execCheck is double-deferred
  // (節分 calendar + 鬼族 race) so it blocks live; settlement pinned by
  // direct-call tests. The presentNpcs helper is the reusable deliverable.
  catalog.register(comf364HandlerEntry);
  // Phase A (实玩反馈 #2) — COMF416 演奏する. Multi-target ORCHESTRATOR
  // (instrument picker + band/合奏 loop) the ComfDef factory can't express;
  // reuses comf416Def per-listener. Wins over the comf416Def factory entry in
  // the dup-guard below (BESPOKE_WINS), like the 305/306 touch pair.
  catalog.register(performMusicHandlerEntry);
  // Phase 7.5 — COMF419 水汲み. Free-action bespoke (RETURN -1): wash
  // 精液 CFLAG + VAR_WATER by location + TIME+3. PLACE_WATER gate
  // (手水舎/公用水井). STAIN/隙間guest/水桶 teleport deferred.
  catalog.register(waterDrawingHandlerEntry);
  // FARM-BREW A3 — COMF418 家庭菜園. B9 flattened per-plot menu
  // (种苗/浇水/收获/全收/拔出/施肥). PLACE_GARDEN + ITEM:150 + 気力 gate.
  // Nightly growth is the YASAI tick in sleep.ts; engine in state/farm.ts.
  catalog.register(farm418HandlerEntry);
  // FARM-BREW B3 — COMF450 酒虫の様子を見る. B9 flattened jar menu
  // (替换水+喂食 / 添加物配方 / TSP造酒 / 绯红之王). 神社:厨房 gate.
  // Nightly fermentation is the 酒造 tick in sleep.ts; engine in state/brewing.ts.
  catalog.register(sakeBug450HandlerEntry);
  // Phase 7.5 — COMF436 読書. B9 picker (文学/实用/小黄书) → RAND book-tier
  // → TFLAG:193 → EXP/SOURCE 歓楽+信頼+DOWNBASE 体力50/気力200+TIME+60.
  // IS_LIBRARY gate (夢幻遺跡3房 PLACE_STUDY). 魔导书/帕秋莉/DLC defer.
  catalog.register(readingHandlerEntry);
  catalog.register(rukoto420HandlerEntry);
  catalog.register(tennokoe422HandlerEntry);
  catalog.register(diary406HandlerEntry);
  // Route B + L3 — COMF500 UPDATE. Walks present TARGETs and invokes each
  // routable chara's `@M_KOJO_UPDATE_K{N}` body via the kojo router. Mirrors
  // upstream `qol_update.ERB@UPDATE_OF_KOJO_ORIGIN`. Most authors guard
  // the body with a `CFLAG:VERSION` check, so re-runs are no-ops.
  // NOTE: temporarily disabled — vitest+jsdom env (vite module resolver)
  // fails to load this import. tsx (node) loads it fine, tsc --noEmit
  // is clean. Re-enable once the app-test vite config handles `.js`
  // imports of files outside `web/`. Until then, wire it manually:
  //   import { updateKojoHandlerEntry } from "../../command/handlers/update-kojo.js";
  //   catalog.register(updateKojoHandlerEntry);
  // catalog.register(updateKojoHandlerEntry);
  // Route B + L3 — COMF500 UPDATE. Walks present TARGETs and invokes each
  // Phase 7 — Tier-A/B COMF commands ported via the ComfDef factory.
  // Phase 7 — Tier-A/B COMF commands ported via the ComfDef factory.
  //
  // **commandNo collision policy (2026-06-18, namespace debt resolved).**
  // The old 700-749 collision is GONE: the shrine navigation handlers
  // (move-to-shrine/village/home + room-move) now use SYNTHETIC ids in
  // the 10701-10749 range (= real COMF + 10000), so the real COMF700-749
  // 自慰系 ComfDefs register live alongside them. See room-move.ts header
  // + phase-7-family-map.md.
  //
  // Intentional collisions where a bespoke handler (registered above) wins
  // over the same-id ComfDef factory entry; the ComfDef stays on disk +
  // unit-tested as the settlement-faithful reference:
  //   - 305/306: KOJO-integrated touch handlers (lap-pillow-receive /
  //     belly-rub) carry the dialogue wiring the slice needs.
  //   - 416: the 演奏 multi-target orchestrator (instrument picker + band
  //     loop) the factory can't express; comf416Def is its per-listener core.
  // These are skipped explicitly; ANY OTHER collision is a real bug and must
  // throw (so a future latent dup can't hide again).
  const BESPOKE_WINS = new Set([305, 306, 416]);
  for (const entry of COMF_HANDLER_ENTRIES) {
    if (BESPOKE_WINS.has(entry.commandNo) && catalog.has(entry.commandNo)) {
      continue;
    }
    catalog.register(entry); // throws on any unexpected duplicate
  }
}
