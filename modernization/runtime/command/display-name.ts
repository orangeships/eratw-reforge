/**
 * 指令显示名 (2026-10-02) — the single authority for what a command button says.
 *
 * Upstream names each button in `@QOL_SHOW_USERCOM`
 * (`ERB/魔改内容/qol/QOL_USERCOM.ERB:13-118`) in this order:
 *
 *   1. the derived-command name (`QOL_SCOM_CHECK`) — NOT modelled; see
 *      `H-COMMAND-DISPLAY-PLAN.md` for the deferred SCOM subsystem.
 *   2. `@COM{n}_DISPLAY` — a per-state dynamic name, translated by `NAME_TR`.
 *   3. `COM_NAME{n}` — a sub-menu label (already Chinese).
 *   4. `TRAINNAME_TR(n)` — the static `CSV/Train.csv` name.
 *
 * This module owns (2)/(3): it picks the upstream branch, then translates the
 * literal it would return through `comDisplayLabel`, so callers get the final
 * Chinese label. A `undefined` return means "fall back to the static name" —
 * never an invented one. The web UI, the AI prompt and the AI history all read
 * this, so they cannot disagree.
 *
 * Deferred (the static name is used instead, never a guess):
 *   - `COM26`/`COM73` 外出し・種付け branches need `TCVAR:PLAYER:イきそう`
 *     (not modelled); the `抜く（Ｖ/Ａ）` branches work.
 *   - `COM81` お掃除フェラ needs `MASTER_POSE` over `前ターン射精箇所`.
 *   - `COM301` 泡红茶 needs `TCVAR:MASTER:特別なお茶`; 敬茶 works.
 *   - `COM311`(添い寝中) / `COM334` / `COM350` / `COM402`(Real_Time_Save) /
 *     `COM410` / `COM420`(upstream itself shows Japanese) / `COM422` /
 *     `COM431` / `COM448` / `COM491` — condition state not modelled.
 *   - `COM337/367/368/443/464/482/626/698` — the name comes from a helper
 *     (place / companion / gift-shop / commission). Those commands already
 *     carry hand-written `displayCheck`s elsewhere.
 */

import type { GameState } from "../state/game-state.js";
import { comDisplayLabel } from "./com-display.generated.js";
import { BASE_ID, CFLAG_ID, TALENT_ID, TEQUIP_ID } from "../state/settlement.js";
import { isEquipped, readTequip } from "../state/tequip.js";
import { isStandingSex } from "../state/standing-sex.js";

/** `SET_P` — the penis part id; the contact ring stores it as 1. */
const SET_P = 1;

/** Standing-sex positions whose `_DISPLAY` (or `_DEFINITION`) swaps the name. */
const STANDING_DISPLAY_COMMANDS: Readonly<Record<number, string>> = {
  60: "対面立位",
  61: "背面立位",
  62: "対面立位アナル",
  63: "背面立位アナル",
  67: "火车便当式",
  68: "抱起后入",
  69: "火车便当肛交",
  70: "抱起后入肛交",
  92: "Ａ対面立位される",
  93: "Ａ背面立位される",
  130: "対面立位される",
  131: "背面立位される",
};

/**
 * Toys whose `@COM{n}_DISPLAY` returns `TRAINNAME:{n} + "解除"` while equipped.
 * The first value is the upstream literal that concatenation resolves to (built
 * by `build-com-display.ts`); 43/46 have no `CSV/Train.csv` name, so upstream
 * itself renders the bare 「解除」.
 */
const TOY_TOGGLES: ReadonlyArray<{ commandNo: number; tequip: number; literal: string }> = [
  { commandNo: 42, tequip: TEQUIP_ID.陰蒂夾, literal: "陰蒂夾解除" },
  { commandNo: 43, tequip: TEQUIP_ID.飛機杯, literal: "解除" },
  { commandNo: 44, tequip: TEQUIP_ID.振動棒, literal: "振動棒解除" },
  { commandNo: 45, tequip: TEQUIP_ID.肛用振動棒, literal: "肛用振動棒解除" },
  { commandNo: 46, tequip: TEQUIP_ID.後庭拉珠, literal: "解除" },
  { commandNo: 47, tequip: TEQUIP_ID.乳頭夾, literal: "乳頭夾解除" },
  { commandNo: 48, tequip: TEQUIP_ID.搾乳機, literal: "搾乳機解除" },
];

const TOY_BY_COMMAND = new Map(TOY_TOGGLES.map((t) => [t.commandNo, t]));

/**
 * The Chinese label for `commandNo` in this state, or `undefined` when
 * upstream has no dynamic name (or the branch needs state we do not model —
 * the caller then falls back to the static `TRAINNAME_TR` name).
 * `state`/`target` are optional so history and perf-panel callers stay safe.
 */
