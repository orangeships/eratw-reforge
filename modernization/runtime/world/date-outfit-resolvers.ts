/**
 * Runtime date-outfit resolvers for the characters whose `デート衣装`
 * declaration reads live state or RNG.
 *
 * `@EX_COSTUME` (衣服/CLOTHES.ERB:833-847) resolves the chara-data field
 * `{TYPE}衣装` at the moment the date starts:
 *
 *   EX_COS = GETMETH_INT(C_ID, "キャラデータ", NO:C_ID, @"%TYPE%衣装")
 *   SIF !EX_COS
 *       RETURN
 *   CALL OKIGAE(C_ID, EX_COS)
 *
 * `build-chara-data.ts` folds the *unconditional* declarations into
 * `chara-data.bundle.json` (`dateOutfitSet` / `villageDateOutfitSet`). Three
 * characters cannot be folded, because their data arm is a branch — the build
 * script names them and emits no field rather than guessing one:
 *
 *   140 龍    SELECTCASE DAY:2 / CASE 1,4 → 盛装和服套装 / CASEELSE → 浴衣穿搭
 *   79  雛    SIF !RAND:(3 - (2 * 勝負内衣判定([[雛]]))) → set 23
 *   90  青娥  SELECTCASE RAND:3 / CASE 2 → 生足美鈴套 / CASE 1 → 辣妹系休闲套装
 *
 * `dateOutfitSetFor` consults the bundle first and falls back here, so a
 * character with *both* a folded field and a resolver would use the folded
 * one — which is why these three carry no bundled field at all.
 *
 * ## 勝負内衣判定 (implemented, not deferred)
 *
 * 雛's arm is `SIF !RAND:(3 - (2 * 勝負内衣判定([[雛]])))` then
 * `MAKE_INT(V_NAME, 23)`. This was previously deferred to 0, which collapsed
 * the roll to `RAND:3` (1-in-3) even when upstream's predicate holds (1-in-1).
 *
 * The predicate's inputs are **all modelled**, so it is now ported faithfully
 * (`@勝負内衣判定`, CLOTHES_下半身下着_ずらし可能.ERB:1215-1234):
 * `TALENT:無知` (Talent 27), `CFLAG:既成事実 & 合意_诶嘿嘿` (bit 1),
 * `TALENT:恋慕` (Talent 3), `CFLAG:翌日来訪` (CFLAG 362), and the
 * `DAY:2` season / `DAY:3` date window. See {@link competitiveSwimsuitEligible}.
 *
 * ## DAY:2
 *
 * 龍 branches on `DAY:2`, which upstream is overloaded (used both as a month
 * and compared against `季节_冬` in `GMF_MOVEMENTS.ERB:730`). The modern
 * kojo router already resolves `DAY:2` to the **season**
 * (`runtime/kojo/static-router.ts` → `state.time.season`), so this module
 * follows that existing interpretation rather than inventing a second one:
 * season 1 (spring) and 4 (winter) get the formal kimono. `@勝負内衣判定` uses
 * the same reading (`DAY:2 == 1` = spring, `== 4` = winter), which is consistent
 * with `天候システム.ERH:885-888` (`季节_春 = 1` … `季节_冬 = 4`).
 */

import type { GameState } from "../state/game-state.js";
import { outfitSetIdByName } from "../state/outfit-sets.generated.js";
import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { dateOf, seasonOf } from "./calendar.js";

/** The slice of `Rng` these resolvers need (`RAND n` semantics: `[0, n)`).
 *  Declared structurally so `world/` does not import `command/`. */
export interface DateOutfitRng {
  int(max: number): number;
}

/** Which `EX_COSTUME` type is being resolved — `SET_DATE` calls
 *  `EX_COSTUME(C_ID, "人里デート")` on MAPID 2 and `"デート"` elsewhere
 *  (ERB/SET_CMN.ERB:302-312). */
export type DateOutfitKind = "date" | "village";

/** Resolve a 衣装セット id from its upstream name, failing loudly.
 *
 *  Ids are looked up rather than hard-coded so that regenerating
 *  `outfit-sets.generated.ts` can never silently repoint a resolver. */
function setId(name: string): number {
  const id = outfitSetIdByName(name);
  if (id === undefined) {
    throw new Error(
      `date-outfit-resolver: 衣装セット「${name}」 is not in outfit-sets.generated.ts — ` +
        `regenerate it with \`pnpm run build-outfit-sets\`.`,
    );
  }
  return id;
}

const SET_盛装和服 = setId("盛装和服套装");
const SET_浴衣 = setId("浴衣穿搭");
/** 雛 uses a bare literal id upstream (`MAKE_INT(V_NAME, 23)`), not a name. */
const SET_雛私服D = 23;
const SET_生足美鈴 = setId("生足美鈴套");
const SET_辣妹休闲 = setId("辣妹系休闲套装");

/** 雛 — `[[雛]]` in `Chara_data_79_雛.ERB`. Fixed upstream, so fixed here. */
const HINA_CHARA_NUM = 79;

/** 龍 — `SELECTCASE DAY:2 / CASE 1,4 → 盛装和服套装 / CASEELSE → 浴衣穿搭`.
 *  Declares デート衣装 / 人里デート衣装 / おうちデート衣装 alike, so `kind` is
 *  unused; the parameter stays for a uniform signature. */
function resolveRyouko(_kind: DateOutfitKind, state: Readonly<GameState>): number {
  const season = state.time.season ?? 1;
  return season === 1 || season === 4 ? SET_盛装和服 : SET_浴衣;
}

