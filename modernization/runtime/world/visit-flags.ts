/**
 * 拠点来訪（base visit / "串门"）— Slice V1: the daily visit-flag engine,
 * faithful to `@来訪フラグ` (`イベント関連/来訪フラグ.ERB`).
 *
 * Called once each morning (upstream `BEFORETRAIN.ERB:157 CALL 来訪フラグ`; modern
 * `finishPlayerSleep`, wired in Slice V4). It rolls "who drops by the master's
 * base today" and sets `CFLAG:拠点来訪` for the chosen NPCs. The placement
 * (`@主人公物件へ向かう`, Slice V2), the arrival kojo (Slice V3) and the morning
 * hook (Slice V4) consume that flag; departure (`@KITAKU`, EVENT 20) is Tier 1.
 *
 * Faithful algorithm (`@来訪フラグ`):
 *   基本来訪確率 = SELECTCASE 出禁人数*100/CHARANUM:  ≥60→15 / ≥40→16 / ≥20→17 / else→18
 *     (this is a RAND **divisor** — smaller = MORE likely)
 *   来訪人数上限 = TALENT:MASTER:千客万来 ? 30 : 20
 *   Phase 1 (guaranteed): 来訪可能(L,"強制") && (翌日来訪 || 依頼状況==3) → 来訪
 *   Phase 2 (probability), shuffled:
 *     来訪確率 = 基本 - !(!恋慕)*2 - 思慕 - キャラ来訪率補正(CFLAG:420+MAIN_MAP)
 *     SIF オナバレ → +=5
 *     IF DAY>30: d=DAY-最後に来訪した日 → d<4:+100 / d<8:+10 / d>30:*2/3 / d>20:*3/4
 *     来訪確率 = MAX(来訪確率,1)
 *     命中 ⟺ !RAND:(来訪確率 + 来訪抑制値)
 *     cap at 来訪人数上限
 *
 * **Deferred arms (faithful — these inputs are 0/absent in the modern roster, so
 * the branches are no-ops, not fakes):**
 *   - 宴会参加 / IN_HOME(宴会会場)         — populated by the world banquet scheduler
 *   - 来訪連鎖 (RELATION>100 結伴)         — no RELATION/相性 table
 *   - 危険日 KIKENBIHOUMON (翌日来訪 seed) — no estrus/pregnancy subsystem
 *   - 依頼状況==3                          — no commission subsystem (630)
 *   - 若鷺姫 泳池 gate, 妹紅/輝夜/月人 per-chara specials — not bundled
 *   - per-morning `KOJO_MESSAGE_SEND("BEFORETRAIN",…)` — orthogonal morning kojo
 *
 * **RNG:** uses the injected `Rng` (`rng.int(n)` == `RAND n`, `int(n)===0` ==
 * `!RAND:n`). The morning hook (V4) threads the real command-path rng; tests
 * inject a deterministic sequence. The Fisher-Yates order won't byte-match
 * upstream `@FISHER_YATES_SHAFFLE`, but the selection logic is pinned by tests.
 *
 * No upstream file mutation. See CLAUDE.md.
 */

import type { CharaSlot, GameState } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID, TALENT_ID } from "../state/settlement.js";
import { mapKeyOf } from "./location-predicates.js";
import { relationOf } from "./relation.js";

/** `CFLAG:(420 + MAIN_MAP)` — per-(chara, map) visit-rate correction base.
 *  No CSV import wires these in the modern runtime, so they read 0. */
const VISIT_RATE_CORRECTION_BASE = 420;

export type VisitReason = "guaranteed" | "probability" | "chain";

export interface VisitDecision {
  charaNum: number;
  reason: VisitReason;
}

export interface VisitFlagResult {
  /** NPCs flagged to visit the master's base today, in decision order. */
  visitors: VisitDecision[];
  /** `来訪者数 > 0` — caller pairs this with AT_HOME(MASTER) for the
   *  「〜好像有来访者的样子」overview narration. */
  anyVisitor: boolean;
}

function cflag(slot: CharaSlot, id: number): number {
  return slot.state.CFLAG[id] ?? 0;
}
function setCflag(slot: CharaSlot, id: number, v: number): void {
  slot.state.CFLAG[id] = v;
}
function talent(slot: CharaSlot, id: number): number {
  return slot.state.TALENT[id] ?? 0;
}

