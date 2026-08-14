/**
 * Faithful location gate for COMF440 `待つ`.
 *
 * Upstream `@COM_ABLE440` allows waiting only at:
 *   - a base map's entrance (`CHK_ENTRANCE(現在位置, MAIN_MAP)`), or
 *   - selected public field-map entrances/plazas when outside a base map.
 *
 * The modern narrowed scope currently has two built base maps:
 *   - 神社 entrance: P22 参道 (`ROOMSETTING_0.ERB:33`)
 *   - 人間之里 entrance: P201 人里的門 (`ROOMSETTING_2.ERB:33`)
 *
 * The bare map hubs (`神社`, `人間之里`) are modern UI aliases for those
 * entrances, so they are accepted as well.
 */

const BASE_ENTRANCES = new Set([
  "神社",
  "神社:参道",
  "人間之里",
  "人間之里:人里的門",
]);

const FIELD_WAIT_SPOTS = new Set([
  // Built field-scene aliases / upstream names.
  "霧の湖",
  "霧之湖",
  "迷いの竹林",
  "竹林入口",
  // Upstream @COM_ABLE440 public outside spots not yet fully built as maps.
  "地蔵小路",
  "広場",
  "森林的入口",
  "中有之道",
  "山麓樹海",
  "九天瀑布",
  "幻想風穴",
  "槐安通路",
]);

export function canWaitHere(location: string): boolean {
  return BASE_ENTRANCES.has(location) || FIELD_WAIT_SPOTS.has(location);
}
