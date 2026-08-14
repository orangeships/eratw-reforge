/**
 * Phase 7 (Wave 2a) — upstream-disabled COMF command stubs.
 *
 * ERB-read audit (2026-06-20) found Wave-2 candidates whose
 * `@COM_ABLE<NNN>` leads with an **unconditional `RETURN 0`** (commented
 * `;一時停止` = "temporarily suspended"). In ERA, `RETURN 0` from
 * `@COM_ABLE` means the command is **not executable** — it never enters
 * `@COM<NNN>`. The rich `@COM` bodies (e.g. COMF352 告白する has 268 lines
 * of real ASK_YN/告白女神 logic, COMF423 a full ITEMSALES shop) are
 * upstream **dead code** while the stub gate is in place.
 *
 * Faithful port of current upstream behavior = `execCheck → blocked`. If
 * upstream ever re-enables one (drops the leading `RETURN 0`), it gets a
 * real bespoke port then; until then this stub IS the faithful behavior.
 * Mirrors the Wave-0 `sentinels.ts` posture (201/999/270).
 *
 * Commands still stubbed here (all `@COM_ABLE` RETURN 0 first line in the
 * modernized source snapshot):
 *   423 道具を買う / 424 薬を買う / 426 危ない薬を買う / 425 薬を盛る /
 *   429 着せ替え / 430 着替える / 446 調合する /
 *   352 告白する /
 *   365 素材購入 / 613 お金稼ぎする (Wave 3 — `@COM_ABLE613` also ends
 *   in an unconditional `RETURN 0`; its `@COM613` 金策 body is dead code).
 *
 * 366/367 were later promoted into the playable commission subsystem.
 * COM498 is intentionally absent from this product's command set rather than
 * represented as a disabled catalog entry.
 */
import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";

/** A disabled-stub's label + (deferred) reason its `@COM` body is rich. */
interface DisabledStubDef {
  commandNo: number;
  label: string;
  /** What the dead `@COM` body would do if the stub gate were lifted. */
  deferredBody: string;
}

const DISABLED_STUBS: readonly DisabledStubDef[] = [
  { commandNo: 423, label: "道具を買う", deferredBody: "ITEMSALES shop picker (B9) — upstream RETURN 0" },
  { commandNo: 424, label: "薬を買う", deferredBody: "薬 shop picker (B9) — upstream RETURN 0" },
  { commandNo: 426, label: "危ない薬を買う", deferredBody: "危ない薬 shop picker (B9) — upstream RETURN 0" },
  { commandNo: 429, label: "着せ替え", deferredBody: "costume 着せ替え picker (EQUIP) — upstream RETURN 0" },
  { commandNo: 430, label: "着替える", deferredBody: "costume 着替える picker (EQUIP) — upstream RETURN 0" },
  { commandNo: 446, label: "調合する", deferredBody: "recipe 調合 picker (RECIPE_DATA) — upstream RETURN 0" },
  { commandNo: 365, label: "素材購入", deferredBody: "reverse-buy 素材 from NPC (B9) — upstream RETURN 0" },
  { commandNo: 613, label: "お金稼ぎする", deferredBody: "date part-time 金策 (DATE_PARTTIME location) — upstream RETURN 0" },
];

/**
 * Build a faithful disabled-stub `HandlerEntry`. `execCheck` blocks
 * (mirroring `@COM_ABLE RETURN 0`); the handler is a never-reached safety
 * net that also returns `blocked` in case a caller bypasses the resolver's
 * execCheck.
 */
function makeDisabledStub(def: DisabledStubDef): HandlerEntry {
  return {
    commandNo: def.commandNo,
    execCheck: () => ({
      ok: false,
      reason: {
        kind: "precondition",
        message: `${def.label}は一時停止中（upstream @COM_ABLE RETURN 0）。`,
      },
    }),
    handler: (ctx: CommandContext) => ({
      state: cloneGameState(ctx.state),
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `（${def.label}は現在無効化されている）`,
        },
      ],
      outcome: "blocked" as const,
      failReason: { kind: "precondition" as const, message: `${def.label}は一時停止中。` },
    }),
  };
}

export const disabledStubEntries: readonly HandlerEntry[] = DISABLED_STUBS.map(makeDisabledStub);

// Re-export each by number for explicit registration + test imports.
export const comf423HandlerEntry = disabledStubEntries[0]!;
export const comf424HandlerEntry = disabledStubEntries[1]!;
export const comf426HandlerEntry = disabledStubEntries[2]!;
export const comf429HandlerEntry = disabledStubEntries.find((e) => e.commandNo === 429)!;
export const comf430HandlerEntry = disabledStubEntries.find((e) => e.commandNo === 430)!;
export const comf446HandlerEntry = disabledStubEntries.find((e) => e.commandNo === 446)!;
export const comf365HandlerEntry = disabledStubEntries.find((e) => e.commandNo === 365)!;
export const comf613HandlerEntry = disabledStubEntries.find((e) => e.commandNo === 613)!;
