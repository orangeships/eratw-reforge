/**
 * 生理周期 (estrus cycle) — 判別。
 *
 * `estrusCategory` 忠实 `イベント関連/妊娠関連/CYCLE.ERB:34-59 @ESTRUS_CATEGORY`：
 *
 *     CHECK_DAY = (CFLAG:生理周期 + ADD_DAY + 10) % 10   (0 → 10)
 *     1-2 → 安全日 / 6 → 危险日前日 / 7 → 危险日 / 8 → 排卵 / else → 非危险日
 *
 * 推进逻辑挂在 `day-cycle.ts` 的 `estrus-cycle` 晨间阶段（BEFORETRAIN:135-157）。
 * `TCVAR:強制排卵`（"排卵诱发剂生效中"）未建模 → 默认 0，不返回该分支。
 */

/** 生理周期 → 危険日/排卵/安全日 判別。`addDay`=参照日偏移（0=今天，忠实 ESTRUS_CATEGORY 的负日取模）。 */
export function estrusCategory(cycle: number | undefined, addDay = 0): string {
  const add = addDay < 0 ? -(Math.abs(addDay) % 10) : addDay;
  let checkDay = (((cycle ?? 0) + add + 10) % 10);
  if (checkDay === 0) checkDay = 10;
  if (checkDay <= 2) return "安全日";
  if (checkDay === 6) return "危险日前日";
  if (checkDay === 7) return "危险日";
  if (checkDay === 8) return "排卵";
  return "非危险日";
}
