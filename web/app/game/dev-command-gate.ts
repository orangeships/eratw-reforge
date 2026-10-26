import type { GameState } from "../../../modernization/runtime/state/game-state.js";

export interface LocalCommandTiming {
  id: number;
  commandNo: number;
  target?: number;
  preparationMs: number;
  applicationMs: number;
  commitFrameMs: number | null;
  outcome: "preparing" | "applied" | "obsolete" | "error" | "cancelled";
}
const records: LocalCommandTiming[] = [];
let serial = 0;
export function localCommandTimings(): readonly LocalCommandTiming[] { return records; }

/** One player input while loading. State replacement invalidates the old input. */
export class DevCommandGate {
  private busy = false;
  private revision = 0;
  private pendingCommit: { record: LocalCommandTiming; appliedAt: number } | null = null;
  private readonly frames = new Set<number>();

  constructor(
    private readonly onBusy: (busy: boolean) => void = () => {},
    private readonly nextFrame: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
    private readonly cancelFrame: (id: number) => void = (id) => cancelAnimationFrame(id),
    private readonly onObsolete: () => void = () => {},
  ) {}

  async run(
    commandNo: number,
    target: number | undefined,
    prepare: (state: GameState) => Promise<void>,
    apply: () => void,
    getState: () => GameState | null,
  ): Promise<boolean> {
    if (this.busy) return false;
    const state = getState();
    if (!state) return false;
    this.busy = true;
    const revision = this.revision;
    this.onBusy(true);
    const startedAt = performance.now();
    const record: LocalCommandTiming = { id: ++serial, commandNo, target,
      preparationMs: 0, applicationMs: 0, commitFrameMs: null, outcome: "preparing" };
    records.unshift(record);
    if (records.length > 40) records.length = 40;
    let applicationStartedAt: number | null = null;
    try {
      await prepare(state);
      record.preparationMs = performance.now() - startedAt;
      if (revision !== this.revision) { record.outcome = "cancelled"; return false; }
      if (getState() !== state) { record.outcome = "obsolete"; this.onObsolete(); return false; }
      applicationStartedAt = performance.now();
      apply();
      record.applicationMs = performance.now() - applicationStartedAt;
      record.outcome = "applied";
      this.pendingCommit = { record, appliedAt: performance.now() };
      return true;
    } catch (error) {
      record.outcome = "error";
      if (applicationStartedAt === null) record.preparationMs = performance.now() - startedAt;
      else record.applicationMs = performance.now() - applicationStartedAt;
      throw error;
    } finally {
      if (revision === this.revision) { this.busy = false; this.onBusy(false); }
    }
  }

  /** Call after React commits. This measures the next frame opportunity, not GPU paint. */
  notifyCommit(): void {
    const pending = this.pendingCommit;
    if (!pending) return;
    this.pendingCommit = null;
    const revision = this.revision;
    const frame = this.nextFrame(() => {
      if (revision === this.revision) pending.record.commitFrameMs = performance.now() - pending.appliedAt;
      this.frames.delete(frame);
    });
    this.frames.add(frame);
  }

  cancel(): void {
    this.revision += 1;
    this.busy = false;
    this.pendingCommit = null;
    for (const frame of this.frames) this.cancelFrame(frame);
    this.frames.clear();
    this.onBusy(false);
  }
}