/** 基本来訪確率 — RAND divisor from the 出禁人数 ratio (smaller = more likely). */
export function baseVisitRate(bannedCount: number, charanum: number): number {
  const ratio = charanum > 0 ? (bannedCount * 100) / charanum : 0;
  if (ratio >= 60) return 15;
  if (ratio >= 40) return 16;
  if (ratio >= 20) return 17;
  return 18;
}

/** 来訪人数上限 — daily visitor cap (千客万来 talent on the master raises it). */
export function visitorCap(hasManyGuests: boolean): number {
  return hasManyGuests ? 30 : 20;
}

/** Inputs to `@来訪フラグ`'s per-chara 来訪確率 formula. `day`/`lastVisitDay`
 *  drive the recency damping (`DAY` / `最後に来訪した日`). */
export interface VisitRateInputs {
  baseRate: number;
  恋慕: boolean;
  思慕: number;
  /** キャラ来訪率補正 = CFLAG:(420+MAIN_MAP). */
  補正: number;
  オナバレ: boolean;
  day: number;
  lastVisitDay: number;
}

/**
 * 来訪確率 — the final RAND divisor for one chara (clamped to ≥1). A hit is
 * `!RAND:(来訪確率 + 来訪抑制値)`; this returns the `来訪確率` part. ERA integer
 * division truncates.
 */
export function computeVisitRate(inp: VisitRateInputs): number {
  let rate = inp.baseRate - (inp.恋慕 ? 2 : 0) - inp.思慕 - inp.補正;
  if (inp.オナバレ) rate += 5;
  // Recency damping — the first month (DAY ≤ 30) is exempt.
  if (inp.day > 30) {
    const d = inp.day - inp.lastVisitDay;
    if (d < 4) rate += 100;
    else if (d < 8) rate += 10;
    else if (d > 30) rate = Math.trunc((rate * 2) / 3);
    else if (d > 20) rate = Math.trunc((rate * 3) / 4);
  }
  return rate < 1 ? 1 : rate;
}

/** `GET_MAPID`-equivalent numeric id for the 420+MAIN_MAP correction index.
 *  Only 神社(0)/人間の里(2) are built; everything else defaults to 0. */
function mapIdOf(location: string): number {
  return mapKeyOf(location).includes("人間") ? 2 : 0;
}

/** `@来訪可能(ARG, ARGS)` — can this chara visit the base at all today. */
function canVisit(slot: CharaSlot, mode: number, forced: boolean): boolean {
  // 絶対来訪できない: shrine resident (lives here, doesn't "visit"), banned,
  // faceless mob, or hard 来訪不能.
  if (cflag(slot, CFLAG_ID.神社在住) > 0) return false;
  if (cflag(slot, CFLAG_ID.出禁) || talent(slot, TALENT_ID.路人)) return false;
  if (cflag(slot, CFLAG_ID.来訪不能)) return false;
  // 若鷺姫 泳池-改造 gate — deferred (DLC/char special, not bundled).

  if (forced) return true;

  // 交流来訪模式 gate.
  if (mode === 1) {
    if (cflag(slot, CFLAG_ID.好感度) <= 50) return false;
  } else if (mode === 2) {
    // Faithful arm needs 思慕/IS_LOVER/恋人/炮友; the lover/炮友 relationship
    // flags aren't modeled, so we conservatively require 恋慕||思慕.
    if (!talent(slot, TALENT_ID.恋慕) && !talent(slot, TALENT_ID.思慕)) return false;
  } else if (mode === 3) {
    return false;
  }
  // mode 0 = no favor gate (absolute gates above still apply).

  // Per-chara specials (妹紅/輝夜 好感度>500; 依姫/豊姫/探女 月人 須 恋慕||思慕)
  // — deferred: none of those charas are in the bundled roster, so the gate
  // would never change the outcome here.
  return true;
}

