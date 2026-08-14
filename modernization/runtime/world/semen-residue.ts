/**
 * 精液残留子系统 — 沉积端 + 夜结算消费端。
 *
 * 这是「浓厚精液」机制的**执行端**补全。现代侧此前只移植了 trait 的获得/消失
 * （`sleep.ts` 禁欲块 3 天获得/射精次日消失 + ONANISM 置 `TALENT:濃厚精液`），
 * 但让 trait 产生真实数值影响的两段缺失：
 *
 *   1. **沉积端** — 上游 `SOURCE_射精確定後処理.ERB:264-272`：中出し时把
 *      `NOWEX:SENDER:射精量` 写入 `EX:膣内精液/肛門内精液`、`EX:精液残量`、
 *      累計精浴/累計膣内(肛門)精液、捐赠者 CFLAG 标记（3000+/3500+ 段）。
 *   2. **消费端** — 上游 `イベント関連/AFTERTRA.ERB:44-260` per-chara 夜结算块：
 *      射精 flag 清理、心情清零、`SEMEN_POISON_PLUS`（持有濃厚精液者的残留 → 双倍）、
 *      残留精液 JUEL 伤害（屈服/欲情）、精液中毒 1-5 级升级、精愛味覚、
 *      膣射/肛射中毒升级、JYCL 残留处理。
 *
 * 忠实约定：
 *   - 整数除法一律 `Math.trunc`（Emuera `/` 语义）。
 *   - `SHOOTINGSTAR`（魔法 DLC）未建模 → 默认 0，取 `射精量` 公式的非 DLC 分支。
 *   - `JYCL`（DLC SAVEDATA 全局）未建模 → 默认 0：夜结算不保留残留（走上游 ELSE 臂），
 *     捐赠者 CFLAG 标记与 EX 残留当夜清零，避免隔夜重复计伤。
 *   - `KIGEN_CHANGE` 函数未建模 → 只做 `TALENT:心情 = 0`（AFTERTRA:92 前半）。
 *   - 该块的 寸止め积攒度/処女觉醒/初潮（:138-203）、祈願解除/喜欢的体位（:67-75）
 *     属独立子机制，见 LIFECYCLE-HOOK-COMPLETENESS-AUDIT，不在此模块。
 */

import type { GameState, CharaSlotState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  PALAM_ID,
  TALENT_ID,
} from "../state/settlement.js";
import { juelAdd } from "../state/juel.js";

const trunc = Math.trunc;

/** 捐赠者残留 CFLAG 标记基址：`CFLAG:(3000+捐赠者)` = 该捐赠者在本角色体内残留量（膣内）。 */
const VAGINAL_DONOR_BASE = 3000;
/** 肛門内版本（AFTERTRA.ERB:277-280 每夜全清）。 */
const ANAL_DONOR_BASE = 3500;

function abl(st: CharaSlotState, id: number): number {
  return st.ABL[id] ?? 0;
}
function cflag(st: CharaSlotState, id: number): number {
  return st.CFLAG[id] ?? 0;
}
function talent(st: CharaSlotState, id: number): number {
  return st.TALENT[id] ?? 0;
}

/**
 * `NOWEX:SENDER:射精量`（SOURCE_射精確定後処理.ERB:28-33，`SHOOTINGSTAR==0` 分支）：
 *
 *     c      = trunc(Ｃ感覚/2) + 10
 *     step1  = trunc(trunc(BASE:射精 * 10 / c) / 100)
 *     射精量  = trunc(step1 * 10 / c)
 *
 * SHOOTINGSTAR（魔法 DLC）未建模 → 默认 0，不乘 `SHOOTINGSTAR_NUM`。
 */
export function ejaculateAmount(st: CharaSlotState): number {
  const base = st.BASE[BASE_ID.射精] ?? 0;
  const c = trunc(abl(st, ABL_ID.Ｃ感覚) / 2) + 10;
  if (c <= 0) return 0;
  const step1 = trunc(trunc((base * 10) / c) / 100);
  return trunc((step1 * 10) / c);
}