/** `合意_诶嘿嘿 = 1p1` — bit 1 of `CFLAG:既成事実` (`DIM_als.ERH:312`). */
const 合意_诶嘿嘿_BIT = 1 << 1;

/**
 * `@勝負内衣判定(ARG)` — the 勝負内衣 (competitive swimsuit) unlock predicate.
 * `CLOTHES_下半身下着_ずらし可能.ERB:1215-1234`.
 *
 * Upstream, verbatim:
 *
 *     IF !TALENT:ARG:無知
 *         SIF (CFLAG:ARG:既成事實 & 合意_诶嘿嘿 || (TALENT:ARG:恋慕 > 0)) && CFLAG:ARG:翌日来訪
 *             RETURNF 1
 *         IF DAY:2 == 1
 *             SELECTCASE DAY:3
 *                 CASE 14
 *                     SIF (TALENT:ARG:恋慕 > 0)
 *                         RETURNF 1
 *         ENDCASE
 *         ELSEIF DAY:2 == 4
 *             SELECTCASE DAY:3
 *                 CASE 14, 24, 25
 *                     SIF (TALENT:ARG:恋慕 > 0)
 *                         RETURNF 1
 *         ENDCASE
 *         ENDIF
 *     ENDIF
 *     RETURNF 0
 *
 * So: ignorance blocks everything; otherwise it is a *date-window* predicate —
 * 恋慕 (being in love) plus either a booked next-day visit (with sex consent,
 * or plain 恋慕) or a specific festival day. Spring 14 = 白色情人节,
 * winter 14 = 情人节, winter 24/25 = 平安夜/圣诞.
 */
export function competitiveSwimsuitEligible(
  state: Readonly<GameState>,
  charaNum: number,
): 0 | 1 {
  const slot = state.charas[charaNum];
  if (!slot) return 0;
  const st = slot.state;
  // 無知 — ignorance of sexual matters blocks the whole predicate.
  if ((st.TALENT[TALENT_ID.無知] ?? 0) !== 0) return 0;

  const inLove = (st.TALENT[TALENT_ID.恋慕] ?? 0) > 0;
  const consented = ((st.CFLAG[CFLAG_ID.既成事実] ?? 0) & 合意_诶嘿嘿_BIT) !== 0;
  const visitsTomorrow = (st.CFLAG[CFLAG_ID.翌日来訪] ?? 0) !== 0;
  if ((consented || inLove) && visitsTomorrow) return 1;

  // `DAY:2` = season (1=春 2=夏 3=秋 4=冬), `DAY:3` = day-of-month.
  const season = seasonOf(state.time);
  const date = dateOf(state.time);
  if (!inLove) return 0;
  if (season === 1) return date === 14 ? 1 : 0;
  if (season === 4) return date === 14 || date === 24 || date === 25 ? 1 : 0;
  return 0;
}

/** 雛 — `SIF !RAND:(3 - (2 * 勝負内衣判定))` then `MAKE_INT(V_NAME, 23)`.
 *
 *  `RAND:n` yields `[0, n)` and `!RAND:n` only fires on 0, so the weight is
 *  `1 / (3 - 2*判定)`: **1-in-3** when the predicate fails, **1-in-1** when it
 *  holds (`RAND:1` can only return 0). The charaNum is fixed to 雛 because
 *  upstream hard-codes `[[雛]]` at the call site. */
function resolveHina(
  _kind: DateOutfitKind,
  state: Readonly<GameState>,
  rng: DateOutfitRng,
): number | undefined {
  const weight = 3 - 2 * competitiveSwimsuitEligible(state, HINA_CHARA_NUM);
  return rng.int(weight) === 0 ? SET_雛私服D : undefined;
}

/** 青娥 — `SELECTCASE RAND:3 / CASE 2 → 生足美鈴套 / CASE 1 → 辣妹系休闲套装`.
 *  A roll of 0 matches no CASE, so no outfit is set — which is faithful: the
 *  `MAKE_INT` simply never runs and `EX_COSTUME` returns early. */
function resolveSeiga(_kind: DateOutfitKind, rng: DateOutfitRng): number | undefined {
  switch (rng.int(3)) {
    case 2:
      return SET_生足美鈴;
    case 1:
      return SET_辣妹休闲;
    default:
      return undefined;
  }
}

type Resolver = (kind: DateOutfitKind, state: Readonly<GameState>, rng: DateOutfitRng) => number | undefined;

/** charaNum → resolver. Keyed by charaNum so an unlisted character simply
 *  resolves to `undefined` (no date outfit), exactly like upstream's
 *  `SIF !EX_COS / RETURN`. */
const RESOLVERS: Readonly<Record<number, Resolver>> = {
  [HINA_CHARA_NUM]: (k, s, r) => resolveHina(k, s, r),
  90: (k, _s, r) => resolveSeiga(k, r),
  140: (k, s, _r) => resolveRyouko(k, s),
};

/** Resolve a character's date outfit set id for the branchy declarations, or
 *  `undefined` when the character has none / the roll declined. */
export function resolveConditionalDateOutfit(
  charaNum: number,
  kind: DateOutfitKind,
  state: Readonly<GameState>,
  rng: DateOutfitRng,
): number | undefined {
  const resolver = RESOLVERS[charaNum];
  return resolver ? resolver(kind, state, rng) : undefined;
}
