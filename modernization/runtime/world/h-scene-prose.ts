/** Read-only H LOOK_AT projection, transcribed from ステータス表示関連/Look.ERB.
 * Command narration and kojo retain their own transcript. This projection is
 * recomputed from current state, never appended to eventLog or saved.
 * PRINTDATA alternatives use commandCount instead of consuming gameplay RNG.
 * Rain/HPH styling and LOOK_GIFT are outside this body-description slice.
 */
import type { CharaSlot, GameState } from "../state/game-state.js";
import { ABL_ID, CFLAG_ID, EQUIP_SLOT, FLAG_ID, PALAM_ID, PALAMLV, TALENT_ID, TCVAR_ID, TEQUIP_ID } from "../state/settlement.js";
import { bodyFillRate } from "../state/body-fill-rate.js";
import { wornPieceName, showLowerUnderwear } from "../state/clothing.js";
import { CLOTHING_CATALOG } from "../state/clothing-catalog.js";
import { substituteKojoCallNames, substituteKojoStateFormatters } from "../kojo/text-renderer.js";
import { isPlayerHInsertionActive } from "../state/h-interaction-state.js";

export interface HSceneProseSection {
  id: "upper" | "lower" | "v" | "a" | "belly";
  title: string;
  text: string;
}

// LOOK_AT_CLOTHNAME scans EQUIP in this order; SHOW_TOP has a different order.
const UPPER_LAYERS = ["上身衣服１", "上身衣服２", "和服", "連衣裙", "ボディースーツ", "レオタード", "上半身内衣２", "上半身内衣１"] as const;
const LOWER_LAYERS = ["裙子", "和服", "連衣裙", "裤子", "ボディースーツ", "レオタード", "下半身内衣２", "下半身内衣１"] as const;

function outerClothing(slot: CharaSlot, layers: typeof UPPER_LAYERS | typeof LOWER_LAYERS): string {
  for (const layer of layers) {
    const name = wornPieceName(slot, layer);
    if (name) return name;
  }
  return "";
}

/** LOOK_BELLY's 插入不可/尺寸差, used only to select authored prose. */
function insertionSize(state: Readonly<GameState>, target: CharaSlot): number {
  const m = state.master.state.TALENT;
  if (!((m[TALENT_ID.性別] ?? 0) & 2)) return 0;
  const shape = m[TALENT_ID.形状] ?? 0;
  const offset = shape === 1 ? -1 : shape === 2 ? -2 : shape === 6 ? 1 : shape === 5 || shape === 10 ? 2 : 0;
  const difference = ((m[TALENT_ID.体型] ?? 0) - (target.state.TALENT[TALENT_ID.体型] ?? 0)) * 2 + offset;
  return difference > 8 ? 3 : difference >= 5 ? 2 : difference >= 3 ? 1 : difference >= -2 ? 0 : difference >= -6 ? -1 : -2;
}

