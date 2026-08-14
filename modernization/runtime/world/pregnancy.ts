/** Deterministic conception, gestation, birth, and child-growth settlement. */
import type { ObservationEvent } from "../../schemas/types.js";
import type { ChildRecord, CharaSlot, GameState } from "../state/game-state.js";
import { bodyFillRate } from "../state/body-fill-rate.js";
import { ABL_ID, BASE_ID, CFLAG_ID, EX_ID, EXP_ID, FLAG_ID, TALENT_ID } from "../state/settlement.js";
import type { Rng } from "../command/rng.js";

const pregnancyThreshold = 2000;
const childMilestones: Array<[number, string]> = [[25, "断奶"], [26, "玩具"], [28, "扶站"], [30, "走路"], [35, "说话"], [45, "词汇"], [55, "管教"], [60, "入学"], [90, "独立前"], [120, "独立"]];
const allSlots = (state: GameState): CharaSlot[] => [state.master, ...Object.values(state.charas)];
const hasVagina = (slot: CharaSlot) => ((slot.state.TALENT[TALENT_ID.性別] ?? 0) & 1) !== 0;
const hasVaginaAndEligible = (slot: CharaSlot) => hasVagina(slot) && !((slot.state.TALENT[TALENT_ID.幼稚] ?? 0) && !(slot.state.TALENT[TALENT_ID.初潮] ?? 0));
const maternityLeaveType = (slot: CharaSlot): number => slot.state.CFLAG[CFLAG_ID.産休タイプ] ?? -1;
const correction = (slot: CharaSlot) => {
  const n = slot.state.ABL[ABL_ID.膣射中毒] ?? 0;
  return n <= 2 ? 5 : n <= 5 ? 4 : 2;
};
function estrus(cycle: number): number { return [0, 15, 15, 30, 30, 50, 70, 150, 100, 60, 40][Math.max(0, Math.min(10, cycle))] ?? 40; }
function event(now: () => number, text: string, charaNum?: number): ObservationEvent { return { kind: "NARRATION", timestamp: now(), text, ...(charaNum === undefined ? {} : { charaNum }) }; }
function downBaseAndMax(slot: CharaSlot, id: number, amount: number): void {
  slot.state.BASE[id] = Math.max(0, (slot.state.BASE[id] ?? 0) - amount);
  slot.state.MAXBASE[id] = Math.max(0, (slot.state.MAXBASE[id] ?? 0) - amount);
}

