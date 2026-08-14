export type KojoRosterAvailability =
  | "routable"
  | "indexed-no-content"
  | "not-authored";

export type KojoRosterSampleCategory =
  | "COMMAND"
  | "EVENT"
  | "SP_EVENT"
  | "ENCOUNTER"
  | "MARK"
  | "COUNTER"
  | "PALAM"
  | "IRAI"
  | "DIARY";

export type KojoRosterRouteSample =
  | {
      readonly category: "COMMAND";
      readonly commandNo: number;
      readonly commandKind?: "COM" | "SCOM";
      readonly choiceNodes?: number;
    }
  | {
      readonly category: "EVENT";
      readonly arm: number;
      readonly choiceNodes?: number;
    }
  | {
      readonly category: "SP_EVENT";
      readonly subid: number;
      readonly choiceNodes?: number;
    }
  | {
      readonly category: "ENCOUNTER";
      readonly choiceNodes?: number;
    }
  | {
      readonly category: "MARK";
      readonly level: 1 | 2 | 3;
      readonly choiceNodes?: number;
    }
  | {
      readonly category: "COUNTER";
      readonly action: number;
      readonly choiceNodes?: number;
    }
  | {
      readonly category: "PALAM";
      readonly kind: "A" | "A2" | "B" | "B2" | "C" | "D" | "E" | "F";
      readonly detail?: string;
      readonly choiceNodes?: number;
    }
  | {
      readonly category: "IRAI";
      readonly selector: string;
      readonly role: string;
      readonly scene: string;
      readonly iraiId: number;
    }
  | {
      readonly category: "DIARY";
      readonly mode: "EXIST";
    }
  | {
      readonly category: "DIARY";
      readonly mode: "TEXT";
      readonly page: number;
      readonly choiceNodes?: number;
    }
  | {
      readonly category: "DIARY";
      readonly mode: "HAPPEN";
      readonly page: number;
    };

export interface KojoRosterVariantMatrixEntry {
  readonly variantId?: string;
  readonly variantCode: string;
  readonly availability: KojoRosterAvailability;
  readonly indexedEntries: number;
  readonly bundledEntries: number;
  readonly samples: readonly KojoRosterRouteSample[];
  readonly choiceRoutes: readonly KojoRosterRouteSample[];
}

export interface KojoRosterMatrixEntry {
  readonly charaNum: number;
  readonly availability: KojoRosterAvailability;
  readonly indexedVariants: number;
  readonly bundledVariants: number;
  readonly indexedEntries: number;
  readonly bundledEntries: number;
  /** A deterministic authored route candidate for the later adapter matrix. */
  readonly sample?: {
    readonly category: KojoRosterSampleCategory;
    readonly key: string;
  };
  readonly variants: readonly KojoRosterVariantMatrixEntry[];
}

export interface KojoRosterMatrixSummary {
  readonly configuredCharacters: number;
  readonly routable: number;
  readonly indexedNoContent: number;
  readonly notAuthored: number;
  readonly indexedVariants: number;
  readonly bundledVariants: number;
  readonly routableVariants: number;
  readonly routeSamples: number;
  readonly choiceRoutes: number;
  readonly choiceNodes: number;
}
