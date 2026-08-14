import type { SceneAsset } from "../../../modernization/runtime/scene/index.js";
import type { CharaSlot, GameState } from "../../../modernization/runtime/state/index.js";
import { CFLAG_ID, getCharaCflag } from "../../../modernization/runtime/state/settlement.js";
import { lookSceneProse } from "../../../modernization/runtime/world/scene-prose.js";

const TERAKOYA_LOCATION = "人間之里:寺子屋";
const KEINE_CHARA_NUM = 67;
const TERAKOYA_ROOM_ID = 222;

function minuteOfDay(state: Readonly<GameState>): number {
  const raw = state.time.tickValue % 1440;
  return (raw + 1440) % 1440;
}

/**
 * Project a scene's authored intro into the current world state.
 *
 * Scene assets stay static; presence and work are runtime projections. This
 * keeps the寺子屋 text from claiming that 慧音 is teaching when she is away,
 * asleep, on a holiday, or already cleaning up after class.
 */
export function sceneForPresentation(
  scene: SceneAsset | null,
  state: Readonly<GameState>,
  present: ReadonlyArray<CharaSlot>,
): SceneAsset | null {
  if (!scene) return null;

  // `@LOOK_AT` 动态场景散文 — 除寺子屋外, intro 保持静态, 只叠加 ambientProse.
  const ambient = lookSceneProse(state, present, scene.location);

  if (scene.location !== TERAKOYA_LOCATION) {
    return { ...scene, ambientProse: ambient ?? undefined };
  }

  const keine = present.find((slot) => slot.charaNum === KEINE_CHARA_NUM);
  let intro: string;
  if (!keine) {
    intro = "教室里摆着整齐的课桌，墙上还留着孩子们的习字。";
  } else {
    const minute = minuteOfDay(state);
    const action = getCharaCflag(state, keine.charaNum, CFLAG_ID.行动);
    const workRoom = getCharaCflag(state, keine.charaNum, CFLAG_ID.职场);
    const workingAtTerakoya = action === 5 && workRoom === TERAKOYA_ROOM_ID;

    if (workingAtTerakoya && minute >= 14 * 60) {
      intro = "授课已经结束，慧音先生正整理课桌和教具。";
    } else if (workingAtTerakoya && minute >= 12 * 60) {
      intro = "午休时间，慧音先生暂时放下教鞭，教室里只听见窗外的风声。";
    } else if (workingAtTerakoya && minute >= 8 * 60) {
      intro = "慧音先生正在授课，教室里传来朗朗的读书声。";
    } else {
      intro = "教室里摆着整齐的课桌，墙上还留着孩子们的习字。";
    }
  }

  return { ...scene, intro, ambientProse: ambient ?? undefined };
}