/** Deterministic Fisher-Yates over a copy of `ids`, driven by `rng`. */
function shuffle(ids: number[], rng: { int(max: number): number }): number[] {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * Roll today's base visitors and set `CFLAG:拠点来訪` (+ `最後に来訪した日`) on the
 * winners. Mutates `state.charas[*].state.CFLAG` in place; returns the chosen
 * list and whether anyone is coming. Call once per morning.
 */
export function computeVisitFlags(
  state: GameState,
  rng: { int(max: number): number },
): VisitFlagResult {
  const charas = Object.values(state.charas);
  const day = state.time.dayIndex;
  // 交流来訪模式 default = 1 (favor-gated) when unseeded; explicit 0 stays 0.
  const mode = state.flagStore[FLAG_ID.交流来訪模式] ?? 1;
  const bannedCount = state.flagStore[FLAG_ID.出禁人数] ?? 0;
  const charanum = charas.length; // NPC count (master is a separate slot)

  // 基本来訪確率 from the 出禁人数 ratio (RAND divisor; smaller = more likely).
  const baseRate = baseVisitRate(bannedCount, charanum);
  const cap = visitorCap(talent(state.master, TALENT_ID.千客万来) !== 0);
  const masterMapId = mapIdOf(state.homeLocation ?? state.master.location);

  // Re-evaluate fresh each morning: clear all flags first (upstream relies on the
  // prior night's @KITAKU having cleared them; clearing here is the safe superset).
  for (const c of charas) setCflag(c, CFLAG_ID.拠点来訪, 0);

  const visitors: VisitDecision[] = [];
  let visitorCount = 0;

  const markVisitor = (slot: CharaSlot, reason: VisitReason): void => {
    setCflag(slot, CFLAG_ID.拠点来訪, 1);
    setCflag(slot, CFLAG_ID.最後に来訪した日, day);
    visitorCount++;
    visitors.push({ charaNum: slot.charaNum, reason });
  };

  const banquetVenue = state.flagStore[FLAG_ID.宴会会場] ?? 0;

  // --- Phase 1: guaranteed (宴会参加 / 祈願対象 / 依頼達成・実行中). ---
  for (const c of charas) {
    // 宴会参加 (banquet guest): comes iff the venue is in the master's home map.
    // The world banquet scheduler projects 宴会参加/宴会会場 while active. A guest
    // is handled here and does NOT fall through to the 来訪可能 path.
    if (cflag(c, CFLAG_ID.宴会参加)) {
      if (masterMapId === banquetVenue) markVisitor(c, "guaranteed");
      continue;
    }
    const guaranteed =
      canVisit(c, mode, true) &&
      (cflag(c, CFLAG_ID.翌日来訪) !== 0 || cflag(c, CFLAG_ID.依頼状況) === 3);
    if (guaranteed) markVisitor(c, "guaranteed");
  }

  // --- Phase 2: probabilistic (shuffled). ---
  if (mode !== 3) {
    const order = shuffle(charas.map((c) => c.charaNum), rng);
    for (const charaNum of order) {
      if (visitorCount >= cap) break;
      const c = state.charas[charaNum];
      if (!c) continue;
      if (cflag(c, CFLAG_ID.拠点来訪)) continue; // already set in Phase 1
      if (!canVisit(c, mode, false)) continue;

      const rate = computeVisitRate({
        baseRate,
        恋慕: talent(c, TALENT_ID.恋慕) !== 0,
        思慕: talent(c, TALENT_ID.思慕),
        補正: c.state.CFLAG[VISIT_RATE_CORRECTION_BASE + masterMapId] ?? 0,
        オナバレ: cflag(c, CFLAG_ID.オナバレ) !== 0,
        day,
        lastVisitDay: cflag(c, CFLAG_ID.最後に来訪した日),
      });

      const divisor = rate + cflag(c, CFLAG_ID.来訪抑制値);
      // 命中 ⟺ !RAND:(divisor): rng.int(divisor) === 0.
      if (rng.int(divisor > 0 ? divisor : 1) === 0) {
        markVisitor(c, "probability");
        // 来訪連鎖 — a compatible (相性>100) friend tags along, max 2, reusing the
        // same shuffled order (faithful `来訪フラグ.ERB:99-114`). 相性200%→50%,
        // 120%→30%: hit ⟺ RAND:100 < 相性/4.
        let chain = 0;
        for (const otherNum of order) {
          if (chain >= 2 || visitorCount >= cap) break;
          if (otherNum === c.charaNum) continue;
          const other = state.charas[otherNum];
          if (!other) continue;
          if (cflag(other, CFLAG_ID.拠点来訪)) continue; // already visiting
          const rel = relationOf(c.charaNum, otherNum);
          if (rel <= 100) continue;
          if (!canVisit(other, mode, false)) continue;
          if (rng.int(100) < Math.trunc(rel / 4)) {
            markVisitor(other, "chain");
            chain++;
          }
        }
      }
    }
  }

  return { visitors, anyVisitor: visitorCount > 0 };
}