export interface DepositEjaculateInput {
  /** 捐赠者（射精方）charaNum。 */
  sender: number;
  /** 接收者（被中出方）charaNum。 */
  receiver: number;
  /** 射精部位：1=膣内 / 2=肛門（TCVAR:射精箇所 语义）。 */
  site: 1 | 2;
  /** 射精量（ml）。通常传 `ejaculateAmount(sender.state)`。 */
  amount: number;
}

/**
 * `SOURCE_射精確定後処理.ERB:264-272` 的残留沉积（忠实子集，不含 STAIN/POISONBODY/
 * SAMEN_SHOOT3/EXP 派生——那些属 H 展示与传播层，见审计清册 defer）。
 *
 * 写入（接收者侧）：
 *   - `EX:膣内精液/肛門内精液 += 射精量`        → 驱动夜结算残留 JUEL 伤害
 *   - `EX:精液残量/アナル精液残量 += 射精量`    → 充填率展示
 *   - `CFLAG:累計膣内(肛門)精液 += 射精量`、`CFLAG:累計精浴 += 射精量` → 驱动精液中毒升级
 *   - `CFLAG:(3000|3500+捐赠者) += 射精量`      → 捐赠者标记，驱动 SEMEN_POISON_PLUS 双倍
 * 以及（捐赠者侧）`CFLAG:累計膣内射精 += 射精量`。
 */
export function depositEjaculate(state: GameState, input: DepositEjaculateInput): void {
  const receiverSlot = input.receiver === 0 ? state.master : state.charas[input.receiver];
  if (!receiverSlot) return;
  const senderSlot = input.sender === 0 ? state.master : state.charas[input.sender];
  if (!senderSlot) return;
  const amount = Math.max(0, Math.trunc(input.amount));
  if (amount <= 0) return;

  const st = receiverSlot.state;
  const residueEx = input.site === 1 ? EX_ID.膣内精液 : EX_ID.肛門内精液;
  const residualEx = input.site === 1 ? EX_ID.精液残量 : EX_ID.アナル精液残量;
  const cumEx = input.site === 1 ? CFLAG_ID.累計膣内精液 : CFLAG_ID.累計肛門精液;
  const donorBase = input.site === 1 ? VAGINAL_DONOR_BASE : ANAL_DONOR_BASE;

  st.EX[residueEx] = (st.EX[residueEx] ?? 0) + amount;
  st.EX[residualEx] = (st.EX[residualEx] ?? 0) + amount;
  st.CFLAG[cumEx] = cflag(st, cumEx) + amount;
  st.CFLAG[CFLAG_ID.累計精浴] = cflag(st, CFLAG_ID.累計精浴) + amount;
  st.CFLAG[donorBase + input.sender] = cflag(st, donorBase + input.sender) + amount;
  // Pregnancy consumes the upstream 2000+ donor ledger before nightly cleanup;
  // keep the existing 3000+ poison marker as a separate compatibility mirror.
  if (input.site === 1) st.CFLAG[2000 + input.sender] = cflag(st, 2000 + input.sender) + amount;
  // 捐赠者侧 累計膣内射精（SOURCE_射精確定後処理.ERB:271 只对膣内 CASE）。
  if (input.site === 1) {
    senderSlot.state.CFLAG[CFLAG_ID.累計膣内射精] =
      cflag(senderSlot.state, CFLAG_ID.累計膣内射精) + amount;
  }
}

export interface SemenResidueDeps {
  now: () => number;
}

/**
 * 夜结算消费端 — `AFTERTRA.ERB:44-260` per-chara 循环（忠实子集）。
 * 对 MASTER + 每个已注册角色逐个结算；返回叙述流（JUEL 增长不输出「宝珠＋N」，
 * 与 `juel-check-flow.ts` 的实玩反馈一致，只保留风味行与升级行）。
 *
 * 必须跑在 `sleep.ts` 禁欲块（清 MASTER 濃厚精液）**之前**——`SEMEN_POISON_PLUS`
 * 要读到捐赠者当夜尚未被清掉的 `濃厚精液` trait。
 */
