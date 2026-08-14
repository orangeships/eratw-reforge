/** Upstream `出掛け先への所要時間.ERB` base matrix for MAPID 0-10. */
const REGION_TRAVEL_MINUTES: readonly (readonly number[])[] = [
  [0, 30, 20, 50, 40, 50, 70, 40, 60, 20, 120],
  [30, 0, 10, 40, 20, 40, 60, 70, 90, 50, 110],
  [20, 10, 0, 30, 20, 30, 50, 60, 80, 40, 100],
  [50, 40, 30, 0, 50, 30, 50, 30, 50, 50, 70],
  [40, 20, 20, 50, 0, 50, 70, 80, 100, 60, 120],
  [50, 40, 30, 30, 50, 0, 20, 60, 80, 70, 100],
  [70, 60, 50, 50, 70, 20, 0, 30, 50, 50, 70],
  [80, 70, 60, 30, 80, 60, 30, 0, 20, 20, 40],
  [100, 90, 80, 50, 100, 80, 50, 20, 0, 40, 20],
  [20, 50, 40, 50, 60, 70, 50, 20, 40, 0, 60],
  [120, 110, 100, 70, 120, 100, 70, 40, 20, 60, 0],
] as const;

export function dateTravelMinutes(fromMapId: number, toMapId: number): number | null {
  if (!Number.isInteger(fromMapId) || !Number.isInteger(toMapId) || fromMapId < 0 || fromMapId > 10 || toMapId < 0 || toMapId > 10) return null;
  return REGION_TRAVEL_MINUTES[fromMapId]![toMapId]!;
}
