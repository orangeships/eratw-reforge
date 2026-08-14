/**
 * Phase 4.5I — GameStatusBar (top zone, era colorbar style).
 *
 * Replaces the plain key/value StatusPanel in the game's top zone with
 * the era look: a date / money / location line + a dense row of
 * color-coded block bars (体力 / 気力 / TSP / 精力), per
 * `era-ui-reference.md` §5 (PRINT_COLORBAR / BASE_BAR).
 *
 * The day and location are read from the real GameState. The bar values
 * and money are placeholder samples for the prototype — the actual
 * 体力/気力 live in the per-chara numeric namespaces, which this UI layer
 * may NOT reference by name (forbidden-names guard); Phase 5+ surfaces
 * real values through a namespace-free accessor.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getNamedStat,
  getRelationStat,
  getFortune,
  getPalamStat,
  getCleanlinessLabel,
  getBattleAbilityDisplay,
  getHudActionHints,
  getHudWorkInfo,
  getHBodyStats,
  palamLvBar,
  NAMED_STAT_KEYS,
  PALAM_STAT_KEYS,
  weekdayName,
  seasonOf,
  dateOf,
  monthName,
  isTimeStopped,
} from "../../../modernization/runtime";
import { selectPresentCharas } from "../../../modernization/runtime/scene/presence.js";
import { nemuke } from "../../../modernization/runtime/state/nemuke.js";
import { situationTags, type SituationTag } from "../../../modernization/runtime/state/situation.js";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import {
  formatTemperature,
  temperatureColor,
  currentTimezone,
  timezoneName,
} from "../../../modernization/runtime/state/weather.js";
import { getCurrentTemperature } from "../../../modernization/runtime/weather/temperature.js";
import {
  currentRegionWeather,
  formatRegionRainbow,
  formatRegionWeather,
  formatRegionWind,
} from "../../../modernization/runtime/weather/region-override.js";
import { weatherStatusShow } from "../../../modernization/runtime/weather/display.js";
import { itemCount } from "../../../modernization/runtime/state/items.js";
import { FLAG_ID } from "../../../modernization/runtime/state/settlement.js";
import { ITEM_FOLDING_UMBRELLA } from "../../../modernization/runtime/weather/umbrella.js";

/** Color tone per named stat (matches era BARCOLORSET conventions). */
const BAR_TONE: Record<string, "red" | "green" | "cyan" | "yellow" | "purple"> = {
  体力: "red",
  気力: "green",
  酒: "purple",
  TSP: "cyan",
  精力: "yellow",
};

export interface GameStatusBarProps {
  state: GameState;
  /** The focused interaction target (charaNum). When present + > 0, the bar
   *  also shows that chara's 体力/気力 (the original shows both via
   *  PRINT_COLORBAR). */
  target?: number;
  /** Release 時間停止 (issue COM999). The time-stop control lives here at the
   *  top of the screen, beside the TSP bar — NOT in the Act_COM / Ex_COM
   *  command rows. */
  onReleaseTimeStop?: () => void;
  /** Enter 時間停止 (issue COM355). The button sits to the RIGHT of the TSP
   *  bar; while time is stopped it swaps to the 解除时停 (release) button.
   *  The resolver still runs @COM_ABLE355 gates (TSP>0, 気力>0, etc.). */
  onTimeStop?: () => void;
  /** Open the full 能力显示 (character-info) dashboard for a chara. The entry
   *  button sits to the RIGHT of the 能力等级 (Palam) levels in the 属性 panel,
   *  matching eraTW's [能力显示] command. */
  onOpenCharaInfo?: (charaNum: number) => void;
}

/** Format a location string for display.
 *  "神社:参道" → "博麗神社 · 参道"
 *  "人間之里" → "人間之里" */
function fmtLocation(loc: string): string {
  const idx = loc.indexOf(":");
  if (idx < 0) return loc;
  const area = loc.slice(0, idx);
  const room = loc.slice(idx + 1);
  const areaNames: Record<string, string> = { 神社: "博麗神社" };
  return `${areaNames[area] ?? area} · ${room}`;
}

