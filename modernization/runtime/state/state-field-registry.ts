import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  MARK_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
} from "./settlement.js";
import {
  TFLAG_FIELD_REGISTRY,
  type TflagLifecycle,
} from "./tflag.js";

export type StateFieldNamespace =
  | "ABL"
  | "BASE"
  | "CFLAG"
  | "FLAG"
  | "MARK"
  | "PALAM"
  | "TALENT"
  | "TCVAR"
  | "TFLAG";

export type StateFieldLifecycle = TflagLifecycle | "save" | "derived";

export interface StateFieldDefinition {
  readonly key: string;
  readonly namespace: StateFieldNamespace;
  readonly name: string;
  readonly id: number;
  readonly lifecycle: StateFieldLifecycle;
  readonly authority: string;
  readonly resetOwner: string;
}

function field(
  namespace: Exclude<StateFieldNamespace, "TFLAG">,
  name: string,
  id: number,
  authority: string,
  lifecycle: StateFieldLifecycle = "save",
  resetOwner = "none",
): StateFieldDefinition {
  return {
    key: `${namespace}:${name}`,
    namespace,
    name,
    id,
    lifecycle,
    authority,
    resetOwner,
  };
}

const RELATIONSHIP_AND_TRANSITION_FIELDS: readonly StateFieldDefinition[] = [
  field("CFLAG", "好感度", CFLAG_ID.好感度, "source-settlement"),
  field("CFLAG", "信頼度", CFLAG_ID.信頼度, "source-settlement"),
  field("CFLAG", "不機嫌", CFLAG_ID.不機嫌, "mood-and-source-settlement"),
  field("CFLAG", "勃然大怒", CFLAG_ID.勃然大怒, "mood-and-source-settlement"),
  field("CFLAG", "弱み握り", CFLAG_ID.弱み握り, "character-state"),
  field("CFLAG", "强行内射", CFLAG_ID.强行内射, "h-settlement"),
  field("CFLAG", "睡眠", CFLAG_ID.睡眠, "sleep-cycle"),
  field("CFLAG", "時間停止行動", CFLAG_ID.時間停止行動, "time-stop-cycle"),
  field("CFLAG", "既成事実", CFLAG_ID.既成事実, "relationship-events"),
  field("CFLAG", "认识", CFLAG_ID.认识, "first-meeting-transition"),
  field(
    "CFLAG",
    "態度",
    CFLAG_ID.態度,
    "deriveRelationshipAuthority",
    "derived",
    "derived-selector",
  ),
  field(
    "CFLAG",
    "合意判定",
    CFLAG_ID.合意判定,
    "deriveRelationshipAuthority",
    "derived",
    "derived-selector",
  ),
  field("TALENT", "恋慕", TALENT_ID.恋慕, "character-state"),
  field("TALENT", "思慕", TALENT_ID.思慕, "character-state"),
  field("TALENT", "愛欲", TALENT_ID.愛欲, "character-state"),
  field("TALENT", "炮友", TALENT_ID.炮友, "character-state"),
  field("TALENT", "風騷", TALENT_ID.風騷, "character-state"),
  field("TALENT", "合意誤認", TALENT_ID.合意誤認, "character-state"),
  field("ABL", "親密", ABL_ID.親密, "ability-state"),
  field("ABL", "欲望", ABL_ID.欲望, "ability-state"),
  field("PALAM", "欲情", PALAM_ID.欲情, "source-settlement"),
  field("PALAM", "好意", PALAM_ID.好意, "source-settlement"),
  field("BASE", "情緒", BASE_ID.情緒, "base-settlement"),
  field("BASE", "理性", BASE_ID.理性, "base-settlement"),
  field("MARK", "不埒", MARK_ID.不埒, "mark-settlement"),
  field("MARK", "快乐", MARK_ID.快乐, "mark-settlement"),
  field("MARK", "反発刻印", MARK_ID.反発刻印, "source-settlement"),
  field("MARK", "反発取得履歴", MARK_ID.反発取得履歴, "source-settlement"),
  field("MARK", "时奸", MARK_ID.时奸, "mark-settlement"),
  field("FLAG", "甲斐性無", FLAG_ID.甲斐性無, "global-state"),
  field("FLAG", "催眠強度", FLAG_ID.催眠強度, "global-state"),
  field("FLAG", "時間停止", FLAG_ID.時間停止, "time-stop-cycle"),
  field(
    "TCVAR",
    "亲热",
    TCVAR_ID.亲热,
    "deriveRelationshipAuthority",
    "derived",
    "derived-selector",
  ),
] as const;

const TFLAG_FIELDS: readonly StateFieldDefinition[] =
  TFLAG_FIELD_REGISTRY.map((definition) => ({
    key: `TFLAG:${definition.name}`,
    namespace: "TFLAG" as const,
    name: definition.name,
    id: definition.id,
    lifecycle: definition.lifecycle,
    authority: "turn-context",
    resetOwner:
      definition.lifecycle === "turn"
        ? "command-completed"
        : definition.lifecycle === "day"
          ? "day-end"
          : definition.lifecycle === "session"
            ? "session-owner"
            : "none",
  }));

export const STATE_FIELD_REGISTRY: readonly StateFieldDefinition[] = [
  ...RELATIONSHIP_AND_TRANSITION_FIELDS,
  ...TFLAG_FIELDS,
];

const FIELD_BY_KEY = new Map(
  STATE_FIELD_REGISTRY.map((definition) => [definition.key, definition]),
);

export function stateFieldDefinition(
  namespace: StateFieldNamespace,
  name: string,
): StateFieldDefinition | undefined {
  return FIELD_BY_KEY.get(`${namespace}:${name}`);
}
