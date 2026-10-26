/** Version of the daytime prompt and patch contract used in retry guards. */
export const AGENT_DAYTIME_PROMPT_VERSION = "v4";

/** Every time this many *distinct* evidence fingerprints have failed the
 * schema contract, one summary entry is written to the debug log. Failures
 * never pause the queue itself: a bad batch is skipped on its own fingerprint
 * while every other character's batches keep processing. */
export const DAYTIME_SCHEMA_FAILURE_SUMMARY_LIMIT = 3;

const OTHER_FAILURE_COOLDOWN_MS = 30_000;
const MAX_FAILURE_FINGERPRINTS = 256;

export type DaytimeFailureKind = "schema" | "other";

export interface DaytimeFailureFingerprintInput {
  charaNum: number;
  observationIds: readonly string[];
  promptVersion?: string;
}

/**
 * A retry key for one bounded evidence batch.  Revision is intentionally not
 * included: projection can advance the Runtime revision while the same
 * unconsumed observations are still waiting for a provider response.
 */
export function daytimeFailureFingerprint(input: DaytimeFailureFingerprintInput): string {
  const ids = [...new Set(input.observationIds)].sort();
  return `${input.promptVersion ?? AGENT_DAYTIME_PROMPT_VERSION}:${input.charaNum}:${ids.join(",")}`;
}

interface FailureRecord {
  kind: DaytimeFailureKind;
  failedAt: number;
}

export interface DaytimeFailureResult {
  /** Distinct fingerprints currently recorded as schema failures. */
  distinctSchemaFailures: number;
  /** True once each time `distinctSchemaFailures` crosses a multiple of
   * `DAYTIME_SCHEMA_FAILURE_SUMMARY_LIMIT`; the caller writes one debug entry. */
  summaryDue: boolean;
}

/**
 * Ephemeral guard for the optional daytime provider sidecar.
 *
 * Schema failures are suppressed for the same evidence fingerprint until a
 * new observation, prompt version, or explicit reset changes the key. Other
 * failures receive a short cooldown so a transient provider outage can retry.
 * Isolation is per batch on purpose: one character's malformed patches must
 * never pause another character's queue, so there is no global circuit — only
 * the periodic summary entry that makes accumulated schema failures visible.
 */
export class DaytimeFailureGuard {
  private readonly failures = new Map<string, FailureRecord>();

  get distinctSchemaFailures(): number {
    let count = 0;
    for (const record of this.failures.values()) {
      if (record.kind === "schema") count += 1;
    }
    return count;
  }

  shouldSkip(fingerprint: string, now = Date.now()): boolean {
    const record = this.failures.get(fingerprint);
    if (!record) return false;
    if (record.kind === "schema") return true;
    if (now - record.failedAt < OTHER_FAILURE_COOLDOWN_MS) return true;
    this.failures.delete(fingerprint);
    return false;
  }

  recordFailure(
    fingerprint: string,
    kind: DaytimeFailureKind,
    now = Date.now(),
  ): DaytimeFailureResult {
    const before = this.distinctSchemaFailures;
    const existing = this.failures.get(fingerprint);
    if (existing?.kind !== kind) {
      if (this.failures.size >= MAX_FAILURE_FINGERPRINTS) {
        const oldest = this.failures.keys().next().value;
        if (oldest !== undefined) this.failures.delete(oldest);
      }
      this.failures.set(fingerprint, { kind, failedAt: now });
    }
    const after = this.distinctSchemaFailures;
    const threshold = DAYTIME_SCHEMA_FAILURE_SUMMARY_LIMIT;
    const summaryDue = kind === "schema"
      && Math.floor(after / threshold) > Math.floor(before / threshold);
    return { distinctSchemaFailures: after, summaryDue };
  }

  recordSuccess(fingerprint?: string): void {
    if (fingerprint !== undefined) this.failures.delete(fingerprint);
  }

  reset(): void {
    this.failures.clear();
  }
}