export function runSemenResidueSettlement(
  state: GameState,
  deps: SemenResidueDeps,
): ObservationEvent[] {
  const { now } = deps;
  const events: ObservationEvent[] = [];
  const charaNums = [0, ...Object.keys(state.charas).map(Number)]
    .sort((a, b) => a - b);

  for (const num of charaNums) {
    const slot = num === 0 ? state.master : state.charas[num];
    if (!slot) continue;
    const st = slot.state;
    const name = slot.callName ?? (num === 0 ? "主人" : `角色${num}`);
    const nar = (text: string): void => {
      events.push({ kind: "NARRATION" as const, timestamp: now(), charaNum: num, text });
    };

    // ----- 射精 flag 清理 (AFTERTRA:44-49 MASTER / :60-66 per-chara) -----
    st.CFLAG[CFLAG_ID.膣内射精] = 0;
    st.CFLAG[CFLAG_ID.肛門射精] = 0;
    st.CFLAG[CFLAG_ID.口内精液] = 0;
    st.CFLAG[CFLAG_ID.脸上精液] = 0;
    st.CFLAG[CFLAG_ID.手上精液] = 0;
    st.CFLAG[CFLAG_ID.没穿内裤] = 0;

    // ----- 心情清零 (AFTERTRA:92-93; KIGEN_CHANGE 后半未建模) -----
    st.TALENT[TALENT_ID.心情] = 0;

    // ----- 中毒级联倍率 LOCAL:1 (AFTERTRA:81-90) -----
    const poisonLv = abl(st, ABL_ID.精液中毒);
    const local1 = poisonLv === 0 ? 5 : poisonLv <= 3 ? 7 : poisonLv <= 7 ? 10 : 20;

    // ----- SEMEN_POISON_PLUS (AFTERTRA:94-114): 捐赠者持濃厚精液 → 伤害翻倍 -----
    const vaginalResidue = st.EX[EX_ID.膣内精液] ?? 0;
    const analResidue = st.EX[EX_ID.肛門内精液] ?? 0;
    let poisonPlus = 0;
    if (vaginalResidue > 0 || analResidue > 0) {
      const donorNums = (vaginalResidue > 0 ? charaNums : []).concat(
        analResidue > 0 ? charaNums : [],
      );
      for (const donor of donorNums) {
        const donorSlot = donor === 0 ? state.master : state.charas[donor];
        if (!donorSlot) continue;
        const donorBase = vaginalResidue > 0 && cflag(st, VAGINAL_DONOR_BASE + donor) > 0
          ? VAGINAL_DONOR_BASE
          : cflag(st, ANAL_DONOR_BASE + donor) > 0
            ? ANAL_DONOR_BASE
            : -1;
        if (donorBase >= 0 && talent(donorSlot.state, TALENT_ID.濃厚精液) !== 0) {
          poisonPlus = 1;
          break;
        }
      }
    }
    const multiplier = poisonPlus === 1 ? local1 * 2 : local1;

    // ----- 残留精液 JUEL 伤害 (AFTERTRA:116-137) -----
    if (vaginalResidue > 200 || analResidue > 200) {
      if (vaginalResidue > 200 && analResidue > 200) {
        nar(`感受着精子的温柔爱抚，${name}的阴道和肛门又热又痒❤…`);
      } else if (vaginalResidue > 200) {
        nar(`感受着精子的温柔爱抚，${name}的阴道又热又痒❤…`);
      } else {
        nar(`感受着精子的温柔爱抚，${name}的肛门又热又痒❤…`);
      }
      if (vaginalResidue > 200) {
        const dmg = multiplier * (abl(st, ABL_ID.膣射中毒) + 1) * vaginalResidue;
        juelAdd(st, PALAM_ID.屈服, dmg);
        juelAdd(st, PALAM_ID.欲情, dmg);
      }
      if (analResidue > 200) {
        const dmg = multiplier * (abl(st, ABL_ID.肛射中毒) + 1) * analResidue;
        juelAdd(st, PALAM_ID.屈服, dmg);
        juelAdd(st, PALAM_ID.欲情, dmg);
      }
    }

    // ----- 精液中毒 1-5 级升级 (AFTERTRA:204-232) -----
    const easy = talent(st, TALENT_ID.容易中毒);
    const threshold = (n: number): number => trunc((n * (10 - 2 * easy)) / 10);
    const cumulative =
      cflag(st, CFLAG_ID.累計精浴) +
      cflag(st, CFLAG_ID.累計精飲) * 5 +
      cflag(st, CFLAG_ID.累計膣内精液) +
      cflag(st, CFLAG_ID.累計肛門精液);
    if (poisonLv < 5) {
      const prev = poisonLv;
      if (cumulative >= threshold(20000) && poisonLv === 4) {
        st.ABL[ABL_ID.精液中毒] = 5;
      } else if (cumulative >= threshold(15000) && poisonLv === 3) {
        st.ABL[ABL_ID.精液中毒] = 4;
      } else if (cumulative >= threshold(10000) && poisonLv === 2) {
        st.ABL[ABL_ID.精液中毒] = 3;
      } else if (cumulative >= threshold(5000) && poisonLv < 2) {
        st.ABL[ABL_ID.精液中毒] = 2;
      } else if (cumulative >= threshold(3000) && poisonLv === 0) {
        st.ABL[ABL_ID.精液中毒] = 1;
      }
      const after = abl(st, ABL_ID.精液中毒);
      if (after > prev) nar(`${name}的精液中毒达到了${after}级`);
    }

    // ----- 精愛味覚获得 (AFTERTRA:233-239) -----
    if (
      cflag(st, CFLAG_ID.累計精飲) > threshold(10000) &&
      talent(st, TALENT_ID.精愛味覚) === 0
    ) {
      st.TALENT[TALENT_ID.精愛味覚] = 1;
      nar(`${name}得到了【精爱味觉】`);
    }

    // ----- 膣射/肛射中毒升级 (AFTERTRA:240-252, ELSEIF 先膣后肛) -----
    if (abl(st, ABL_ID.精液中毒) >= 5) {
      const vagAddict = abl(st, ABL_ID.膣射中毒);
      const analAddict = abl(st, ABL_ID.肛射中毒);
      if (
        cflag(st, CFLAG_ID.累計膣内精液) > threshold(3000 * vagAddict) &&
        vaginalResidue > 200 &&
        vagAddict < 5
      ) {
        st.ABL[ABL_ID.膣射中毒] = vagAddict + 1;
        nar(`${name}的膣道变得渴望着精液`);
      } else if (
        cflag(st, CFLAG_ID.累計肛門精液) > threshold(3000 * analAddict) &&
        analResidue > 200 &&
        analAddict < 5
      ) {
        st.ABL[ABL_ID.肛射中毒] = analAddict + 1;
        nar(`${name}的肛门变得渴望着精液`);
      }
    }

    // ----- JYCL 残留处理 (AFTERTRA:254-260): JYCL 未建模 → 默认 0，不保留 -----
    st.CFLAG[CFLAG_ID.子宮内精子] = 0;
    for (const donor of charaNums) {
      st.CFLAG[VAGINAL_DONOR_BASE + donor] = 0;
      st.CFLAG[2000 + donor] = 0;
    }
    // EX 残留当夜清零（等价上游 BEFORETRAIN:892 晨清；在此清零防隔夜重复计伤）。
    st.EX[EX_ID.膣内精液] = 0;
    st.EX[EX_ID.肛門内精液] = 0;
    st.EX[EX_ID.精液残量] = 0;
    st.EX[EX_ID.アナル精液残量] = 0;
  }

  // 肛内捐赠者残留标记全清 (AFTERTRA:277-280)。
  for (const num of charaNums) {
    const slot = num === 0 ? state.master : state.charas[num];
    if (!slot) continue;
    for (const donor of charaNums) {
      slot.state.CFLAG[ANAL_DONOR_BASE + donor] = 0;
    }
  }

  return events;
}
