/**
 * `COMF496 ラジオをいじる` (fiddle with the radio), as a `ComfDef`.
 *
 * Ports the frame of `@COM496`
 * (`ERB/コマンド関連/COMF/日常系/COMF496 ラジオをいじる.ERB`):
 *
 *   PRINTW 摆弄了一下收音机的旋钮
 *   …（按 ABL:教養 / TIME:0 时段播报 天気予報 / ニュース / 気象通報）…
 *   TIME += 5
 *
 * S7 wires the weather-warning/forecast subsystem into the broadcast body.
 * What remains faithful and self-contained:
 *   - 旋钮 flavor + the `ABL:教養 < 2` "听不懂" gate (ERB: gibberish + 「要提升
 *     教养才能听懂」, `RETURN 1` early) vs ≥2 generic "listened to the broadcast".
 *   - `TIME += 5`.
 *
 * Master-centric, no SOURCE, no DOWNBASE, no outcome roll.
 *
 * **DEFERRED:** 雷ノイズ flavor (`GET_*_THUNDERSTORM`),
 * 自机立绘 face lines. `@COM_ABLE496` gates (`TFLAG:100` shop, `FLAG:70`
 * 時間停止, `CFLAG:诶嘿嘿/恶作剧/陪睡中`) are catalog-layer, deferred like 495.
 */
import type { HandlerEntry } from "../../types.js";
import { ABL_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { checkWeatherListInfo } from "../../../weather/list-info.js";

export const comf496Def: ComfDef = {
  commandNo: 496,
  label: "ラジオをいじる",

  requiresTarget: false,

  // No outcome roll — pin to 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5, // ERB: TIME += 5

  // No SOURCE, no DOWNBASE.
  buildSources: () => ({}),

  narration: (c) => {
    const kyo = c.ctx.state.master.state.ABL[ABL_ID.教養] ?? 0;
    // ERB: ABL:教養 < 2 → 尽是听不懂的专业词汇 (RETURN 1 early).
    if (kyo < 2) {
      return "%CALLNAME:MASTER%摆弄起收音机的旋钮，里面尽是些晦涩生僻的专业词汇，听得人摸不着头脑——看来得好好提升一下教养才行。";
    }
    const info = checkWeatherListInfo(c.ctx.state);
    return [
      "%CALLNAME:MASTER%摆弄起收音机的旋钮，断断续续地听到天气播报。",
      ...info.lines,
    ].join("\n");
  },
};

export const comf496HandlerEntry: HandlerEntry = makeComfHandler(comf496Def);
