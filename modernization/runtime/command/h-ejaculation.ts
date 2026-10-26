/** Non-DLC EVENT_SHOOT port for the deterministic H command loop. */
import type { CharaSlot, GameState } from "../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  getRevision,
  palamLv,
} from "../state/settlement.js";
import { isEquipped } from "../state/tequip.js";
import { settleHEjaculation } from "./h-v-a-settlement.js";
import { isHMode, isSelfPleasureCommand, isSelfPleasureSessionActive } from "./h-mode.js";
import { getTflag, TFLAG_ID } from "../state/tflag.js";
import {
  ejaculationSiteInfo,
  hEjaculationMarkerBitsForAction,
  hEjaculationMarkerLabels,
} from "./h-ejaculation-semantics.js";
import type { CommandContext, CommandResult } from "./types.js";

type Stimulus = { site: number; strength: number; service?: boolean };

const FIXED_MASTER_STIMULUS: Readonly<Record<number, Stimulus>> = {
  80: { site: 3, strength: 700, service: true },
  81: { site: 4, strength: 1000, service: true },
  82: { site: 5, strength: 1200, service: true },
  83: { site: 6, strength: 900, service: true },
  84: { site: 8, strength: 1200, service: true },
  85: { site: 7, strength: 600, service: true },
  88: { site: 4, strength: 1500, service: true },
  145: { site: 9, strength: 250, service: true },
  150: { site: 5, strength: 1200, service: true },
  702: { site: 4, strength: 1500 },
  709: { site: 3, strength: 500 },
};

const V_INSERTION = new Set([60, 61, 65, 67, 68]);
const A_INSERTION = new Set([62, 63, 66, 69, 70]);

/** Current-action markers are turn-local in upstream even though TCVAR stores them. */
export function prepareHCommandStimulus(ctx: CommandContext): void {
  if (!isHMode(ctx.state, ctx.target) &&
      !(isSelfPleasureCommand(ctx.commandNo) && isSelfPleasureSessionActive(ctx.state))) return;
  for (const slot of [ctx.state.master, ctx.state.charas[ctx.target]].filter(
    (value): value is CharaSlot => Boolean(value),
  )) {
    slot.state.TCVAR[TCVAR_ID.射精箇所] = 0;
    slot.state.TCVAR[TCVAR_ID.射精快感強度] = 0;
    slot.state.TCVAR[TCVAR_ID.奉仕フラグ] = 0;
    slot.state.TCVAR[TCVAR_ID.射精槽増加量] = 0;
    slot.state.TCVAR[TCVAR_ID.口上出力用射精部位] = 0;
  }
}

function restoreMissingStimulus(state: GameState, ctx: CommandContext): void {
  const master = state.master;
  const target = state.charas[ctx.target];
  if (!target) return;
  let stimulus = FIXED_MASTER_STIMULUS[ctx.commandNo];
  if (V_INSERTION.has(ctx.commandNo) || A_INSERTION.has(ctx.commandNo)) {
    const anal = A_INSERTION.has(ctx.commandNo);
    stimulus = {
      site: anal ? 2 : 1,
      strength: 500 +
        (master.state.ABL[ABL_ID.腰] ?? 0) * 50 +
        (master.state.ABL[anal ? ABL_ID.肛門 : ABL_ID.膣] ?? 0) * 50,
    };
    if ((target.state.TCVAR[TCVAR_ID.射精快感強度] ?? 0) <= 0) {
      target.state.TCVAR[TCVAR_ID.射精箇所] = anal ? 12 : 13;
      target.state.TCVAR[TCVAR_ID.射精快感強度] = 1500;
      target.state.TCVAR[TCVAR_ID.行為者] = master.charaNum;
    }
  }
  if (!stimulus || (master.state.TCVAR[TCVAR_ID.射精快感強度] ?? 0) > 0) return;
  master.state.TCVAR[TCVAR_ID.射精箇所] = stimulus.site;
  master.state.TCVAR[TCVAR_ID.射精快感強度] = stimulus.strength;
  master.state.TCVAR[TCVAR_ID.奉仕フラグ] = stimulus.service ? 1 : 0;
  master.state.TCVAR[TCVAR_ID.行為者] = target.charaNum;
}

