/** The small, semantic H scene view sent to L1. The full scene context stays
 * available to diagnostics and to semantic-state deduplication. */
import type { GameState } from "../state/game-state.js";
import { PALAM_ID } from "../state/settlement.js";
import { getPalamLv } from "../state/palam-level.js";
import type { HSceneContext } from "./h-scene-context.js";

const PALAM_AXES = [
  [PALAM_ID.快Ｃ, "快感Ｃ"], [PALAM_ID.快Ｖ, "快感Ｖ"],
  [PALAM_ID.快Ａ, "快感Ａ"], [PALAM_ID.快Ｂ, "快感Ｂ"],
  [PALAM_ID.快Ｍ, "快感Ｍ"], [PALAM_ID.潤滑, "润滑"],
  [PALAM_ID.恭順, "顺从"], [PALAM_ID.欲情, "欲望"],
  [PALAM_ID.屈服, "屈服"], [PALAM_ID.習得, "适应"],
  [PALAM_ID.恥情, "羞耻"], [PALAM_ID.苦痛, "痛苦"],
  [PALAM_ID.恐怖, "恐惧"], [PALAM_ID.好意, "当下好意"],
  [PALAM_ID.優越, "优越感"], [PALAM_ID.反感, "反感"],
  [PALAM_ID.不快, "不快"], [PALAM_ID.抑鬱, "低落"],
  [PALAM_ID.眠姦, "睡眠中刺激"],
] as const;

const CURRENT_AXES = new Set<number>([
  PALAM_ID.快Ｃ, PALAM_ID.快Ｖ, PALAM_ID.快Ａ, PALAM_ID.快Ｂ,
  PALAM_ID.快Ｍ, PALAM_ID.潤滑, PALAM_ID.欲情,
]);

type ProfileTiers = Record<string, { level: number | "unknown" }>;
type PromptProfile = {
  experience?: ProfileTiers;
  sensitivity?: ProfileTiers;
  unfamiliar?: string[];
};

function compactProfile(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const profile = value as PromptProfile;
  const tiers = (source?: ProfileTiers) => Object.fromEntries(
    Object.entries(source ?? {})
      .filter(([, entry]) => entry?.level !== "unknown")
      .map(([name, entry]) => [name, entry.level]),
  );
  const experience = tiers(profile.experience);
  const sensitivity = tiers(profile.sensitivity);
  return {
    ...(Object.keys(experience).length ? { experience } : {}),
    ...(Object.keys(sensitivity).length ? { sensitivity } : {}),
    ...(profile.unfamiliar?.length ? { unfamiliar: profile.unfamiliar } : {}),
  };
}

function palamState(
  before: Readonly<GameState> | undefined,
  after: Readonly<GameState>,
  target: number,
  receiptAvailable: boolean,
) {
  const subjects = target === after.master.charaNum ? [target] : [after.master.charaNum, target];
  return subjects.flatMap((subjectId) => {
    const now = subjectId === after.master.charaNum ? after.master : after.charas[subjectId];
    if (!now) return [];
    const was = subjectId === after.master.charaNum ? before?.master : before?.charas[subjectId];
    const changes: Array<{ name: string; direction: "上升" | "下降"; current_level: number;
      previous_level?: number; same_tier?: true }> = [];
    const current: Array<{ name: string; level: number }> = [];
    for (const [id, name] of PALAM_AXES) {
      const value = now.state.PALAM[id];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const previous = was?.state.PALAM[id];
      const changed = receiptAvailable && typeof previous === "number" && Number.isFinite(previous)
        && previous !== value;
      const level = getPalamLv(value, 10);
      if (changed) {
        const previousLevel = getPalamLv(previous, 10);
        changes.push({ name, direction: value > previous ? "上升" : "下降", current_level: level,
          ...(level === previousLevel ? { same_tier: true as const } : { previous_level: previousLevel }) });
      } else if (CURRENT_AXES.has(id) && level > 0) {
        current.push({ name, level });
      }
    }
    return [{
      subject_id: subjectId,
      subject: subjectId === after.master.charaNum ? "主角" : "对象",
      ...(current.length ? { current } : {}),
      changes_this_turn: receiptAvailable && was ? changes : "unknown" as const,
    }];
  });
}