function conceive(mother: CharaSlot, father: CharaSlot, rng: Rng, now: () => number): ObservationEvent[] {
  const ms = mother.state; const amount = ms.CFLAG[2000 + father.charaNum] ?? 0;
  if (amount <= 0 || (ms.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0) > 0 || ((ms.CFLAG[CFLAG_ID.出産経過日] ?? 0) >= 1 && (ms.CFLAG[CFLAG_ID.出産経過日] ?? 0) <= 59) || !hasVaginaAndEligible(mother)) return [];
  const uterine = Math.max(0, (ms.EX[EX_ID.子宮内精液] ?? 0) + Math.trunc((ms.EX[EX_ID.膣内精液] ?? 0) / correction(mother)));
  ms.EX[EX_ID.子宮内精液] = uterine;
  ms.EX[EX_ID.妊娠判定用精液量] = amount;
  const fill = bodyFillRate(ms, 5) ?? 0;
  const cycle = estrus(ms.CFLAG[CFLAG_ID.生理周期] ?? 0);
  const threshold = Math.max(500, pregnancyThreshold - (ms.CFLAG[CFLAG_ID.子宝補正] ?? 0) * 10);
  const adjusted = Math.max(1, Math.trunc(threshold * ((father.state.TALENT[TALENT_ID.濃厚精液] ?? 0) ? 0.25 : 1) * ((ms.TALENT[TALENT_ID.妊娠願望] ?? 0) ? 0.8 : 1)));
  if (Math.max(0, fill) * cycle / 100 <= rng.int(adjusted)) return [];
  ms.CFLAG[CFLAG_ID.妊娠経過日数] = 1;
  ms.CFLAG[CFLAG_ID.誰の子] = father.charaNum;
  const consciouslyRecognized = (ms.CFLAG[CFLAG_ID.身に覚え_母] ?? 0) !== 0;
  ms.CFLAG[CFLAG_ID.無自覚妊娠] = consciouslyRecognized ? 0 : 1;
  if (consciouslyRecognized) father.state.CFLAG[CFLAG_ID.身に覚え_父] = 1;
  ms.CFLAG[CFLAG_ID.胎児愛情値] = 0;
  return [event(now, `${mother.callName ?? `#${mother.charaNum}`}受孕了${father.callName ?? `#${father.charaNum}`}的孩子。`, mother.charaNum)];
}

function birth(state: GameState, mother: CharaSlot, now: () => number, settlementDay: number): ObservationEvent[] {
  const ms = mother.state; const fatherNum = ms.CFLAG[CFLAG_ID.誰の子] ?? 0; const father = fatherNum === 0 ? state.master : state.charas[fatherNum];
  // A deleted/migrated father must not leave pregnancy progress above 100
  // forever. Keep the serialized parent id for auditability, but complete the
  // birth with an absent-parent fallback and skip the missing parent's mirrors.
  state.children ??= {};
  const list = state.children[mother.charaNum] ?? (state.children[mother.charaNum] = []);
  const id = list.length + 1; const forced = state.flagStore[FLAG_ID.兒童の性別]; const sex: 1 | 2 = forced === 1 || forced === 2 ? forced : ((state.time.dayIndex + id) % 2 ? 1 : 2);
  const child: ChildRecord = { id, mother: mother.charaNum, father: fatherNum, sex, name: `${sex === 1 ? "女儿" : "儿子"}${id}`, birthdayDay: settlementDay, love: ms.CFLAG[CFLAG_ID.胎児愛情値] ?? 0, independent: false };
  list.push(child); ms.CFLAG[CFLAG_ID.兒童人数] = (ms.CFLAG[CFLAG_ID.兒童人数] ?? 0) + 1; ms.CFLAG[CFLAG_ID.育児人数] = (ms.CFLAG[CFLAG_ID.育児人数] ?? 0) + 1; ms.CFLAG[CFLAG_ID.出産経過日] = 1; ms.CFLAG[CFLAG_ID.誰の子] = 0; ms.CFLAG[CFLAG_ID.妊娠経過日数] = 0; ms.CFLAG[CFLAG_ID.無自覚妊娠] = 0; ms.CFLAG[CFLAG_ID.妊娠自覚状態] = 0; ms.CFLAG[CFLAG_ID.身に覚え_母] = 0; ms.CFLAG[CFLAG_ID.産休中] = 0; ms.CFLAG[CFLAG_ID.胎児愛情値] = 0; ms.TALENT[TALENT_ID.妊娠] = 0; ms.TALENT[TALENT_ID.育児中] = id;
  ms.EXP[EXP_ID.出産経験] = (ms.EXP[EXP_ID.出産経験] ?? 0) + 1;
  ms.EXP[EXP_ID.愛情経験] = (ms.EXP[EXP_ID.愛情経験] ?? 0) + 10;
  if (!(ms.TALENT[TALENT_ID.母性] ?? 0)) ms.TALENT[TALENT_ID.母性] = 1;
  if (!(ms.TALENT[TALENT_ID.母乳体質] ?? 0)) ms.TALENT[TALENT_ID.母乳体質] = 1;
  if (father) {
    father.state.CFLAG[CFLAG_ID.兒童人数] = (father.state.CFLAG[CFLAG_ID.兒童人数] ?? 0) + 1;
    father.state.CFLAG[CFLAG_ID.育児人数] = (father.state.CFLAG[CFLAG_ID.育児人数] ?? 0) + 1;
    father.state.CFLAG[CFLAG_ID.身に覚え_父] = 0;
  }
  const parentText = father ? `，父亲是${father.callName ?? `#${father.charaNum}`}` : "（父亲记录已失效）";
  return [event(now, `${mother.callName ?? `#${mother.charaNum}`}平安生下了${child.name}${parentText}。`, mother.charaNum)];
}

export function runPregnancySettlement(state: GameState, deps: { now: () => number; rng: Rng; settlementDay?: number }): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const settlementDay = deps.settlementDay ?? state.time.dayIndex;
  for (const mother of allSlots(state)) {
    const ms = mother.state;
    const existingChildren = state.children?.[mother.charaNum] ?? [];
    const currentChild = existingChildren.filter((child) => !child.independent).at(-1);
    if (currentChild) {
      ms.CFLAG[CFLAG_ID.出産経過日] = settlementDay - currentChild.birthdayDay + 1;
      ms.TALENT[TALENT_ID.育児中] = currentChild.id;
    }
    const progress = ms.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0;
    if (progress <= 0) {
      for (const father of allSlots(state)) events.push(...conceive(mother, father, deps.rng, deps.now));
    } else {
      const next = progress + 1 + Math.max(0, Math.trunc(state.flagStore[FLAG_ID.妊娠日程倍率] ?? 0)); ms.CFLAG[CFLAG_ID.妊娠経過日数] = next;
      if (next === 20) {
        ms.TALENT[TALENT_ID.妊娠] = 1;
        // PREGNANCY.ERB:@PERCIEVE:20. This flag is consumed by movement,
        // work, and drinking gates; TALENT:妊娠 alone is not sufficient.
        const aware = (ms.CFLAG[CFLAG_ID.無自覚妊娠] ?? 0) === 0;
        if (aware) ms.CFLAG[CFLAG_ID.妊娠自覚状態] = 1;
        events.push(event(deps.now, aware
          ? `${mother.callName ?? `#${mother.charaNum}`}意识到自己怀孕了。`
          : `${mother.callName ?? `#${mother.charaNum}`}的身体出现了怀孕的变化，但本人还没有察觉。`, mother.charaNum));
      }
      if (next === 30) {
        if ((ms.CFLAG[CFLAG_ID.無自覚妊娠] ?? 0) === 0 && maternityLeaveType(mother) === 0) ms.CFLAG[CFLAG_ID.産休中] = 1;
        downBaseAndMax(mother, BASE_ID.体力, 100);
        downBaseAndMax(mother, BASE_ID.気力, 100);
      }
      if (next === 40) {
        if ((ms.CFLAG[CFLAG_ID.無自覚妊娠] ?? 0) === 0 && maternityLeaveType(mother) === 1) ms.CFLAG[CFLAG_ID.産休中] = 1;
        downBaseAndMax(mother, BASE_ID.体力, 200);
        downBaseAndMax(mother, BASE_ID.気力, 200);
      }
      if (next === 60) {
        if ((ms.TALENT[TALENT_ID.胸围] ?? 0) < 2) {
          ms.TALENT[TALENT_ID.胸围] = (ms.TALENT[TALENT_ID.胸围] ?? 0) + 1;
          ms.CFLAG[CFLAG_ID.乳ランクアップ] = (ms.CFLAG[CFLAG_ID.乳ランクアップ] ?? 0) + 1;
        }
        if (!(ms.TALENT[TALENT_ID.母乳体質] ?? 0)) ms.TALENT[TALENT_ID.母乳体質] = 1;
        if ((ms.CFLAG[CFLAG_ID.無自覚妊娠] ?? 0) !== 0) {
          if (maternityLeaveType(mother) === 0 || maternityLeaveType(mother) === 1) ms.CFLAG[CFLAG_ID.産休中] = 1;
          ms.CFLAG[CFLAG_ID.妊娠自覚状態] = 1;
          events.push(event(deps.now, `${mother.callName ?? `#${mother.charaNum}`}终于无法再欺骗自己，意识到已经怀孕了。`, mother.charaNum));
        } else if (maternityLeaveType(mother) === 2) {
          ms.CFLAG[CFLAG_ID.産休中] = 1;
        }
        downBaseAndMax(mother, BASE_ID.体力, 200);
        downBaseAndMax(mother, BASE_ID.気力, 200);
      }
      if (next === 71) {
        if ((ms.TALENT[TALENT_ID.HYPERFERTILE] ?? 0) === 0 && maternityLeaveType(mother) > -1) ms.CFLAG[CFLAG_ID.産休中] = 1;
        events.push(event(deps.now, `${mother.callName ?? `#${mother.charaNum}`}即将临产。`, mother.charaNum));
      }
      if (next > 100) events.push(...birth(state, mother, deps.now, settlementDay));
    }
    const children = state.children?.[mother.charaNum] ?? [];
    for (const child of children) {
      const age = settlementDay - child.birthdayDay + 1;
      if (!child.independent && age >= 120) {
        child.independent = true;
        ms.CFLAG[CFLAG_ID.育児人数] = Math.max(0, (ms.CFLAG[CFLAG_ID.育児人数] ?? 0) - 1);
        const father = child.father === 0 ? state.master : state.charas[child.father];
        if (father) father.state.CFLAG[CFLAG_ID.育児人数] = Math.max(0, (father.state.CFLAG[CFLAG_ID.育児人数] ?? 0) - 1);
        events.push(event(deps.now, `${child.name}已经独立生活。`, mother.charaNum));
      } else if (!child.independent && childMilestones.some(([day]) => day === age)) {
        events.push(event(deps.now, `${child.name}成长到了${childMilestones.find(([day]) => day === age)![1]}阶段。`, mother.charaNum));
      }
      if (age === 25 && (ms.CFLAG[CFLAG_ID.乳ランクアップ] ?? 0) > 0) {
        ms.TALENT[TALENT_ID.胸围] = Math.max(-2, (ms.TALENT[TALENT_ID.胸围] ?? 0) - 1);
        ms.CFLAG[CFLAG_ID.乳ランクアップ] = Math.max(0, (ms.CFLAG[CFLAG_ID.乳ランクアップ] ?? 0) - 1);
        if ((ms.TALENT[TALENT_ID.母乳体質] ?? 0) === 1) ms.TALENT[TALENT_ID.母乳体質] = 0;
      }
    }
    const youngest = children.filter((child) => !child.independent).at(-1);
    ms.CFLAG[CFLAG_ID.出産経過日] = youngest ? settlementDay - youngest.birthdayDay + 1 : 0;
    ms.TALENT[TALENT_ID.育児中] = youngest?.id ?? 0;
  }
  return events;
}
