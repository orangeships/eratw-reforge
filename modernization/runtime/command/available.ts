/**
 * Phase 8 (Slice 6) — `availableCommands`: the runtime command-menu query.
 *
 * Mirrors the upstream command-panel loop (`USERCOM.ERB` + `@COM_ABLE<NNN>`):
 * eraTW has no fixed "main page" of commands — it enumerates every command and
 * runs each one's `@COM_ABLE` gate to decide what to show. This is the modern
 * equivalent: walk the registered `CommandCatalog`, run each entry's
 * `execCheck` (= `@COM_ABLE`) against the current state + focused target, and
 * report which commands are usable and why the rest are not.
 *
 * The UI (`GameClient`) renders the result: usable commands are clickable;
 * blocked ones may be hidden or greyed with their `reason` (the upstream
 * behavior is "not shown", but exposing the reason is a strict superset the
 * UI can choose to render). Labels come from the tracked `commands.bundle
 * .json` (built by `scripts/build-commands.ts`), NOT from here — this module
 * is pure availability logic, no presentation.
 *
 * Normal play prefers the gate audit, but does not let fidelity diagnostics
 * erase implemented gameplay. An incomplete command with a real `execCheck`
 * still runs that runtime predicate; only incomplete commands with no runtime
 * gate stay hidden. Diagnostic mode additionally exposes those ungated entries.
 *
 * Synthetic navigation ids (>= 10000, room/map move) are NOT command-menu
 * entries — they're handled by the scene-exit model — so they're excluded.
 */

import type { GameState } from "../state/game-state.js";
import type {
  CommandContext,
  FailReason,
  GateStatus,
  HandlerEntry,
  Rng,
} from "./types.js";
import type { CommandCatalog } from "./catalog.js";
import {
  extractedGateAuditFor,
  type ExtractedCommandGateAudit,
} from "./comf/comable-gate-audit.generated.js";
import {
  hModeBlockReason,
  isCleanHModeBaselineCommand,
  isHMode,
  requiresHMode,
} from "./h-mode.js";

/** Synthetic nav ids (room/map move) live at >= 10000. */
export const SYNTHETIC_FLOOR = 10000;

/** One command's availability for the current state + target. */
export interface CommandAvailability {
  commandNo: number;
  /** Fidelity status of the upstream `@COM_ABLE` implementation. */
  gateStatus: GateStatus;
  /** Deferred or missing gate details for diagnostic tooling. */
  gateDiagnostics: readonly string[];
  /** True when the command's runtime predicate passes. */
  usable: boolean;
  /** True when normal play must omit an incomplete command with no runtime gate. */
  hidden?: boolean;
  /** Optional dynamic label supplied by a command display check. */
  labelOverride?: string;
  /** Why it's blocked (present only when `usable` is false and a reason
   *  was given). The upstream `@COM_ABLE` returns a bare 0; our handlers
   *  attach a human message we can surface in the UI. */
  reason?: FailReason;
  /** Parity QA P-7 — the command's @COM_ABLE passes but its @COM body is a
   *  deferred stub (clickable-but-ineffective). The UI greys + labels it
   *  「未实现」. Only set when the handler entry declares `deferred: true`. */
  deferred?: boolean;
}

/** A deterministic do-nothing RNG for the read-only execCheck probe.
 *  execCheck must be a pure predicate (no settlement), so the RNG it
 *  receives is never consumed to mutate state — a fixed RNG is safe and
 *  keeps the query reproducible. */
const PROBE_RNG: Rng = {
  next: () => 0,
  int: () => 0,
  pick: <T>(a: readonly T[]) => a[0]!,
};

export type CommandAvailabilityMode = "normal" | "diagnostic";

function isRinnosukeConversationOnlyTarget(state: Readonly<GameState>, target: number): boolean {
  const meta = state.dynamicCharacters?.[target];
  const slot = state.charas[target];
  return meta?.origin === "authored" &&
    meta.role === "kourindou-shopkeeper" &&
    slot?.location === "魔法之森:香霖堂" &&
    state.master.location === "魔法之森:香霖堂";
}

function gateAuditFor(entry: HandlerEntry): ExtractedCommandGateAudit {
  if (entry.gateStatus) {
    return {
      status: entry.gateStatus,
      diagnostics: entry.gateDiagnostics ?? [],
    };
  }
  return extractedGateAuditFor(entry.commandNo);
}

/**
 * Enumerate every registered command and report its availability for the
 * given state + focused target. Real (non-synthetic) commands only.
 *
 * `execCheck` is a pure predicate (the ERB `@COM_ABLE` family) — it reads
 * state but never mutates it — so this is safe to call every render to
 * rebuild the command grid. In normal mode, incomplete audit entries are
 * allowed only when the handler supplies an `execCheck`; this restores
 * implemented partial ports while keeping truly ungated commands fail-closed.
 * Diagnostic mode also probes entries with no runtime predicate.
 *
 * Defensive: an `execCheck` that throws is treated as "blocked" with a
 * generic reason rather than crashing the menu render.
 */