/** Render one chara's 体力/気力/TSP/精力 bar row, labelled by who it is. */
function StatBars(props: {
  who: string;
  state: GameState["master"]["state"];
  keys: ReadonlyArray<string>;
  /** Optional testid suffix so two bar rows for the same chara (e.g. the
   *  always-on top TSP bar + the full Status dropdown row) don't collide. */
  testidSuffix?: string;
}) {
  const testid = `status-bars-${props.who}${props.testidSuffix ? `-${props.testidSuffix}` : ""}`;
  return (
    <div className="status-bar__bars" data-testid={testid}>
      {props.testidSuffix ? null : <span className="status-bar__who">{props.who}</span>}
      {props.keys.map((label) => {
        const { value, max } = getNamedStat(props.state, label);
        const fill = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
        return (
          <span key={label} className={`bar bar--${BAR_TONE[label]}`}>
            <span className="bar__label">{label}</span>
            <span
              className="bar__track"
              role="progressbar"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={Math.max(0, max)}
              aria-valuenow={Math.max(0, value)}
            >
              <span className="bar__fill" style={{ width: `${fill}%` }} />
            </span>
            <span className="bar__num">
              {value}/{max}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Parity QA P-31 — the focused target's relational stats (好感度/信頼度 as
 *  counters, 情緒/理性 as ★ ratings out of their MAXBASE cap). eraTW shows
 *  these on the status line; the data is already modeled, this just surfaces it. */
function RelationStats(props: { who: string; state: GameState["master"]["state"] }) {
  const favor = getRelationStat(props.state, "好感度");
  const trust = getRelationStat(props.state, "信頼度");
  const joucho = getRelationStat(props.state, "情緒");
  const risei = getRelationStat(props.state, "理性");
  const fury = getRelationStat(props.state, "憤怒");
  // A 0..5 rating from a value/max pair, faithful to @INFO_EMOTION's gauge
  // model: 理性 (rationality) is FULL when calm (value == cap), while 情緒
  // (agitation) and 憤怒 (anger) sit EMPTY when calm and fill toward the cap.
  // Render each glyph as its own span so the filled portions can carry the
  // intended color without recoloring the whole relation line.
  const rate = (
    s: { value: number; max: number },
    filled: string,
    empty: string,
    tone: "risei" | "joucho" | "fury",
  ): ReactNode => {
    if (s.max <= 0) return "—";
    const n = Math.max(0, Math.min(5, Math.round((s.value / s.max) * 5)));
    return (
      <span className={`status-bar__gauge status-bar__gauge--${tone}`} aria-label={`${n}/5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={
              "status-bar__gauge-symbol" +
              (i < n ? " status-bar__gauge-symbol--filled" : " status-bar__gauge-symbol--empty")
            }
            aria-hidden="true"
          >
            {i < n ? filled : empty}
          </span>
        ))}
      </span>
    );
  };
  return (
    <div className="status-bar__relation" data-testid="status-relation">
      <span className="status-bar__who">{props.who}</span>
      <span className="status-bar__rel">好感度 {favor.value}</span>
      <span className="status-bar__rel">信頼度 {trust.value}</span>
      <span className="status-bar__rel" data-testid="rel-risei">理性 {rate(risei, "★", "☆", "risei")}</span>
      <span className="status-bar__rel" data-testid="rel-joucho">情緒 {rate(joucho, "♥", "♡", "joucho")}</span>
      <span className="status-bar__rel status-bar__rel--fury" data-testid="rel-fury">憤怒 {rate(fury, "!", "!", "fury")}</span>
    </div>
  );
}

/** H 阶段 per-target 身体状态 — 对齐原版 `@INFO_STATUS` 的精液/充填/生理行
 *  (INFO.ERB:2138-2141 膣内/肛内精液量, CYCLE.ERB 生理判別, Look.ERB 充填率)。
 *  只读 `getHBodyStats` 返回的 namespace-free 对象，不直接碰命名空间。 */
const H_CHIBURI_KEYS = ["Ｃ", "Ｖ", "Ａ", "Ｂ", "Ｍ"] as const;

function HBodyStats(props: { who: string; state: GameState["master"]["state"] }) {
  const s = getHBodyStats(props.state);
  const semenLines: string[] = [];
  if (s.vaginalSemen > 0) semenLines.push(`膣内精液量:${s.vaginalSemen}`);
  if (s.analSemen > 0) semenLines.push(`肛内精液量:${s.analSemen}`);
  if (s.uterineSemen > 0) semenLines.push(`子宮精液量:${s.uterineSemen}`);
  const fillLines: string[] = [];
  if (s.fillV !== null) fillLines.push(`V ${s.fillV}%`);
  if (s.fillA !== null) fillLines.push(`A ${s.fillA}%`);
  const chiburiLines = H_CHIBURI_KEYS
    .filter((k) => s.chiburi[k] > 0)
    .map((k) => `${k}${s.chiburi[k]}`);
  return (
    <div className="status-bar__hbody" data-testid="status-hbody">
      <span className="status-bar__who">{props.who}</span>
      <span className="status-bar__hbody-line" data-testid="hbody-estrus">
        生理：{s.estrusLabel}
      </span>
      {semenLines.length > 0 && (
        <span className="status-bar__hbody-line" data-testid="hbody-semen">
          {semenLines.join("　")}
        </span>
      )}
      {fillLines.length > 0 && (
        <span className="status-bar__hbody-line" data-testid="hbody-fill">
          充填率：{fillLines.join("　")}
        </span>
      )}
      <span className="status-bar__hbody-line" data-testid="hbody-erection">
        勃起：{s.erectionLabel}（{s.erection}）
      </span>
      {s.hasPenis && (
        <span className="status-bar__hbody-line" data-testid="hbody-ejaculate">
          射精：{s.ejaculate}/{s.ejaculateMax}
          {s.ejaculateMax > 0 && s.ejaculate >= s.ejaculateMax ? " [要去了！]" : ""}
        </span>
      )}
      <span className="status-bar__hbody-line" data-testid="hbody-frustration">
        欲求：{Math.trunc(s.frustration / 10)}%
      </span>
      {s.afterglow > 0 && (
        <span className="status-bar__hbody-line" data-testid="hbody-afterglow">
          高潮余韵：{s.afterglow}
        </span>
      )}
      {chiburiLines.length > 0 && (
        <span className="status-bar__hbody-line" data-testid="hbody-chiburi">
          寸止：{chiburiLines.join("　")}
        </span>
      )}
    </div>
  );
}

/** Param section — 欲情 / 恭順 etc. only, faithful to eraTW's
 *  `SHOW_INFO_PALAM` (rendered under INFO_STATUS, only when TARGET is
 *  set). The ~20 ABL 能力 gauges are NOT shown here — eraTW keeps them
 *  on a separate 能力 display screen, not on the main status bar. */
function ActionHints(props: { hints: ReturnType<typeof getHudActionHints> }) {
  const items: string[] = [];
  if (props.hints.canEatMeal) items.push("可吃饭");
  if (props.hints.canEatDessert) items.push("可吃点心");
  if (props.hints.timeStop === "active") items.push("时间停止中");
  else if (props.hints.timeStop === "available") items.push("时间停止可");
  if (props.hints.hypnosisAvailable) items.push("催眠发动可");
  if (items.length === 0) return null;
  return (
    <span className="status-bar__hints" data-testid="status-bar-hints">
      {items.map((item) => (
        <span key={item} className="status-bar__hint">
          &lt;{item}&gt;
        </span>
      ))}
    </span>
  );
}

function WorkInfoLine(props: {
  targetName: string;
  work: ReturnType<typeof getHudWorkInfo>;
  battleAbility: string;
}) {
  const workText = props.work
    ? [props.work.kind, props.work.day, props.work.hours].filter(Boolean).join(" ")
    : "—";
  return (
    <div className="status-bar__workline" data-testid="status-bar-workline">
      <span className="status-bar__work-target">{props.targetName}</span>
      <span>
        工作情报：
        {workText}
      </span>
      <span>工作地点：{props.work?.place ?? "—"}</span>
      <span>
        战斗能力：<strong>{props.battleAbility}</strong>
      </span>
      {props.work?.active && <span className="status-bar__work-active">工作中</span>}
    </div>
  );
}

function PalamPanel(props: {
  state: GameState["master"]["state"];
  charaNum?: number;
  onOpenCharaInfo?: (charaNum: number) => void;
}) {
  return (
    <div className="status-bar__palam" data-testid="status-palam">
      <div className="status-bar__palam-head">
        <span className="status-bar__palam-title">▼[Palam] 能力等级</span>
        {props.charaNum !== undefined && props.onOpenCharaInfo && (
          <button
            type="button"
            className="status-bar__ability-btn"
            data-testid="status-bar-ability-show"
            title="打开该角色的完整能力情报看板"
            onClick={() => props.onOpenCharaInfo?.(props.charaNum!)}
          >
            [能力显示]
          </button>
        )}
      </div>
      <div className="status-bar__palam-grid">
        {PALAM_STAT_KEYS.map((label) => {
          const value = getPalamStat(props.state, label);
          const { level, fill01 } = palamLvBar(value);
          return (
            <span key={label} className="status-bar__palam-item">
              <span className="status-bar__palam-label">{label}Lv</span>
              <span className="status-bar__palam-level">{level}</span>
              <span className="status-bar__palam-track" aria-label={`${label}Lv ${level}`}>
                <span
                  className="status-bar__palam-fill"
                  style={{ width: `${Math.round(fill01 * 100)}%` }}
                />
              </span>
              <span className="status-bar__palam-value">{value}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 困意 (sleepiness) indicator — surfaces `NEMUKE()` so the player can tell
 *  when 就寝 (402) becomes available. The 402 gate requires NEMUKE≥720 and
 *  being in the master's 私室; the command stays hidden from the grid until
 *  both pass, so without this cue the player has no way to discover when/where
 *  to sleep. eraTW gates: 402 就寝 NEMUKE≥720, 417 昼寝 180≤NEMUKE≤720, 403 休憩
 *  NEMUKE<960. 時間停止 suspends sleepiness (no time passes), so hide it then. */
function Sleepiness(props: { state: GameState }) {
  if (isTimeStopped(props.state)) return null;
  const n = nemuke(props.state);
  const home = props.state.homeLocation ?? "";
  const atHome = props.state.master.location === home;
  let label: string;
  if (n < 180) label = "低";
  else if (n < 720) label = "中";
  else label = atHome ? "高（可就寝）" : "高（回自室可就寝）";
  return (
    <div className="status-bar__sleepiness" data-testid="status-bar-sleepiness">
      困意：{label}
    </div>
  );
}

/** CSS class per situation-tag kind (`@INFO_SITUATION`). */
const SIT_TAG_KIND_CLASS: Record<SituationTag["kind"], string> = {
  tease: "sit-tag--tease",
  lock: "sit-tag--lock",
  date: "sit-tag--date",
  swim: "sit-tag--swim",
  sleepy: "sit-tag--sleepy",
  coffee: "sit-tag--coffee",
};

/** Sleepy-tag tone overrides the generic sleepy class color. */
const SIT_TAG_TONE_CLASS: Record<string, string> = {
  orange: "sit-tag--orange",
  yellow: "sit-tag--yellow",
  "pale-yellow": "sit-tag--pale-yellow",
  red: "sit-tag--red",
};

/** `@INFO_SITUATION` — the master's situation tag row (挑逗/锁门/约会/游泳/睡意/清醒剂). */
function SituationTags(props: { state: GameState }) {
  const tags = situationTags(props.state);
  if (tags.length === 0) return null;
  return (
    <div className="status-bar__situation" data-testid="status-situation">
      {tags.map((tag, i) => (
        <span
          key={`${tag.kind}-${i}`}
          className={
            "status-bar__sit-tag " +
            SIT_TAG_KIND_CLASS[tag.kind] +
            (tag.tone ? ` ${SIT_TAG_TONE_CLASS[tag.tone]}` : "")
          }
          data-testid={`sit-tag-${tag.kind}`}
        >
          {tag.text}
        </span>
      ))}
    </div>
  );
}

export default function GameStatusBar(props: GameStatusBarProps) {
  const { time, master, charas, money } = props.state;
  const day = time.dayIndex + 1;
  // Parity QA P-2: real eraTW calendar — weekday `(dayIndex+1)%7`
  // (日/月/火/水/木/金/土) + the (season-month, date) pair off `time`
  // (春之月/夏之月/…, date 1-31). Was an `(dayIndex+3)%7` mock anchor.
  const weekday = weekdayName(time.dayIndex);
  const month = monthName(seasonOf(time));
  const date = dateOf(time);

  // Parity QA P-31 + Weather S6 — weather + current-region effects after
  // `qol_SET_REGION_WEATHER` (三途=雾/雨, 天界=晴, 魔界=强风, etc.).
  const regionWeather = currentRegionWeather(props.state);
  const weatherInfo = weatherStatusShow(props.state);
  const weather = formatRegionWeather(regionWeather);
  const wind = formatRegionWind(regionWeather);
  const rainbow = formatRegionRainbow(regionWeather);
  const temp01 = getCurrentTemperature(props.state);
  const umbrellaDurability = props.state.flagStore[FLAG_ID.折畳伞耐久度] ?? 0;
  const umbrellaOwned = itemCount(props.state, ITEM_FOLDING_UMBRELLA) > 0;
  const umbrellaText = umbrellaOwned
    ? `伞:${Math.max(0, 100 - Math.floor(umbrellaDurability / 100))}%`
    : "伞:未持有";

  // Parity QA F-1e — 時間帯 name + real minutes. eraTW shows `(卯时三点-晓-)`
  // via GET_CLASSICAL_HOUR (deferred — see weather.ts); we surface the coarser
  // 現在時間帯 8-division label (未明/明け方/朝/…) + HH:MM (was HH:00 only).
  const tzName = timezoneName(currentTimezone(time.hourOfDay));
  const minutes = time.tickValue % 60;

  // Parity QA F-1b — 清洁度 label (DRAW_MAP.ERB:232-247) for the master's
  // current room. Reads GameState.yogore via the namespace-free accessor.
  const cleanliness = master.location
    ? getCleanlinessLabel(props.state, master.location)
    : "";

  // Parity QA F-1b-2 — 今日运势 shell. 角色标志 今日の運勢 (378) data layer is NOT
  // wired yet (no writer — see settlement.ts:165); reads 0 until that lands.
  // eraTW's real fortune is always ≥1, so 0 = "unseeded" → placeholder.
  const fortune = getFortune(master.state);

  // The focused target (if any present chara). The original status panel shows
  // both 主人公 and the current TARGET's 体力/気力; we mirror that. The target
  // gets the two core bars (体力/気力) — TSP/精力 are master-centric.
  const targetSlot =
    props.target !== undefined && props.target > 0 ? charas[props.target] : undefined;
  const datePartner = props.state.dateSession ? charas[props.state.dateSession.partner] : undefined;

  // Present NPCs at the master's room — the mock's `[先代] [灵梦]` line.
  const present = selectPresentCharas(props.state, master.location).filter(
    (c) => c.charaNum > 0,
  );

  // Look (clothing + 立绘) lives in the middle scene layer. 状态 / 属性 are
  // hover menus: both rest collapsed, entering either header opens that one,
  // and leaving the whole header + floating-panel region closes it again.
  const [openSection, setOpenSection] = useState<"status" | "param" | null>(null);
  // Allow a short grace window when the pointer crosses the gap between a
  // SectionHeader and its floating dropdown body (the dropdown is a child
  // of .status-bar__hover-sections so this is rare, but on a scrolling
  // content panel the user can briefly move the cursor into a scrollbar
  // or the dropdown's own padding and trigger a premature close). The
  // leave timer is cleared on every mouseEnter inside the open region.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleClose = (): void => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpenSection(null), 220);
  };
  const cancelClose = (): void => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);
  const hh = String(time.hourOfDay).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");

  const targetName = targetSlot
    ? targetSlot.callName ?? `角色${targetSlot.charaNum}`
    : "";
  const actionHints = getHudActionHints(props.state);
  const workInfo = targetSlot ? getHudWorkInfo(props.state, targetSlot.charaNum) : null;
  const battleAbility = targetSlot ? getBattleAbilityDisplay(targetSlot.state) : "";

  return (
    <div className="status-bar" data-testid="game-status-bar">
      {/* ① 日付/天候 header — the mock's `****… 春之月… 气温… ****` band. */}
      <div className="status-bar__rule" />
      <div className="status-bar__line">
        <span className="status-bar__date">
          {month}{date}日（{weekday}）· 第{day}日
        </span>
        <span className="status-bar__time">
          {hh}:{mm}
        </span>
        {tzName && (
          <span className="status-bar__timezone" data-testid="status-bar-timezone">
            （{tzName}）
          </span>
        )}
        <span className="status-bar__weather" data-testid="status-bar-weather">
          ―{weather}―
        </span>
        <span className="status-bar__weather-detail" data-testid="status-bar-region">
          区域:{weatherInfo.regionName}
        </span>
        <span className="status-bar__weather-detail" data-testid="status-bar-wind">
          风:{wind}
        </span>
        <span className="status-bar__weather-detail" data-testid="status-bar-rainbow">
          天象:{rainbow}
        </span>
        {weatherInfo.thunder && (
          <span className="status-bar__weather-detail status-bar__weather-detail--warn" data-testid="status-bar-thunder">
            雷
          </span>
        )}
        {weatherInfo.warnings.length > 0 && (
          <span className="status-bar__weather-detail status-bar__weather-detail--warn" data-testid="status-bar-warning">
            警报:{weatherInfo.warnings.join("、")}
          </span>
        )}
        <span className="status-bar__weather-detail" data-testid="status-bar-umbrella">
          {umbrellaText}
        </span>
        <span
          className="status-bar__temp"
          data-testid="status-bar-temp"
          style={{ color: temperatureColor(temp01) }}
        >
          {formatTemperature(temp01)}
        </span>
        <ActionHints hints={actionHints} />
      </div>
      <div className="status-bar__rule" />

      {/* TSP bar + 時間停止 control — a fixed top row, BELOW the date line and
          ABOVE the Status section (NOT inside Status, NOT in the Act_COM grid).
          The TSP gauge is always visible; the 時間停止 button sits to its RIGHT:
          「时停」to enter, swapping to「解除时停」while stopped. */}
      <div className="status-bar__tsp-row" data-testid="status-bar-tsp-row">
        <StatBars who="主人公" state={master.state} keys={["TSP"]} testidSuffix="tsp" />
        {isTimeStopped(props.state) ? (
          <button
            type="button"
            className="status-bar__timestop status-bar__timestop--active"
            data-testid="status-bar-timestop"
            onClick={props.onReleaseTimeStop}
            disabled={!props.onReleaseTimeStop}
            title="解除时间停止"
          >
            解除时停
          </button>
        ) : (
          <button
            type="button"
            className="status-bar__timestop"
            data-testid="status-bar-timestart"
            onClick={props.onTimeStop}
            disabled={!props.onTimeStop}
            title="时间停止"
          >
            时停
          </button>
        )}
      </div>

      {/* ② 地点 / 清洁度 / 所持金 */}
      <div className="status-bar__line">
        <span className="status-bar__loc" data-testid="status-bar-loc">
          ［{fmtLocation(master.location)}］
        </span>
        {cleanliness && (
          <span className="status-bar__cleanliness" data-testid="status-bar-cleanliness">
            清洁度:{cleanliness}
          </span>
        )}
        <span className="status-bar__money">所持金：{money.toLocaleString()}</span>
        {props.state.dateSession && (
          <span data-testid="status-bar-date">
            约会：{datePartner?.callName ?? `#${props.state.dateSession.partner}`} · {props.state.dateSession.phase}
            {props.state.dateSession.travelRemainingMinutes ? ` · 剩余${props.state.dateSession.travelRemainingMinutes}分` : ""}
          </span>
        )}
      </div>

      {/* ③ 在场角色 — the mock's `[先代] [灵梦]` line. */}
      {present.length > 0 && (
        <div className="status-bar__present" data-testid="status-bar-present">
          在场：
          {present.map((c) => (
            <span key={c.charaNum} className="status-bar__present-name">
              [{c.callName ?? `#${c.charaNum}`}]
            </span>
          ))}
        </div>
      )}

      {targetSlot && (
        <WorkInfoLine
          targetName={targetName}
          work={workInfo}
          battleAbility={battleAbility}
        />
      )}

      {/* 状态 / 属性 stay inline in the bar; their body floats below without
          compressing the middle scene. Leaving the entire bar area (header
          + floating panel) triggers a 220ms grace close so a brief pointer
          dip into a scrollbar / padding / inter-section gap doesn't snap
          the panel shut. Entering either header or the open body cancels
          the close timer. */}
      <div
        className="status-bar__hover-sections"
        onMouseLeave={scheduleClose}
        onMouseEnter={cancelClose}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            scheduleClose();
          }
        }}
      >
        <SectionHeader
          id="status"
          label="状态"
          open={openSection === "status"}
          onOpen={() => {
            cancelClose();
            setOpenSection("status");
          }}
        />
        <SectionHeader
          id="param"
          label="属性"
          open={openSection === "param"}
          onOpen={() => {
            cancelClose();
            setOpenSection("param");
          }}
        />

        {openSection && (
          <div
            className={
              "status-bar__dropdown status-bar__dropdown--" + openSection
            }
            data-testid="status-dropdown"
            data-section={openSection}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
          {/* 状态: 体/気/酒/精 bars + 対象 + 好感/情緒/理性 + 今日运势. */}
          {openSection === "status" && (
            <div className="status-bar__section" data-testid="status-section-status">
              <StatBars who={master.callName ?? "主人公"} state={master.state} keys={NAMED_STAT_KEYS.filter((k) => k !== "TSP")} />
              <Sleepiness state={props.state} />
              <SituationTags state={props.state} />
              {targetSlot && (
                <>
                  <StatBars who={targetName} state={targetSlot.state} keys={["体力", "気力"]} />
                  <RelationStats who={targetName} state={targetSlot.state} />
                  <HBodyStats who={targetName} state={targetSlot.state} />
                </>
              )}
              <div className="status-bar__fortune" data-testid="status-bar-fortune">
                今日运势：{fortune > 0 ? fortune : "—"}
              </div>
            </div>
          )}
          {/* 属性: 欲情 / 恭順 etc. only (TARGET-gated), faithful to
              eraTW's SHOW_INFO_PALAM. No ABL gauges here — those live on
              a separate 能力 display screen, not the main status bar.
              No TARGET → render nothing (eraTW same: SHOW_INFO_PALAM is
              called under SIF TARGET, otherwise nothing is shown). */}
          {openSection === "param" && targetSlot && (
            <div className="status-bar__section" data-testid="status-section-param">
              <PalamPanel
                state={targetSlot.state}
                charaNum={targetSlot.charaNum}
                onOpenCharaInfo={props.onOpenCharaInfo}
              />
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A hover/focus section header rendered like the Act_COM / Ex_COM dividers. */
function SectionHeader(props: {
  id: "status" | "param";
  label: string;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="status-bar__section-header"
      data-testid={`status-section-toggle-${props.id}`}
      aria-expanded={props.open}
      onMouseEnter={props.onOpen}
      onFocus={props.onOpen}
      onClick={props.onOpen}
    >
      <span className="status-bar__section-name">
        {props.open ? "▾" : "▸"} {props.label}
      </span>
    </button>
  );
}
