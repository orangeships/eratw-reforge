/** Deterministic AFTER_AFFAIR prose for the modeled single-target H route. */
import type { GameState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import { bodyFillRate } from "../state/body-fill-rate.js";
import { BASE_ID, EX_ID, PALAM_ID, TALENT_ID, TEQUIP_ID } from "../state/settlement.js";
import { readTequip } from "../state/tequip.js";

function narration(now: number, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: now, text };
}

export interface AfterAffairProse {
  opening: ObservationEvent[];
  fluid: ObservationEvent[];
  fluidKojoDetail: 1 | 2 | null;
  mood: ObservationEvent[];
  clothing: ObservationEvent[];
}

/**
 * Mirrors the observable AFTER_AFFAIR branches without importing the retired
 * ERB VM. The function deliberately reads only canonical state and never
 * mutates it, so callers can run it before H markers are cleared.
 */
export function afterAffairNarration(
  state: Readonly<GameState>,
  target: number,
  now: number,
): AfterAffairProse {
  const slot = state.charas[target];
  if (!slot) return { opening: [], fluid: [], fluidKojoDetail: null, mood: [], clothing: [] };
  const masterName = state.master.callName ?? "主人公";
  const targetName = slot.callName ?? `角色${target}`;
  const session = state.training;
  const spentTicks = session ? Math.max(0, state.time.tickValue - session.startedAtTick) : 0;
  const climax = [EX_ID.Ｃ絶頂, EX_ID.Ｖ絶頂, EX_ID.Ａ絶頂, EX_ID.Ｂ絶頂, EX_ID.Ｍ絶頂]
    .reduce<number>((sum, id) => sum + (slot.state.EX[id] ?? 0), 0);
  const fillV = bodyFillRate(slot.state, 1, true) ?? 0;
  const fillA = bodyFillRate(slot.state, 2, true) ?? 0;
  const lubrication = slot.state.PALAM[PALAM_ID.潤滑] ?? 0;
  const desire = slot.state.PALAM[PALAM_ID.欲情] ?? 0;
  const stamina = slot.state.BASE[BASE_ID.体力] ?? 0;
  const maxStamina = slot.state.MAXBASE?.[BASE_ID.体力] ?? 0;
  const opening: ObservationEvent[] = [];
  const fluid: ObservationEvent[] = [];
  const moodEvents: ObservationEvent[] = [];
  const clothing: ObservationEvent[] = [];

  if (spentTicks > 0) {
    const hours = Math.trunc(spentTicks / 60);
    opening.push(narration(now, `${masterName}和${targetName}${hours > 0 ? `度过了${hours}小时的` : "度过了一段"}亲密时光。`));
  }
  const relation = slot.state.TALENT;
  const mood = (relation[TALENT_ID.恋人] ?? 0) !== 0 || (relation[TALENT_ID.恋慕] ?? 0) !== 0
    ? "两人仍依偎在一起，说着不愿结束的情话。"
    : (relation[TALENT_ID.愛欲] ?? 0) !== 0
      ? "炽热的气息久久没有散去，两人花了好一会儿才平复呼吸。"
      : (relation[TALENT_ID.思慕] ?? 0) !== 0
        ? "两人带着羞涩互相注视，谁也没有先移开视线。"
        : "情事结束后，房间里只剩下短暂而尴尬的安静。";
  if (climax > 0 && (maxStamina <= 0 || stamina < Math.max(Math.trunc(maxStamina * 0.9), maxStamina - 500))) {
    moodEvents.push(narration(now, mood));
  }

  let fluidKojoDetail: 1 | 2 | null = null;
  if (fillV >= 50 || fillA >= 50) {
    const parts = [fillV >= 50 ? "膣内" : "", fillA >= 50 ? "肛内" : ""].filter(Boolean).join("和");
    fluid.push(narration(now, `${targetName}体内的精液从${parts}缓缓溢出，怎么擦拭也无法立刻清理干净。`));
    fluidKojoDetail = 1;
  } else if (lubrication >= 100) {
    fluid.push(narration(now, `${targetName}湿漉漉的身体仍在发热，爱液沿着腿根慢慢流下。`));
    fluidKojoDetail = 2;
  }

  if (desire >= 700) {
    clothing.push(narration(now, `${targetName}的肌肤泛着潮红，余韵让人再次心跳加速。`));
  }
  const upper = readTequip(slot, TEQUIP_ID.上半身着衣状況);
  if (upper > 0) {
    clothing.push(narration(now, `${targetName}背过身去，慌忙整理着凌乱的衣服。`));
  }
  return { opening, fluid, fluidKojoDetail, mood: moodEvents, clothing };
}