export function availableCommands(
  catalog: CommandCatalog,
  state: Readonly<GameState>,
  target: number,
  now: () => number = () => 0,
  mode: CommandAvailabilityMode = "normal",
): CommandAvailability[] {
  const out: CommandAvailability[] = [];
  for (const entry of catalog.list()) {
    if (entry.commandNo >= SYNTHETIC_FLOOR) continue;
    const gateAudit = gateAuditFor(entry);
    const gateFields = {
      gateStatus: gateAudit.status,
      gateDiagnostics: gateAudit.diagnostics,
    };
    const deferred = entry.deferred === true ? { deferred: true as const } : {};
    if (isRinnosukeConversationOnlyTarget(state, target) && entry.commandNo !== 300) {
      out.push({
        commandNo: entry.commandNo,
        ...gateFields,
        usable: false,
        reason: { kind: "precondition", message: "霖之助在香霖堂时只开放会话。" },
        ...deferred,
      });
      continue;
    }
    const modeBlock = hModeBlockReason(state, target, entry.commandNo);
    if (modeBlock) {
      const hidden =
        mode === "normal" &&
        gateAudit.status !== "complete" &&
        !entry.execCheck;
      out.push({
        commandNo: entry.commandNo,
        ...gateFields,
        usable: false,
        reason: { kind: "precondition", message: modeBlock },
        ...(hidden ? { hidden: true } : {}),
        ...deferred,
      });
      continue;
    }
    const ctx: CommandContext = {
      state,
      actor: 0,
      target,
      commandNo: entry.commandNo,
      rng: PROBE_RNG,
      now,
    };
    if (isHMode(state, target) && !isCleanHModeBaselineCommand(entry.commandNo)) {
      const hOnly = requiresHMode(entry.commandNo);
      const stateCheck = hOnly ? entry.hModeMenuCheck?.(ctx) : undefined;
      // A complete extracted @COM_ABLE is already the authoritative state
      // predicate and will run as execCheck below. Incomplete H gates remain
      // fail-closed unless the handler supplies an explicit audited menu gate.
      const missingTrustedGate =
        hOnly && !entry.hModeMenuCheck && gateAudit.status !== "complete";
      if ((stateCheck && !stateCheck.ok) || missingTrustedGate || !hOnly) {
        out.push({
          commandNo: entry.commandNo,
          ...gateFields,
          usable: false,
          reason: stateCheck && !stateCheck.ok
            ? stateCheck.reason
            : hOnly ? {
                kind: "precondition",
                message: "该调教指令的装备、插入或姿势条件尚未满足。",
              } : {
                kind: "precondition",
                message: "调教中不能使用该日常指令。",
              },
          ...deferred,
        });
        continue;
      }
    }
    if (
      mode === "normal" &&
      gateAudit.status !== "complete" &&
      !entry.execCheck
    ) {
      out.push({
        commandNo: entry.commandNo,
        ...gateFields,
        usable: false,
        hidden: true,
        reason: {
          kind: "precondition",
          message:
            gateAudit.status === "unsupported"
              ? "command gate is incomplete and has no runtime check"
              : "command gate is missing and has no runtime check",
        },
        ...deferred,
      });
      continue;
    }
    let labelOverride: string | undefined;
    if (entry.displayCheck) {
      try {
        const display = entry.displayCheck(ctx);
        if (!display.shown || display.tone === "hidden") {
          out.push({
            commandNo: entry.commandNo,
            ...gateFields,
            usable: false,
            reason: { kind: "precondition", message: "hidden by displayCheck" },
            ...deferred,
          });
          continue;
        }
        labelOverride = display.labelOverride;
      } catch {
        out.push({
          commandNo: entry.commandNo,
          ...gateFields,
          usable: false,
          reason: { kind: "precondition", message: "displayCheck error" },
        });
        continue;
      }
    }
    if (!entry.execCheck) {
      out.push({
        commandNo: entry.commandNo,
        ...gateFields,
        usable: true,
        ...(labelOverride !== undefined ? { labelOverride } : {}),
        ...deferred,
      });
      continue;
    }
    try {
      const r = entry.execCheck(ctx);
      if (r.ok) {
        out.push({
          commandNo: entry.commandNo,
          ...gateFields,
          usable: true,
          ...(labelOverride !== undefined ? { labelOverride } : {}),
          ...deferred,
        });
      } else {
        out.push({
          commandNo: entry.commandNo,
          ...gateFields,
          usable: false,
          reason: r.reason,
        });
      }
    } catch {
      out.push({
        commandNo: entry.commandNo,
        ...gateFields,
        usable: false,
        reason: { kind: "precondition", message: "execCheck error" },
      });
    }
  }
  return out;
}

/** Convenience: just the usable commandNos (sorted, the catalog's order). */
export function usableCommandNos(
  catalog: CommandCatalog,
  state: Readonly<GameState>,
  target: number,
): number[] {
  return availableCommands(catalog, state, target)
    .filter((c) => c.usable)
    .map((c) => c.commandNo);
}