/** A prompt-only projection; no state mutation and no save-shape change. */
export function projectHSceneContextForPrompt(
  context: HSceneContext,
  before: Readonly<GameState> | undefined,
  after: Readonly<GameState>,
  target: number,
  labelFor: (commandNo: number) => string,
) {
  const action = context.action_state;
  const phase = context.event_phase;
  const memory = context.interaction_memory;
  const sites = new Set(context.action_state.concurrent_actions === "unknown"
    ? [] : context.action_state.concurrent_actions.map((entry) => entry.site));
  if (action.changes_this_turn !== "unknown") {
    for (const site of action.changes_this_turn.insertion_opened) sites.add(site);
    for (const site of action.changes_this_turn.insertion_closed) sites.add(site);
  }
  const firstOccurrence = phase.first_occurrence
    .filter((entry) => entry.value !== "unknown" && (
      entry.scope === "scene_first_this_act"
      || (sites.has("v") && entry.scope.endsWith("vaginal"))
      || (sites.has("a") && entry.scope.endsWith("anal"))
    ))
    .map(({ scope, value }) => ({ scope, value }));
  const remaining = phase.aftermath.semen_remaining;
  const semenSites = remaining ? (["vaginal", "anal", "uterine"] as const)
    .filter((site) => remaining[site] > 0) : [];
  const profile = compactProfile(context.body_profile);
  const body = context.current_body_state;
  const currentPosition = body?.position?.label ?? (body?.position ? memory.position?.label : undefined);
  const relationForPrompt = (relation: NonNullable<typeof body>["insertions"]["v"]) =>
    relation.status === "active"
      ? { status: relation.status, actor_id: relation.actor_id, receiver_id: relation.receiver_id }
      : { status: relation.status };

  return {
    ...(body ? { current_body_state: {
      ...body,
      insertions: { v: relationForPrompt(body.insertions.v), a: relationForPrompt(body.insertions.a) },
      devices: body.devices === "unknown" ? "unknown" : body.devices.map(({ kind, site }) => ({ kind, site })),
    } } : {}),
    action_state: {
      actor_id: action.primary_action.actor_id,
      target_id: action.primary_action.target_id,
      ...(action.primary_action.body_part ? { body_part: action.primary_action.body_part } : {}),
      concurrent_actions: action.concurrent_actions,
      ...(action.changes_this_turn === "unknown"
        ? { changes_this_turn: "unknown" as const }
        : {
            changes_this_turn: {
              ...(action.changes_this_turn.session_started ? { session_started: true } : {}),
              ...(action.changes_this_turn.session_ended ? { session_ended: true } : {}),
              ...(action.changes_this_turn.insertion_opened.length
                ? { insertion_opened: action.changes_this_turn.insertion_opened } : {}),
              ...(action.changes_this_turn.insertion_closed.length
                ? { insertion_closed: action.changes_this_turn.insertion_closed } : {}),
            },
          }),
    },
    event_phase: {
      progress: phase.progress,
      events_this_turn: phase.events_this_turn === "unknown" ? "unknown" as const
        : phase.events_this_turn.map(({ subject, kind, channel, multiple_ec, site, marker_labels }) => ({
            subject, kind, ...(channel ? { channel } : {}),
            ...(multiple_ec ? { multiple_ec } : {}),
            ...(site ? { site } : {}),
            ...(marker_labels?.length ? { marker_labels } : {}),
          })),
      ...(firstOccurrence.length ? { first_occurrence: firstOccurrence } : {}),
      aftermath: {
        ...(phase.aftermath.afterglow ? { afterglow: phase.aftermath.afterglow.label } : {}),
        ...(semenSites.length ? { semen_remaining_at: semenSites } : {}),
        ...(phase.aftermath.edging_pending
          ? { edging_pending: Object.keys(phase.aftermath.edging_pending) } : {}),
        ...(phase.aftermath.marks_this_turn?.length
          ? { marks_this_turn: phase.aftermath.marks_this_turn } : {}),
      },
    },
    physical_state: context.physical_state.map(({ subject_id, fatigue, this_turn, discomfort }) => ({
      subject_id, fatigue, discomfort,
      ...(this_turn === "unknown" ? {} : { this_turn }),
    })),
    palam_state: palamState(before, after, target, phase.evidence_status === "receipt"),
    ...(profile && Object.keys(profile).length ? { body_profile: profile } : {}),
    mental_state: {
      initiator: context.mental_state.current_facts.initiator,
      unconscious: context.mental_state.current_facts.unconscious,
    },
    interaction_memory: {
      ...(memory.previous_successful_action
        ? { previous_successful_action: labelFor(memory.previous_successful_action.command_no) } : {}),
      ...(memory.previous_attempted_action
        ? { previous_attempted_action: {
            label: labelFor(memory.previous_attempted_action.command_no),
            outcome: memory.previous_attempted_action.outcome,
          } } : {}),
      ...(memory.session_elapsed_minutes === "unknown" ? {} : { session_elapsed_minutes: memory.session_elapsed_minutes }),
      ...(currentPosition ? { position: currentPosition } : {}),
    },
  };
}
