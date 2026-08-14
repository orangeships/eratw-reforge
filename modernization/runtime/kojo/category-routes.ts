export type KojoCategory =
  | "COMMAND"
  | "EVENT"
  | "SP_EVENT"
  | "ENCOUNTER"
  | "DIARY"
  | "IRAI"
  | "MARK"
  | "PALAM"
  | "COUNTER"
  | "CUSTOM_EVENT"
  | "DIRECT"
  | "EXTRASOURCE"
  | "FLAGSETTING"
  | "ONABARE"
  | "SUCCESS"
  | "PERMISSION"
  | "LOST_VIRGIN_STOP"
  | "CHILD"
  | "DANMAKU"
  | "GIFT"
  | "DAILY"
  | "MUSHI_BATTLE"
  | "GRAVITY"
  | "SUIKA"
  | "ODEKAKE"
  | "SEX_FRIEND"
  | "BEFORETRAIN"
  | "PANCHIRA"
  | "REV_PANCHIRA"
  | "ENDING"
  | "CUSTOM_TALENT"
  | "SHOP_BUTTON_CONDITION"
  | "SHOP_BUTTON"
  | "KOJO_VERSION"
  | "COM"
  | "COMMAND_ASSISTANT"
  | "CHECK"
  | "IMAGE"
  | "IMAGE_EX"
  | "OVERRIDE_COMMAND";

export type KojoCategoryResolver = "structured" | "not-supported";

export interface KojoCategoryRoute {
  readonly category: KojoCategory;
  /** The category is registered by the upstream KOJO_MESSAGE_SEND dispatcher. */
  readonly sourceDispatch: boolean;
  /** 1-based CASE line in the upstream dispatcher. */
  readonly sourceLine: number;
  readonly indexed: boolean;
  readonly bundled: boolean;
  readonly resolver: KojoCategoryResolver;
  readonly requires: readonly string[];
  readonly indexedEntries: number;
  readonly bundledEntries: number;
}

export function findKojoCategoryRoute(
  routes: readonly KojoCategoryRoute[],
  category: KojoCategory,
): KojoCategoryRoute {
  const route = routes.find((candidate) => candidate.category === category);
  if (!route) throw new Error(`Missing kojo category route: ${category}`);
  return route;
}

export function isStructuredKojoCategory(
  routes: readonly KojoCategoryRoute[],
  category: KojoCategory,
): boolean {
  const route = findKojoCategoryRoute(routes, category);
  return route.indexed && route.bundled && route.resolver === "structured";
}