function bellyText(state: Readonly<GameState>, target: CharaSlot, inserted: boolean): string {
  const fill = bodyFillRate(target.state, 3);
  const pregnant = Boolean(target.state.TALENT[TALENT_ID.妊娠]);
  const days = target.state.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0;
  const parts: string[] = [];
  // LOOK_BELLY_2 uses total CURRENT residue, not cumulative EX volume.
  if (fill !== null && fill >= 250) parts.push(pregnant ? "肚子涨得仿佛要临盆了，精液像开了水龙头一样从股间喷涌而出" : "肚子仿佛要撑破了，精液像开了水龙头一样从股间喷涌而出");
  else if (fill !== null && fill >= 125) parts.push(pregnant ? "肚子涨得仿佛要临盆了，装不下的精液顺着大腿汩汩流下" : "肚子像孕妇一样隆起，装不下的精液顺着大腿汩汩流下");
  else if (fill !== null && fill >= 75) parts.push(pregnant ? "肚子涨得仿佛要临盆了" : "肚子像孕妇一样隆起");
  else if (fill !== null && fill >= 50) parts.push(pregnant ? "明显鼓胀起来的腹部与孕期完全对不上了" : "肚子胀鼓鼓的满满都是精液");
  else if (fill !== null && fill >= 35) parts.push(pregnant ? "大量的精液让腹部的尺寸肉眼可见的变大了一些" : "肚子因存储大量精液而鼓起");
  else if (fill !== null && fill >= 15) parts.push(pregnant ? "相当容量的精液将已经因妊娠而鼓起的小腹稍微抬起了一点" : "小腹因灌注的精液微微隆起");
  else if (days >= 80) parts.push("临近分娩的肚子仿佛要撑破了");
  else if (days >= 60) parts.push("孕育着生命的肚子高高的鼓起");
  else if (days >= 40) parts.push("肚子隆起变得明显了");
  else if (days >= 30) parts.push("肚子开始隆起");
  if (inserted) {
    const hasSubject = parts.length > 0;
    const size = insertionSize(state, target);
    const index = state.training?.commandCount ?? 0;
    if (size > 0) parts.push([
      `${hasSubject ? "" : "小腹"}被大肉棒顶出明显的凸起`,
      `${hasSubject ? "" : "小腹上"}清晰地浮现出肉棒的轮廓`,
      `${hasSubject ? "" : "小腹"}随着抽插被顶得一起一伏`,
    ][index % 3]!);
    else if (size === 0) parts.push([
      `${hasSubject ? "里面" : "肚子里"}被插入的${(state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2 ? "肉棒" : "假阴茎"}撑得满满当当`,
      `${hasSubject ? "" : "小腹"}随着抽插被顶得一起一伏`,
    ][index % 2]!);
    else parts.push("腹中清晰感受到小鸡鸡的火热");
    const shape = state.master.state.TALENT[TALENT_ID.形状] ?? 0;
    if (shape === 5) parts.push("、勾住肉褶的凸起使得从腹中抽出时刺激非常强…");
    else if (shape === 4) parts.push(`、肉棒的光芒${hasSubject ? "" : "在小腹上"}透视出了肉腔的轮廓…好色哦`);
    else parts.push("…");
  }
  return parts.join(" ");
}

