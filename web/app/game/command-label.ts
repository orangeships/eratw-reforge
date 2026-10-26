import commandsBundle from "./commands.bundle.json";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { resolveCommandDisplayName } from "../../../modernization/runtime/command/display-name.js";

const COMMANDS = commandsBundle as Record<string, { label: string }>;

/**
 * Names for commands that have no `CSV/Train.csv` entry, so the bundle carries
 * a `#<no>` sentinel. Commands whose name comes from a helper the bundle
 * cannot express (820-830 clothing/state controls, 999/850 exits, the AI-only
 * pseudo-commands) also live here.
 */
const FALLBACKS: Readonly<Record<number, string>> = {
  187: "浴室PLAY",
  820: "脱衣服", 821: "偷胖次", 822: "解开胸罩", 823: "脱到只剩内衣",
  826: "挑逗", 830: "敞开衣服", 992: "邀请约会", 201: "禁用指令", 270: "调教口上",
  999: "结束幽会",
  19987: "主动提出约会邀请", 19986: "对话（AI）",
};

/**
 * Shared player/AI command identity. Precedence mirrors upstream
 * `@QOL_SHOW_USERCOM`: the runtime's dynamic `@COM{n}_DISPLAY` name (owned by
 * `resolveCommandDisplayName`, which also covers the continuous-mode toggles),
 * then the static `TRAINNAME_TR` name baked into the bundle, then a fallback
 * for commands the bundle cannot name.
 *
 * Use the pre-command state for toggles: a command that turns something off
 * must still read as the action the player chose.
 */
export function commandLabel(commandNo: number, state?: Readonly<GameState>, target?: number): string {
  const resolved = resolveCommandDisplayName(commandNo, state, target);
  if (resolved !== undefined) return resolved;
  const bundled = COMMANDS[String(commandNo)]?.label;
  if (bundled && !/^#\d+$/.test(bundled) && bundled !== "未命名行动") return bundled;
  return FALLBACKS[commandNo] ?? `指令 ${commandNo}`;
}
