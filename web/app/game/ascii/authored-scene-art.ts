import livingRoom from "../../../../modernization/assets/scenes/shrine-ima/background.svg?url";
import approach from "../../../../modernization/assets/scenes/shrine-sando/background.svg?url";
import animatedApproach from "../../../../modernization/assets/scenes/shrine-sando/background.motion.svg?url";
import approachMotion from "../../../../modernization/assets/scenes/shrine-sando/background.motion.json";
import storehouse from "../../../../modernization/assets/scenes/shrine-storehouse/background.svg?url";
import mainHall from "../../../../modernization/assets/scenes/shrine-hondou/background.svg?url";
import animatedMainHall from "../../../../modernization/assets/scenes/shrine-hondou/background.motion.svg?url";
import mainHallMotion from "../../../../modernization/assets/scenes/shrine-hondou/background.motion.json";
import corridor from "../../../../modernization/assets/scenes/shrine-roka/background.svg?url";
import animatedCorridor from "../../../../modernization/assets/scenes/shrine-roka/background.motion.svg?url";
import corridorMotion from "../../../../modernization/assets/scenes/shrine-roka/background.motion.json";
import garden from "../../../../modernization/assets/scenes/shrine-niwa/background.svg?url";
import animatedGarden from "../../../../modernization/assets/scenes/shrine-niwa/background.motion.svg?url";
import gardenMotion from "../../../../modernization/assets/scenes/shrine-niwa/background.motion.json";
import forest from "../../../../modernization/assets/scenes/shrine-forest/background.svg?url";
import animatedForest from "../../../../modernization/assets/scenes/shrine-forest/background.motion.svg?url";
import forestMotion from "../../../../modernization/assets/scenes/shrine-forest/background.motion.json";
import reimuRoom from "../../../../modernization/assets/scenes/shrine-reimu-room/background.svg?url";
import onsen from "../../../../modernization/assets/scenes/shrine-onsen/background.svg?url";
import animatedOnsen from "../../../../modernization/assets/scenes/shrine-onsen/background.motion.svg?url";
import onsenMotion from "../../../../modernization/assets/scenes/shrine-onsen/background.motion.json";
import type { NativeSceneMotion } from "./native-scene-motion.js";
import eienteiGate from "../../../../modernization/assets/scenes/tikurin-eientei-gate/background.svg?url";
import animatedEienteiGate from "../../../../modernization/assets/scenes/tikurin-eientei-gate/background.motion.svg?url";
import eienteiGateMotion from "../../../../modernization/assets/scenes/tikurin-eientei-gate/background.motion.json";

/** Vite packages the exact colored glyph art for both Browser and Tauri.
 * These SVGs contain ASCII text, never a raster-to-ASCII reconstruction.
 */
export function authoredSceneArtwork(sceneId: string, animated = false): string | undefined {
  switch (sceneId) {
    case "tikurin-eientei-gate": return animated ? animatedEienteiGate : eienteiGate;
    case "shrine-onsen": return animated ? animatedOnsen : onsen;
    case "shrine-niwa": return animated ? animatedGarden : garden;
    case "shrine-forest": return animated ? animatedForest : forest;
    case "shrine-reimu-room": return reimuRoom;
    case "shrine-roka": return animated ? animatedCorridor : corridor;
    case "shrine-ima": return livingRoom;
    case "shrine-sando": return animated ? animatedApproach : approach;
    case "shrine-storehouse": return storehouse;
    case "shrine-hondou": return animated ? animatedMainHall : mainHall;
    default: return undefined;
  }
}

export function authoredSceneMotion(sceneId: string): NativeSceneMotion | undefined {
  switch (sceneId) {
    case "tikurin-eientei-gate": return eienteiGateMotion as unknown as NativeSceneMotion;
    case "shrine-onsen": return onsenMotion as unknown as NativeSceneMotion;
    case "shrine-niwa": return gardenMotion as unknown as NativeSceneMotion;
    case "shrine-forest": return forestMotion as unknown as NativeSceneMotion;
    case "shrine-roka": return corridorMotion as unknown as NativeSceneMotion;
    case "shrine-sando": return approachMotion as unknown as NativeSceneMotion;
    case "shrine-hondou": return mainHallMotion as unknown as NativeSceneMotion;
    default: return undefined;
  }
}