/** Empty outside the active, same-room H owner, including closing transcripts. */
export function lookHSceneProse(state: Readonly<GameState>, target: number): HSceneProseSection[] {
  const session = state.training;
  const slot = state.charas[target];
  if (!session || session.target !== target || !slot || slot.location !== state.master.location) return [];
  const st = slot.state;
  const te = (id: number) => st.TEQUIP[id] ?? 0;
  const c = (id: number) => st.CFLAG[id] ?? 0;
  const tc = (id: number) => st.TCVAR[id] ?? 0;
  const p = (id: number) => st.PALAM[id] ?? 0;
  const v = isPlayerHInsertionActive(state, target, "v");
  const a = isPlayerHInsertionActive(state, target, "a");
  const vToy = te(TEQUIP_ID.振動棒) !== 0;
  const aToy = te(TEQUIP_ID.肛用振動棒) !== 0;
  const beads = te(TEQUIP_ID.後庭拉珠) !== 0;
  const aOther = te(TEQUIP_ID.浣腸) || te(TEQUIP_ID.拡張氣球) || te(TEQUIP_ID.肛門電極);
  const parts: HSceneProseSection[] = [];
  const render = (text: string) => substituteKojoCallNames(substituteKojoStateFormatters(text, { state, charaNum: target }), { state, charaNum: target }).trim();
  const add = (id: HSceneProseSection["id"], title: string, text: string) => {
    const rendered = render(text);
    if (rendered && !/%[^%]+%|\\@|\{[^}]+\}/.test(rendered)) parts.push({ id, title, text: rendered });
  };
  const upper: string[] = [];
  if (!te(TEQUIP_ID.上半身着衣状況)) {
    upper.push("赤裸的");
    if (p(PALAM_ID.欲情) >= PALAMLV[3]!) upper.push("%NIPPLE_DESCRIPTION(TARGET)%勃起着");
  } else {
    upper.push(outerClothing(slot, UPPER_LAYERS));
    if (te(TEQUIP_ID.上半身裸露状態) > 0) {
      const size = st.TALENT[TALENT_ID.胸围] ?? 0;
      upper.push(`%OPPAI_DESCRIPTION(TARGET,1)%${size === 2 ? "呼之欲出" : size === 1 ? "快要蹦出来了" : size === 0 ? "快要露出来了" : "若隐若现"}`);
      if (!(st.EQUIP[EQUIP_SLOT.ボディースーツ] ?? 0) && p(PALAM_ID.欲情) >= PALAMLV[5]!) upper.push("%NIPPLE_DESCRIPTION(TARGET)%勃起着");
    } else {
      const piece = st.EQUIP[EQUIP_SLOT.上半身内衣１] ?? 0;
      const thickness = CLOTHING_CATALOG["上半身内衣_はだけ不可"]?.[piece]?.布料厚度 ?? 0;
      if (!(st.EQUIP[EQUIP_SLOT.ボディースーツ] ?? 0) && p(PALAM_ID.欲情) >= PALAMLV[Math.min(4 + 2 * thickness, 15)]!) upper.push("即使隔着衣服也能看出%NIPPLE_DESCRIPTION(TARGET)%已经勃起了");
    }
  }
  const rub = te(TEQUIP_ID.揉胸);
  const suck = te(TEQUIP_ID.吸乳头);
  const clamp = te(TEQUIP_ID.乳頭夾);
  const tongue = (state.master.state.ABL[ABL_ID.舌] ?? 0) > 2;
  if (clamp && rub) upper.push("乳头夹吸附在%NIPPLE_DESCRIPTION(TARGET)%上%OPPAI_DESCRIPTION(TARGET)%也被%CALLNAME:MASTER%揉搓着");
  else if (suck && rub) upper.push(`%CALLNAME:MASTER%一边揉着%OPPAI_DESCRIPTION(TARGET)%一边${tongue ? "用舌头舔弄" : "吸吮"}%NIPPLE_DESCRIPTION(TARGET)%`);
  else if (clamp) upper.push("乳头夹吸附在%NIPPLE_DESCRIPTION(TARGET)%上");
  else if (te(TEQUIP_ID.搾乳機)) upper.push("搾乳机正在搾乳母乳");
  else if (suck) upper.push(`%CALLNAME:MASTER%${tongue ? "舔舐着" : "吮吸着"}%NIPPLE_DESCRIPTION(TARGET)%`);
  else if (rub) upper.push("%CALLNAME:MASTER%揉搓着%OPPAI_DESCRIPTION(TARGET)%");
  if (c(CFLAG_ID.口内精液) === 1) upper.push("精液垂挂在嘴角上");
  if (c(CFLAG_ID.脸上精液) === 1) upper.push("精液浇在了脸上");
  if (c(CFLAG_ID.手上精液) === 1) upper.push("手上沾满了精液");
  add("upper", "上半身", upper.join(" "));

  const lower: string[] = [];
  const lowerClothes = te(TEQUIP_ID.下半身着衣状況);
  const underwear = showLowerUnderwear(slot);
  const lubrication = p(PALAM_ID.潤滑);
  const fillV = bodyFillRate(st, 1);
  const fillA = bodyFillRate(st, 2);
  const fill = fillV === null || fillA === null ? null : Math.max(fillV, fillA);
  const thick = Boolean(state.master.state.TALENT[TALENT_ID.濃厚精液]);
  if (!lowerClothes || c(CFLAG_ID.没穿内裤)) {
    if (lowerClothes) lower.push(outerClothing(slot, LOWER_LAYERS));
    else if (underwear) lower.push(underwear);
    else lower.push("赤裸着");
  } else lower.push(outerClothing(slot, LOWER_LAYERS));
  if (lowerClothes && c(CFLAG_ID.没穿内裤)) {
    // LOOK_AT's clothed/no-panties arm uses the last command, not the
    // current UI selection, to decide whether the player is looking closely.
    if (session.lastCommandNo === 330) {
      if (lubrication >= PALAMLV[7]!) lower.push("下体洪水泛滥 爱液拉出淫丝❤");
      else if (lubrication >= PALAMLV[6]!) lower.push("腿上流的全是水");
      else if (lubrication >= PALAMLV[4]!) lower.push("爱液沿腿流下");
      else if (lubrication >= PALAMLV[2]!) lower.push("羞人的部分湿气满满");
      else if (lubrication >= PALAMLV[1]!) lower.push("羞人的部分濡湿了");
      if (fill !== null && fill >= 150) lower.push("可以听到精液喷出的噗嘟啪哒声❤");
      else if (fill !== null && fill >= 100) lower.push("挤出的精液拉着不透明的白色淫丝下落");
      else if (fill !== null && fill >= 70) lower.push("溢出的精液顺腿流下");
      else if (fill !== null && fill >= 40) lower.push("大腿上留有精液的痕迹");
      else if (fill !== null && fill >= 10) lower.push("羞人的部分挂着精液");
    } else if (fill !== null && fill >= 150) lower.push(`周围空气里弥漫着${thick ? "浓厚且独属于%CALLNAME:MASTER%白浊的气味" : "厚重的精液气味"} ❤`);
    else if (fill !== null && fill >= 100) lower.push(`喷出的${thick ? "浓厚白浊在脚边堆成了山" : "精液在脚边形成一滩水渍"}`);
    else if (fill !== null && fill >= 70) lower.push(`溢出的${thick ? "粘稠精液在大腿上拉出淫丝" : "精液垂落拉丝"}`);
    else if (fill !== null && fill >= 40) lower.push(`大腿上${thick ? "满是粘稠精液的痕迹" : "满是精液的痕迹"}`);
    else if (fill !== null && fill >= 10) lower.push(`羞人的部分${thick ? "残留着粘稠精液的痕迹" : "残留着精液的痕迹"}`);
  } else if (!lowerClothes && !underwear) {
    if (te(TEQUIP_ID.陰蒂夾)) lower.push("阴蒂夹吸在阴蒂上震动");
    if (te(TEQUIP_ID.飛機杯)) lower.push("飞机杯套在阴茎上震动");
    if (lubrication >= PALAMLV[2]! && !(c(CFLAG_ID.膣内射精) === 1 || v || vToy)) {
      if (lubrication >= PALAMLV[4]!) lower.push("爱液从私处滴落下来");
      else if (lubrication >= PALAMLV[3]!) lower.push("爱液流到了大腿上");
      else lower.push("私处被爱液打湿了");
    }
  } else if (underwear && (!lowerClothes || (!(lowerClothes & 4) && !v && !vToy && !a && !aToy && !beads))) {
    // Common fabric underwear arm (LOOK_AT:CASEELSE). Special rigid/adhesive
    // pieces have distinct source wording and must not select this arm.
    const special = /^(?:Ｃ字[袴裤]|創口貼|创口贴|御札|貞操帯|贞操带|陰唇環|阴唇环|陰蒂環|阴蒂环)$/;
    const rank = fill !== null && fill >= 150 || lubrication >= PALAMLV[7]! ? 4
      : fill !== null && fill >= 100 || lubrication >= PALAMLV[6]! ? 3
      : fill !== null && fill >= 70 || lubrication >= PALAMLV[4]! ? 2
      : fill !== null && fill >= 40 || lubrication >= PALAMLV[2]! ? 1
      : c(CFLAG_ID.膣内射精) === 1 || c(CFLAG_ID.肛門射精) === 1 || lubrication >= PALAMLV[1]! ? 0 : -1;
    if (rank >= 0 && /^(?:Ｃ字[袴裤]|創口貼|创口贴|御札)$/.test(underwear)) lower.push(`${underwear}${[
      "有被体液濡湿的痕迹", "完全湿透了", "开始剥落了、羞人的部分都要露出来了❤",
      "勉强在上面挂着、羞人的部分能看到一半了❤", "已经剥落了下来和黏液一起垂落、露出了羞人的部分❤",
    ][rank]}`);
    else if (rank >= 0 && /^(?:貞操帯|贞操带|陰唇環|阴唇环|陰蒂環|阴蒂环)$/.test(underwear)) {
      const belt = /^(?:貞操帯|贞操带)$/.test(underwear);
      lower.push(`${underwear}${["被体液打湿", "完全湿透了", "里面悬满了体液",
        belt ? "完全无法阻止溢出的精液❤" : "被溢出的体液搞到完全看不清❤",
        belt ? "的缝隙不断喷出体液❤" : "被溢出的体液彻底淹没❤"][rank]}`);
    } else if (!special.test(underwear) && rank >= 0) lower.push(`${underwear}${[
      "有被体液濡湿的痕迹", "上面染满了水渍", "明显完全湿透了、真诱人❤",
      "沉甸甸的不能再吸收体液了、羞人的部分要露出来了❤", "吸满了溢出的体液不断下坠、羞人的部分被看光光了❤",
    ][rank]}`);
  } else if (lowerClothes & 4) {
    if (lubrication >= PALAMLV[7]!) lower.push("简直是洪水泛滥❤");
    else if (lubrication >= PALAMLV[6]!) lower.push("腿上流的全是水");
    else if (lubrication >= PALAMLV[4]!) lower.push("连腿都被弄得湿答答的");
    else if (lubrication >= PALAMLV[2]!) lower.push("羞人的部分湿气满满");
    else if (lubrication >= PALAMLV[1]!) lower.push("羞人的部分染上了一滴滴的污渍");
  }
  if (underwear && lowerClothes && !(lowerClothes & 4) && (v || vToy || a || aToy || beads || aOther)) lower.push(`${underwear}为了爱爱而被错开`);
  if (c(CFLAG_ID.膣内射精) === 1 && !v && !vToy && (a || aToy || beads || aOther)) lower.push(lubrication >= PALAMLV[1]! ? "爱液混合着白浊流了出来" : "精液从蜜唇中流了出来");
  else if (c(CFLAG_ID.肛門射精) === 1 && !a && !aToy && !beads && !aOther && (v || vToy)) lower.push("精液从肛门里流了出来");
  add("lower", "下半身", lower.join(" "));

  const forced = tc(TCVAR_ID.强行) !== 0;
  const pose = te(TEQUIP_ID.体位);
  const position = (forced ? ["", "以正常位压制", "以后入式压着", "以强迫骑乘位", "紧紧搂着", "从身后挟住腰", "像对待飞机杯一样"]
    : ["", "以正常位", "以后入式", "以骑乘位", "以面对面坐位", "以背对坐位", "像对待飞机杯一样"])[pose] ?? "";
  const receipt = state.lastHSettlement;
  const fresh = receipt?.tick === state.time.tickValue && receipt.day === state.time.dayIndex
    && receipt.tick >= session.startedAtTick && receipt.session?.mode === session.mode
    && receipt.session?.target === target && !receipt.session.exited && receipt.commandNo === session.lastCommandNo;
  const dose = (site: "v" | "a") => fresh ? receipt.deposits?.filter((item) => item.subject === target && item.site === site).reduce((sum, item) => sum + item.amount, 0) : undefined;
  if (v || vToy) {
    let text = v ? `被%CALLNAME:MASTER%${position}插入着` : "被震动棒插入着";
    const sober = (!(state.flagStore[FLAG_ID.時間停止] ?? 0) || c(CFLAG_ID.時間停止行動)) && !c(CFLAG_ID.睡眠) && !c(CFLAG_ID.陪睡中) && !tc(TCVAR_ID.泥酔) && !c(CFLAG_ID.衰弱);
    const volume = dose("v");
    if (v && tc(TCVAR_ID.V被中出FLAG) && volume !== undefined && volume > 0) {
      text = c(CFLAG_ID.生理周期) === 7
        ? `被%CALLNAME:MASTER%${position}在危险日的蜜穴里灌注了${volume}mL${thick ? "浓厚" : ""}孕汁`
        : `被%CALLNAME:MASTER%${position}在蜜穴里注入了${volume}mL${thick ? "浓厚的" : ""}精液`;
    } else if (v && sober && st.TALENT[TALENT_ID.恋慕]) text = `与${position}插入的%CALLNAME:MASTER%深情交合❤`;
    if (te(TEQUIP_ID.子宮) === 1) text += " 下降着的子宫颤抖着❤子宫口在兴奋地吮吸";
    else if (te(TEQUIP_ID.子宮) === 2) text += " 下降着的子宫颤抖着❤等待着精液的浇灌";
    add("v", "膣内", text);
  }
  if (a || aToy || beads) {
    const volume = dose("a");
    add("a", "肛门", a && tc(TCVAR_ID.A被中出FLAG) && volume !== undefined && volume > 0
      ? `被注入了${volume}mL${thick ? "浓厚的" : ""}精液`
      : a ? `被%CALLNAME:MASTER%${position}插入着` : aToy ? "被肛用震动棒插入着" : "被后庭拉珠插入着");
  }
  const belly = bellyText(state, slot, v || a);
  if (belly) add("belly", c(CFLAG_ID.妊娠経過日数) >= 20 ? "孕肚" : "小腹", belly);
  return parts;
}