function lubricationFactor(slot: CharaSlot): number {
  const value = slot.state.PALAM[PALAM_ID.潤滑] ?? 0;
  if (value >= palamLv(7)) return 10;
  if (value >= palamLv(4)) return 8;
  if (value >= palamLv(3)) return 6;
  if (value >= palamLv(2)) return 4;
  return 2;
}

function partCorrection(provider: CharaSlot, site: number): number {
  const abl = provider.state.ABL;
  switch (site) {
    case 1: return Math.trunc(((abl[ABL_ID.腰] ?? 0) + (abl[ABL_ID.膣] ?? 0) * 2) / 2) - 3;
    case 2: return Math.trunc(((abl[ABL_ID.腰] ?? 0) + (abl[ABL_ID.肛門] ?? 0) * 2) / 2) - 3;
    case 3: return (abl[ABL_ID.指] ?? 0) - 3;
    case 4: return (abl[ABL_ID.舌] ?? 0) - 3;
    case 5: return (abl[ABL_ID.胸] ?? 0) - 3;
    case 7: return (abl[ABL_ID.足] ?? 0) - 3;
    default: return 0;
  }
}

function erectionAdjustedGauge(slot: CharaSlot, raw: number): number {
  let erection = slot.state.BASE[BASE_ID.勃起] ?? 0;
  if (erection < 300) erection += Math.trunc(raw / 5);
  else if (erection < 500) erection += Math.trunc(raw / 4);
  else if (erection < 1000) erection += Math.trunc(raw / 3);
  else if (erection < 1500) erection += Math.trunc(raw / 2);
  else erection += Math.trunc((raw * 2) / 3);
  slot.state.BASE[BASE_ID.勃起] = erection;

  if (erection < 500) return Math.trunc(raw / 5);
  if (erection < 1000) return Math.trunc(raw / 3);
  if (erection < 1500) return Math.trunc((raw * 2) / 5);
  return Math.trunc(raw / 2);
}

