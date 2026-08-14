import { GENERATED_MAP_ID_BY_PREFIX } from "../../../modernization/runtime/world/generated-map-prefixes.js";

/**
 * P2-c — region metadata for the global COLOREDFIELD overview map.
 *
 * The 12 MAPID regions (PLACE_ERH.ERH:3-14) + their display names
 * (PLACE_拠点別分岐.ERB @GET_MAPNAME full-name branch). The COLOREDFIELD AA
 * draws numbered cells 00-11 for these regions; clicking a built one issues
 * its cross-map move commandNo. Unbuilt regions render but are disabled.
 *
 * mapIds 0..10 are now wired (matching the `gen-remaining-map-scenes.mjs`
 * 2026-07-09 batch which produced the `modernization/scenes/{forest,meikai,
 * sanroku,sanchou,chitei,moon}-*` assets and their 5xxxx-10xxx room tables);
 * commandNo assignments match the cross-map `move-to-*` handlers:
 *   0  博麗神社        → 10701 (move-to-shrine)   ✅ built
 *   1  命蓮寺          → 10704 (move-to-reiten)   ✅ built
 *   2  人間の里        → 10702 (move-to-village)  ✅ built
 *   3  霧之湖～紅魔館  → 10705 (move-to-koumakan) ✅ built
 *   4  迷途竹林        → 10706 (move-to-tikurin)  ✅ built
 *   5  魔法之森        → 10905 (move-to-forest)   ✅ built
 *   6  三途之川～冥界  → 10906 (move-to-meikai)   ✅ built
 *   7  妖怪之山(山麓)  → 10907 (move-to-sanroku)  ✅ built
 *   8  妖怪之山(山頂)  → 10908 (move-to-sanchou)  ✅ built
 *   9  地底            → 10909 (move-to-chitei)   ✅ built
 *  10  夢之世界～月    → 10910 (move-to-moon)     ✅ built
 *  11  魔界            — not built (intentionally deferred, no scenes)
 */
export interface Region {
  /** MAPID 0-11 (PLACE_ERH.ERH). */
  mapId: number;
  /** Full display name (GET_MAPNAME full-name branch). */
  label: string;
  /** Cross-map move commandNo when built; undefined when unbuilt. */
  commandNo?: number;
  /** Whether a scene/handler exists for this region. */
  built: boolean;
}

export const REGIONS: readonly Region[] = [
  { mapId: 0, label: "博麗神社", commandNo: 10701, built: true },
  { mapId: 1, label: "命蓮寺", commandNo: 10704, built: true },
  { mapId: 2, label: "人間の里", commandNo: 10702, built: true },
  { mapId: 3, label: "霧之湖～紅魔館", commandNo: 10705, built: true },
  { mapId: 4, label: "迷途竹林", commandNo: 10706, built: true },
  { mapId: 5, label: "魔法之森", commandNo: 10905, built: true },
  { mapId: 6, label: "三途之川～冥界", commandNo: 10906, built: true },
  { mapId: 7, label: "妖怪之山(山麓)", commandNo: 10907, built: true },
  { mapId: 8, label: "妖怪之山(山頂)", commandNo: 10908, built: true },
  { mapId: 9, label: "地底", commandNo: 10909, built: true },
  { mapId: 10, label: "夢之世界～月", commandNo: 10910, built: true },
  { mapId: 11, label: "魔界", built: false },
];

/** Map MAPID → region (lookup for the COLOREDFIELD numbered cells). */
const REGION_BY_MAPID = new Map(REGIONS.map((r) => [r.mapId, r]));

/** The current region's MAPID for a location string, or null when not in a
 *  built region (the field map highlights + disables "current"). */
export function currentMapIdForLocation(location: string): number | null {
  const root = location.split(":")[0]!;
  if (root === "神社") return 0;
  if (root === "命蓮寺") return 1;
  if (root === "霊廟") return 1;
  if (root === "人間之里") return 2;
  if (root === "紅魔館") return 3;
  if (root === "廃洋館") return 3;
  if (root === "霧之湖") return 3;
  if (root === "永遠亭") return 4;
  if (root === "夢幻館") return 4;
  if (root === "迷途竹林") return 4;
  return GENERATED_MAP_ID_BY_PREFIX[root] ?? null;
}

export function regionByMapId(mapId: number): Region | undefined {
  return REGION_BY_MAPID.get(mapId);
}