export function resolveCommandDisplayName(
  commandNo: number,
  state?: Readonly<GameState>,
  target?: number,
): string | undefined {
  const literal = resolveDisplayLiteral(commandNo, state, target);
  return literal === undefined ? undefined : comDisplayLabel(literal);
}

/** The upstream branch's Japanese literal (what `@COM{n}_DISPLAY` would
 *  return). Translated by `resolveCommandDisplayName`. */
function resolveDisplayLiteral(
  commandNo: number,
  state?: Readonly<GameState>,
  target?: number,
): string | undefined {
  const focused = state && target !== undefined ? state.charas[target] : undefined;
  const master = state?.master;

  // --- continuous-mode toggles. Upstream renders these through the QOL
  //     derived-command layer rather than `@COM{n}_DISPLAY`, so they are the
  //     one place these labels are authored here. -------------------------
  if (commandNo === 11 && focused && isEquipped(focused, TEQUIP_ID.吸乳头)) return "停止持续吸乳头";
  if (commandNo === 12 && focused && isEquipped(focused, TEQUIP_ID.揉胸)) return "停止持续揉胸";
  if (commandNo === 826 && focused && isEquipped(focused, TEQUIP_ID.挑逗モード)) return "结束挑逗";

  const toy = TOY_BY_COMMAND.get(commandNo);
  if (toy) {
    if (!focused || !isEquipped(focused, toy.tequip)) return undefined;
    return toy.literal;
  }

  const standingKey = STANDING_DISPLAY_COMMANDS[commandNo];
  if (standingKey && state && target !== undefined && isStandingSex(state, target, commandNo)) {
    return standingKey;
  }

  switch (commandNo) {
    case 15: {
      // `SIF CFLAG:MASTER:イタズラ → "秘所愛撫"`, else the static 陰蒂愛撫.
      if (master && (master.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0) return "秘所愛撫";
      return undefined;
    }
    case 19: {
      if (master && isEquipped(master, TEQUIP_ID.継続接吻)) return "キス終了";
      return undefined;
    }
    case 26: {
      // `TEQUIP:TARGET:Ｖ接触部位 == SET_P` / Ａ. The 外出し branch needs
      // `TCVAR:PLAYER:イきそう`, which is not modelled.
      if (!focused) return undefined;
      if (readTequip(focused, TEQUIP_ID.Ｖ接触部位) === SET_P) return "抜く（Ｖ）";
      if (readTequip(focused, TEQUIP_ID.Ａ接触部位) === SET_P) return "抜く（Ａ）";
      return undefined;
    }
    case 50: {
      // `SIF TEQUIP:PLAYER:コンドーム → "コンドームを外す"`.
      if (master && isEquipped(master, TEQUIP_ID.避孕套)) return "コンドームを外す";
      return undefined;
    }
    case 82: {
      // `SIF TALENT:バストサイズ == -2 || == -1 → "ナイズリ"`.
      if (!focused) return undefined;
      const bust = focused.state.TALENT[TALENT_ID.胸围] ?? 0;
      return bust === -2 || bust === -1 ? "ナイズリ" : undefined;
    }
    case 100: {
      if (focused && (focused.state.TALENT[TALENT_ID.幼稚] ?? 0) !== 0) return "お尻ぺんぺん";
      return undefined;
    }
    case 186: {
      if (focused && isEquipped(focused, TEQUIP_ID.羞耻PLAY)) return "结束羞耻PLAY";
      return undefined;
    }
    case 302: {
      // `SIF PREVCOM == 305 → "耳かき"`.
      return prevCommandNo(state) === 305 ? "耳かき" : undefined;
    }
    case 315: {
      if (!focused) return undefined;
      if (((focused.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0) return "竿愛撫";
      if (master && (master.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0) return "秘所愛撫";
      return undefined;
    }
    case 360: {
      // `SIF BASE:MASTER:気力 <= 0 → "なすがまま"`.
      if (master && (master.state.BASE[BASE_ID.気力] ?? 0) <= 0) return "なすがまま";
      return undefined;
    }
    case 603: {
      // `SIF PREVCOM == 603 → "手を引く"`.
      return prevCommandNo(state) === 603 ? "手を引く" : undefined;
    }
    default:
      return undefined;
  }
}

/** The previous command within the active training session, when there is one.
 *  Outside a session upstream's `PREVCOM` is not modelled, so a branch that
 *  needs it simply does not fire. */
function prevCommandNo(state?: Readonly<GameState>): number | undefined {
  const last = state?.training?.lastCommandNo;
  return last === undefined || last <= 0 ? undefined : last;
}