function eventShootFor(
  state: GameState,
  sender: CharaSlot,
  provider: CharaSlot,
  markerBits: ReturnType<typeof hEjaculationMarkerBitsForAction>,
  selfPleasure: boolean,
): { ejaculated: boolean; amount: number; site: number; condom: boolean; receiver: number } {
  const site = sender.state.TCVAR[TCVAR_ID.射精箇所] ?? 0;
  const strength = sender.state.TCVAR[TCVAR_ID.射精快感強度] ?? 0;
  const siteInfo = ejaculationSiteInfo(site);
  const receiver = selfPleasure && sender.charaNum === state.master.charaNum
    ? sender.charaNum
    : provider.charaNum;
  if (!siteInfo || strength <= 0 || ((sender.state.TALENT[TALENT_ID.性別] ?? 0) & 2) === 0) {
    return { ejaculated: false, amount: 0, site, condom: false, receiver };
  }

  const skill = 10 + getRevision(provider.state.ABL[ABL_ID.技巧] ?? 0, 5, 5);
  const obedience = 10 + getRevision(provider.state.ABL[ABL_ID.従順] ?? 0, 3, 5);
  const service = (sender.state.TCVAR[TCVAR_ID.奉仕フラグ] ?? 0) !== 0
    ? 10 + getRevision(provider.state.ABL[ABL_ID.奉仕精神] ?? 0, 10, 5)
    : 10;
  const desire = site <= 2
    ? 10 + getRevision(sender.charaNum === state.master.charaNum ? 3 : (sender.state.ABL[ABL_ID.欲望] ?? 0), 5, 3)
    : 10;
  const lubrication = site <= 2 || site === 6 ? lubricationFactor(provider) : 10;
  const sensitivity = 10 + Math.trunc((sender.state.ABL[ABL_ID.Ｃ感覚] ?? 0) / 2);
  const part = Math.max(1, 10 + partCorrection(provider, site));
  let raw = Math.trunc(
    (strength * skill * obedience * service * desire * lubrication * sensitivity * part) /
      10_000_000,
  );
  if ((sender.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 2) {
    const energy = sender.state.BASE[BASE_ID.精力] ?? 0;
    const maxEnergy = sender.state.MAXBASE?.[BASE_ID.精力] ?? 0;
    if (maxEnergy > 0) raw = Math.trunc((raw * (energy + maxEnergy)) / (2 * maxEnergy));
  }
  const condom = (site === 1 || site === 2) && isEquipped(sender, TEQUIP_ID.避孕套);
  if (condom) raw = Math.trunc((raw * 4) / 5);
  let gauge = erectionAdjustedGauge(sender, raw);
  if ((sender.state.TCVAR[TCVAR_ID.要去了] ?? 0) === 0) {
    gauge = Math.trunc(gauge / (2 ** Math.max(0, sender.state.TCVAR[TCVAR_ID.射精我慢] ?? 0)));
  }
  sender.state.TCVAR[TCVAR_ID.射精槽増加量] = gauge;
  sender.state.BASE[BASE_ID.射精] = (sender.state.BASE[BASE_ID.射精] ?? 0) + gauge;

  const max = sender.state.MAXBASE?.[BASE_ID.射精] ?? 0;
  if ((sender.state.TCVAR[TCVAR_ID.要去了] ?? 0) === 0) {
    if (max > 0 && (sender.state.BASE[BASE_ID.射精] ?? 0) > max) {
      if ((sender.state.BASE[BASE_ID.勃起] ?? 0) < 1000) sender.state.BASE[BASE_ID.射精] = max - 1;
      else sender.state.TCVAR[TCVAR_ID.要去了] = 1;
    }
    return { ejaculated: false, amount: 0, site, condom, receiver };
  }

  const base = sender.state.BASE[BASE_ID.射精] ?? 0;
  const energy = sender.state.BASE[BASE_ID.精力] ?? 0;
  const count = Math.max(1, Math.min(Math.trunc(base / Math.max(1, max)), Math.trunc((100 + energy) / 100)));
  const inside = (site === 1 || site === 2) && !condom;
  const amount = settleHEjaculation(state, {
    sender: sender.charaNum,
    receiver,
    channel: site === 2 || site === 12 ? "a" : "v",
    inside,
    site,
    condom,
    markerBits,
    count,
  });
  sender.state.TCVAR[TCVAR_ID.要去了] = 0;
  return { ejaculated: true, amount, site, condom, receiver };
}

/** Run after SOURCE settlement and before PALAMCNG so A/B/C see NOWEX. */
export function withHCommandEjaculation(result: CommandResult, ctx: CommandContext): CommandResult {
  if (result.outcome !== "ok" || result.pendingKojoChoice || ctx.commandNo === 26 || ctx.commandNo === 999) return result;
  if (!isHMode(result.state, ctx.target) &&
      !(isSelfPleasureCommand(ctx.commandNo) && isSelfPleasureSessionActive(result.state))) return result;
  restoreMissingStimulus(result.state, ctx);
  const target = result.state.charas[ctx.target];
  if (!target) return result;
  const selfPleasure = isSelfPleasureCommand(ctx.commandNo) && isSelfPleasureSessionActive(result.state);
  const markerBits = hEjaculationMarkerBitsForAction(
    getTflag(result.state, TFLAG_ID.派生コマンド),
    ctx.commandNo,
  );
  // Upstream writes the player-only combination markers (20/21/23/24/26)
  // only when MASTER ejaculates. Marker 22 is the sole combination arm that
  // accepts either participant's ejaculation.
  const eitherParticipantMarkerBits = markerBits.filter((bit) => bit === 22);
  const masterResult = eventShootFor(result.state, result.state.master, target, markerBits, selfPleasure);
  const targetResult = eventShootFor(result.state, target, result.state.master, eitherParticipantMarkerBits, false);
  const events = [...result.events];
  for (const settled of [masterResult, targetResult]) {
    if (!settled.ejaculated) continue;
    const siteInfo = ejaculationSiteInfo(settled.site);
    const siteLabel = siteInfo?.label ?? "未知位置";
    const where = settled.condom ? `避孕套内（原部位：${siteLabel}）` : siteLabel;
    const receiver = settled.receiver === 0 ? result.state.master : result.state.charas[settled.receiver];
    const receiverMask = receiver?.state.TCVAR[TCVAR_ID.口上出力用射精部位] ?? 0;
    const comboLabels = hEjaculationMarkerLabels(receiverMask)
      .filter((label) => !["避孕套或体外承诺失败", "实际体外／体表结果"].includes(label));
    const context = comboLabels.length > 0 ? `（${comboLabels.join("、")}）` : "";
    const text = siteInfo?.kind === "stimulated-side"
      ? `在${siteLabel}时射精了${context}。`
      : `射精在${where}完成了${context}。`;
    events.push({ kind: "NARRATION", timestamp: ctx.now(), text });
  }
  return { ...result, events };
}
