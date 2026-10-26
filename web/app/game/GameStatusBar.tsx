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
  isHMode,
  palamLvBar,
  NAMED_STAT_KEYS,
  PALAM_STAT_KEYS,
  weekdayLabelZh,
  seasonOf,
  dateOf,
  monthName,
  isTimeStopped,
} from "../../../modernization/runtime";
import { selectPresentCharas } from "../../../modernization/runtime/scene/presence.js";
import type { NarrativeDirectorView } from "../ai/narrative-status.js";
import { nemuke } from "../../../modernization/runtime/state/nemuke.js";
import { situationTags, type SituationTag } from "../../../modernization/runtime/state/situation.js";
import { alcoholFace } from "../../../modernization/runtime/state/alcohol.js";
import type { CharaSlot, GameState } from "../../../modernization/runtime/state/index.js";
import { describeClothing } from "../../../modernization/runtime/state/clothing.js";
import { isEquipped, readTequip } from "../../../modernization/runtime/state/tequip.js";
import { TEQUIP_ID, TCVAR_ID } from "../../../modernization/runtime/state/settlement.js";
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
import PortraitVariantPicker from "./PortraitVariantPicker.js";
import { AsciiBar, AsciiNumber } from "./ascii/AsciiEffects.js";

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
  /** Keep the date/weather/location/TSP/present-character band only. The
   *  full layout is used by the immersive shell; `minimal` is the
   *  phone-portrait ultra-slim band (no numeric panels). */
  layout?: "full" | "world-only" | "minimal";
  /** Minimal layout only: click a present chara name to make it the TARGET. */
  onSelectChara?: (charaNum: number) => void;
  /** The focused interaction target (charaNum). When present + > 0, the bar
   *  also shows that chara's 体力/気力 (the original shows both via
   *  PRINT_COLORBAR). */
  target?: number;
  /** The dedicated H surface renders the same summary in its own status column. */
  showHSessionStatus?: boolean;
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
  /** The story currently worth the player's attention, if any. The bar renders
   *  nothing for it when this is absent, so the shell keeps ownership of the
   *  narrative state and only hands over a display shape. */
  narrativePursuit?: NarrativePursuitSummary | null;
  /** What the L3 director is doing right now (authoring / window open / …),
   *  derived by `narrative-status.ts`. Shown as an extra panel line so the
   *  player can tell "waiting for you" apart from "nothing is happening". */
  narrativeDirector?: NarrativeDirectorView | null;
  narrativePanelOpen?: boolean;
  /** Toggle for the story panel. Without it the badge renders inert, which is
   *  what a read-only render (tests, previews) wants. */
  onToggleNarrativePanel?: () => void;
}

/** What the story badge shows while collapsed, and what the panel shows once
 *  opened. `state` drives the marker so a story the player can walk into right
 *  now is distinguishable from one already running, or one already missed. */
export interface NarrativePursuitSummary {
  id: string;
  hint: string;
  state: "waiting" | "active" | "missed";
  /** How many stories are being tracked; shown as a count when > 1. */
  count: number;
}

/** Format a location string for display.
 *  "神社:参道" → "博麗神社 · 参道"
 *  "人間之里" → "人間之里"
 *
 *  Exported so the story panel the shell feeds into this bar spells locations
 *  the same way the location line does. */
export function fmtLocation(loc: string): string {
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
  cells?: number;
}) {
  const cells = props.cells ?? 12;
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
              <span className="bar__ascii" aria-hidden="true"><AsciiBar fill01={fill / 100} cells={cells} /></span>
            </span>
            <span className="bar__num">
              <AsciiNumber key={props.who} value={value} suffix={`/${max}`} />
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
function RelationStats(props: { who: string; state: GameState["master"]["state"]; showWho?: boolean }) {
  const favor = getRelationStat(props.state, "好感度");
  const trust = getRelationStat(props.state, "信頼度");
  const joucho = getRelationStat(props.state, "情緒");
  const risei = getRelationStat(props.state, "理性");
  const fury = getRelationStat(props.state, "憤怒");
  // A 0..5 rating, faithful to @INFO_EMOTION's gauge model: the tier is the
  // ABSOLUTE value/200 (not a ratio of the cap) — 理性 (rationality) floors at
  // 1★ and is full when calm, while 情緒 (stirring) and 憤怒 (anger) sit empty
  // when calm. Upstream caps 情緒 at 1500 for every character, so tier 5
  // saturates at 1000 while the at-cap (upstream pink) marker needs 1500.
  // Render each glyph as its own span so the filled portions can carry the
  // intended color without recoloring the whole relation line.
  const rate = (
    s: { value: number; max: number },
    filled: string,
    empty: string,
    tone: "risei" | "joucho" | "fury",
  ): ReactNode => {
    if (s.max <= 0) return "—";
    const n = tone === "risei"
      ? Math.max(1, Math.min(5, Math.trunc(s.value / 200)))
      : Math.max(0, Math.min(5, Math.trunc(s.value / 200)));
    const atCap = s.value >= s.max;
    return (
      <span
        className={`status-bar__gauge status-bar__gauge--${tone}${atCap ? " status-bar__gauge--full" : ""}`}
        aria-label={`${n}/5`}
        title={atCap ? "MAX" : undefined}
      >
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
      {props.showWho !== false && <span className="status-bar__who">{props.who}</span>}
      <span className="status-bar__rel"><AsciiNumber key={props.who} value={favor.value} prefix="好感度 " /></span>
      <span className="status-bar__rel"><AsciiNumber key={props.who} value={trust.value} prefix="信頼度 " /></span>
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

function HBodyStats(props: { who: string; state: GameState["master"]["state"]; showWho?: boolean }) {
  const s = getHBodyStats(props.state);
  const ejaculateRatio = s.ejaculateMax > 0
    ? Math.max(0, Math.min(1, s.ejaculate / s.ejaculateMax))
    : 0;
  const desireRatio = Math.max(0, Math.min(1, s.frustration / 1000));
  const desireColor = `rgb(${Math.round(240 + 15 * desireRatio)}, ${Math.round(190 - 102 * desireRatio)}, ${Math.round(211 - 29 * desireRatio)})`;
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
    <div className="status-bar__hbody" data-testid="status-hbody" data-who={props.who}>
      {props.showWho !== false && <span className="status-bar__who">{props.who}</span>}
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
          {s.aboutToEjaculate ? " [要去了！]" : ""}
          <span
            aria-hidden="true"
            data-testid="hbody-ejaculate-gauge"
            style={{
              display: "inline-block",
              width: "5.5em",
              height: "0.55em",
              marginLeft: "0.5em",
              border: "1px solid #705f78",
              background: `linear-gradient(90deg, ${s.aboutToEjaculate ? "#ff5577" : "#be7fe5"} ${Math.round(ejaculateRatio * 100)}%, #241e2a ${Math.round(ejaculateRatio * 100)}%)`,
            }}
          />
        </span>
      )}
      <span
        className="status-bar__hbody-line"
        data-testid="hbody-frustration"
        data-desire-high={desireRatio >= 0.9 ? "true" : undefined}
        style={{
          color: desireColor,
          textShadow: `0 0 ${Math.round(2 + desireRatio * 8)}px rgba(255, 92, 178, ${0.15 + desireRatio * 0.5})`,
        }}
      >
        欲求：{Math.trunc(s.frustration / 10)}%
      </span>
      {s.afterglowLabel && (
        <span className="status-bar__hbody-line" data-testid="hbody-afterglow">
          高潮余韵：{s.afterglowLabel}
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
  collapsible?: boolean;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(!props.collapsible);
  return (
    <div
      className="status-bar__palam"
      data-testid="status-palam"
      data-expanded={expanded ? "true" : "false"}
    >
      <div className="status-bar__palam-head">
        {props.collapsible ? (
          <button
            type="button"
            className="status-bar__palam-toggle"
            data-testid="text-game-palam-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            <span aria-hidden="true">{expanded ? "▼" : "▶"}</span>[Palam] 能力等级
          </button>
        ) : (
          <span className="status-bar__palam-title">{props.title ?? "▼[Palam] 能力等级"}</span>
        )}
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
      {expanded && (
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
                  <span className="bar__ascii" aria-hidden="true"><AsciiBar fill01={fill01} cells={6} /></span>
                </span>
                <span className="status-bar__palam-value"><AsciiNumber value={value} /></span>
              </span>
            );
          })}
        </div>
      )}
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
  alcohol: "sit-tag--alcohol",
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

function AlcoholStatus(props: { state: GameState; charaNum: number; who: string; showWho?: boolean }) {
  const face = alcoholFace(props.state, props.charaNum);
  if (face === "清醒") return null;
  return (
    <div className="status-bar__alcohol-state" data-testid={`status-alcohol-${props.charaNum}`}>
      {props.showWho !== false ? `${props.who}：` : "酒醉："}{face}
    </div>
  );
}

const H_POSITION_LABELS: Readonly<Record<number, string>> = {
  60: "正常位",
  61: "后背位",
  62: "骑乘位",
  63: "背面骑乘位",
  65: "侧位",
  66: "对面座位",
  67: "立位",
  68: "抱起",
  69: "对面立位",
  70: "背面立位",
};

const H_EQUIPMENT_LABELS: ReadonlyArray<readonly [number, string]> = [
  [TEQUIP_ID.避孕套, "避孕套"],
  [TEQUIP_ID.陰蒂夾, "阴蒂夹"],
  [TEQUIP_ID.飛機杯, "飞机杯"],
  [TEQUIP_ID.振動棒, "振动棒"],
  [TEQUIP_ID.肛用振動棒, "肛用振动棒"],
  [TEQUIP_ID.後庭拉珠, "后庭拉珠"],
  [TEQUIP_ID.乳頭夾, "乳头夹"],
  [TEQUIP_ID.搾乳機, "榨乳机"],
  [TEQUIP_ID.眼罩, "眼罩"],
  [TEQUIP_ID.縄, "绳"],
  [TEQUIP_ID.口球, "口球"],
  [TEQUIP_ID.拘束, "拘束"],
];

function hExposureLabels(chara: CharaSlot): string[] {
  const lower = readTequip(chara, TEQUIP_ID.下半身着衣状況);
  const upper = readTequip(chara, TEQUIP_ID.上半身着衣状況);
  const lowerLabel = lower === 0
    ? "下身裸露"
    : lower & 0b10000
      ? "下身不可插入"
      : lower & 0b1000
        ? "下装不可移位"
        : lower & 0b0110
          ? "下装可移位"
          : "下装着衣";
  const upperLabel = upper === 0
    ? "上身裸露"
    : upper & 0b100
      ? "上身不可插入"
      : upper & 0b10
        ? "上衣不可敞开"
        : upper & 0b1
          ? "上身可敞开"
          : "上身着衣";
  return [upperLabel, lowerLabel];
}

/** Persistent H-session status. The command strip is intentionally compact,
 * so the player also needs an always-visible owner/target/pose indicator that
 * survives save/load and does not depend on the hover-only status panel. */
export function HSessionStatus({ state, focusedTarget, showGauges = true }: { state: GameState; focusedTarget?: number; showGauges?: boolean }) {
  const session = state.training;
  const targetNo = session?.target ?? (focusedTarget && focusedTarget > 0 && isHMode(state, focusedTarget) ? focusedTarget : 0);
  if (targetNo <= 0) return null;
  const target = state.charas[targetNo];
  const targetName = target?.callName ?? `#${targetNo}`;
  const insertion = session?.vInserted ? "V 插入" : session?.aInserted ? "A 插入" : "未插入";
  const positionCommand = session?.currentPositionCommandNo;
  const position = positionCommand === undefined
    ? "未选择体位"
    : H_POSITION_LABELS[positionCommand] ?? `体位 ${positionCommand}`;
  const clothing = target ? describeClothing(target) : null;
  const clothingText = clothing
    ? clothing.naked
      ? "全裸"
      : clothing.lines.slice(0, 4).map((line) => `${line.label}:${line.value}`).join("、") || "衣着未记录"
    : "目标不存在";
  const exposureText = target ? hExposureLabels(target).join("、") : "目标不存在";
  const equipmentText = target
    ? H_EQUIPMENT_LABELS.filter(([id]) => isEquipped(target, id)).map(([, label]) => label).join("、") || "无"
    : "目标不存在";
  return (
    <div className="status-bar__h-session" data-testid="status-h-session" role="status">
      <span className="status-bar__h-session-title">H 状态</span>
      <span data-testid="status-h-session-owner">主人：{state.master.callName ?? "主人公"}</span>
      <span data-testid="status-h-session-target">对象：{targetName}</span>
      <span data-testid="status-h-session-insertion">状态：{insertion}</span>
      <span data-testid="status-h-session-position">体位：{position}</span>
      <span data-testid="status-h-session-clothing">衣着：{clothingText}</span>
      <span data-testid="status-h-session-exposure">暴露：{exposureText}</span>
      <span data-testid="status-h-session-equipment">装备：{equipmentText}</span>
      {showGauges && <div className="status-bar__h-session-gauges" data-testid="status-h-session-gauges">
        <HBodyStats who={state.master.callName ?? "主人公"} state={state.master.state} />
        {target && <HBodyStats who={targetName} state={target.state} showWho={false} />}
      </div>}
    </div>
  );
}

/** Read-only H HUD using the canonical selectors from the ordinary status UI. */
export function HTrainingStats({ state, target }: { state: GameState; target: number }) {
  const partner = state.charas[target];
  return (
    <div className="h-training-stats" data-testid="h-training-stats">
      <section aria-label="主角信息" data-testid="h-master-stats">
        <h3>主角 · {state.master.callName ?? "主人公"}</h3>
        <StatBars who={state.master.callName ?? "主人公"} state={state.master.state} keys={["体力", "気力"]} />
      </section>
      {partner && <section aria-label="对象信息" data-testid="h-target-stats">
        <h3>对象 · {partner.callName ?? partner.name ?? `角色${target}`}</h3>
        <StatBars who={partner.callName ?? `角色${target}`} state={partner.state} keys={["体力", "気力"]} />
        <RelationStats who={partner.callName ?? `角色${target}`} state={partner.state} showWho={false} />
        <span>避孕药：{(partner.state.TCVAR[TCVAR_ID.口服避孕薬] ?? 0) !== 0 ? "已服用" : "未服用"}</span>
      </section>}
      {partner && <section aria-label="对象积攒与身体状态">
        <h3>对象 · 积攒与身体状态</h3>
        <PalamPanel state={partner.state} title="积攒与感受" />
        <HBodyStats who={partner.callName ?? `角色${target}`} state={partner.state} showWho={false} />
      </section>}
      <section aria-label="主角积攒与身体状态">
        <h3>主角 · 积攒与身体状态</h3>
        <PalamPanel state={state.master.state} title="积攒与感受" />
        <StatBars who={state.master.callName ?? "主人公"} state={state.master.state} keys={NAMED_STAT_KEYS.filter((key) => key !== "体力" && key !== "気力")} />
        <HBodyStats who={state.master.callName ?? "主人公"} state={state.master.state} showWho={false} />
      </section>
    </div>
  );
}

export interface TextGameInfoPanelProps {
  state: GameState;
  target?: number;
  onOpenCharaInfo?: (charaNum: number) => void;
  onSetPortraitVariant?: (charaNum: number, variantId: number) => void;
}

/** Fixed left column for the immersive text-game surface. This is a pure
 * presentation of the same state selectors used by the full status bar. */
export function TextGameInfoPanel(props: TextGameInfoPanelProps) {
  const targetSlot =
    props.target !== undefined && props.target > 0
      ? props.state.charas[props.target]
      : undefined;
  const targetName = targetSlot
    ? targetSlot.callName ?? `角色${targetSlot.charaNum}`
    : "";
  const workInfo = targetSlot
    ? getHudWorkInfo(props.state, targetSlot.charaNum)
    : null;
  const battleAbility = targetSlot
    ? getBattleAbilityDisplay(targetSlot.state)
    : "";
  const fortune = getFortune(props.state.master.state);
  const [portraitPickerOpen, setPortraitPickerOpen] = useState(false);

  return (
    <aside className="text-game-info" data-testid="text-game-info-panel" aria-label="角色与状态情报">
      <section className="text-game-info__section" data-testid="text-game-object-info">
        <h2 className="text-game-info__heading">┌ 对象情报 ┐</h2>
        {targetSlot ? (
          <WorkInfoLine
            targetName={targetName}
            work={workInfo}
            battleAbility={battleAbility}
          />
        ) : (
          <p className="text-game-info__empty">未选择对象</p>
        )}
        {targetSlot && props.onSetPortraitVariant && (
          <div className="text-game-info__portrait-update">
            <button
              type="button"
              className="text-game-info__action"
              data-testid="text-game-portrait-update"
              aria-expanded={portraitPickerOpen}
              onClick={() => setPortraitPickerOpen((open) => !open)}
            >
              {portraitPickerOpen ? "[收起立绘更新]" : "[立绘更新]"}
            </button>
            {portraitPickerOpen && (
              <PortraitVariantPicker
                state={props.state}
                charaNum={targetSlot.charaNum}
                compact
                onSelect={(variantId) => props.onSetPortraitVariant?.(targetSlot.charaNum, variantId)}
              />
            )}
          </div>
        )}
      </section>

      <section className="text-game-info__section" data-testid="text-game-status-info">
        <h2 className="text-game-info__heading">┌ 状态 ┐</h2>
        <StatBars
          who={props.state.master.callName ?? "主人公"}
          state={props.state.master.state}
          keys={NAMED_STAT_KEYS.filter((key) => key !== "TSP")}
          cells={16}
        />
        <Sleepiness state={props.state} />
        <SituationTags state={props.state} />
        {props.state.training && (
          <HBodyStats who={props.state.master.callName ?? "主人公"} state={props.state.master.state} />
        )}
        {targetSlot && (
          <div className="text-game-info__target-status">
            <StatBars who={targetName} state={targetSlot.state} keys={["体力", "気力"]} cells={16} />
            <AlcoholStatus
              state={props.state}
              charaNum={targetSlot.charaNum}
              who={targetName}
              showWho={false}
            />
            <RelationStats who={targetName} state={targetSlot.state} showWho={false} />
            <HBodyStats who={targetName} state={targetSlot.state} showWho={false} />
          </div>
        )}
        <div className="status-bar__fortune" data-testid="text-game-fortune">
          今日运势：{fortune > 0 ? fortune : "—"}
        </div>
      </section>

      <section className="text-game-info__section" data-testid="text-game-param-info">
        <h2 className="text-game-info__heading">┌ 属性 ┐</h2>
        {targetSlot ? (
          <PalamPanel
            state={targetSlot.state}
            charaNum={targetSlot.charaNum}
            onOpenCharaInfo={props.onOpenCharaInfo}
            collapsible
          />
        ) : (
          <p className="text-game-info__empty">未选择对象，属性暂无内容</p>
        )}
      </section>
    </aside>
  );
}

export default function GameStatusBar(props: GameStatusBarProps) {
  const { time, master, charas, money } = props.state;
  const day = time.dayIndex + 1;
  // Parity QA P-2: real eraTW calendar — weekday `(dayIndex+1)%7`
  // (日/月/火/水/木/金/土) + the (season-month, date) pair off `time`
  // (春之月/夏之月/…, date 1-31). Was an `(dayIndex+3)%7` mock anchor.
  const weekday = weekdayLabelZh(time.dayIndex);
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
  // Current Chinese 8-division label + HH:MM (was HH:00 only).
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
  // Minimal starts as world-only band (no work info, no hover status/param
  // dropdowns) plus a trimmed numeric surface: only time/weather/location/
  // roster/time-stop stay, everything numeric goes away.
  const minimal = props.layout === "minimal";
  const worldOnly = props.layout === "world-only" || minimal;

  // Shared 时间停止 control: a full TSP row in the standard layouts, a single
  // compact button on the minimal date line (the minimal top band is only two
  // rows tall so the text stream keeps the screen).
  const timestopButton = isTimeStopped(props.state) ? (
    <button
      type="button"
      className={`status-bar__timestop status-bar__timestop--active${minimal ? " status-bar__timestop--compact" : ""}`}
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
      className={`status-bar__timestop${minimal ? " status-bar__timestop--compact" : ""}`}
      data-testid="status-bar-timestart"
      onClick={props.onTimeStop}
      disabled={!props.onTimeStop}
      title="时间停止"
    >
      时停
    </button>
  );

  // Story badge + panel. A circled ! immediately right of the time-stop
  // control, opening an on-demand panel instead of the permanent banner this
  // replaces. Rendered only when there is a story to show: an inert toggle in
  // the two-row minimal band costs more than it says.
  const pursuit = props.narrativePursuit ?? null;
  const director = props.narrativeDirector ?? null;
  const narrativeToggle = pursuit || director ? (
    <>
      <button
        type="button"
        className={`status-bar__narrative-toggle${pursuit && (pursuit.state === "waiting" || pursuit.state === "active") ? " status-bar__narrative-toggle--active" : ""}${minimal ? " status-bar__narrative-toggle--compact" : ""}`}
        data-testid="status-bar-narrative-toggle"
        data-narrative-state={pursuit?.state ?? "waiting"}
        aria-expanded={props.narrativePanelOpen === true}
        aria-controls={pursuit?.id ? `narrative-pursuit-${pursuit.id}` : undefined}
        onClick={props.onToggleNarrativePanel}
        disabled={!props.onToggleNarrativePanel}
        title={pursuit?.hint ?? director?.label}
      >
        <span className="status-bar__narrative-toggle-mark" aria-hidden="true">!</span>
        <span className="status-bar__narrative-toggle-label">事件</span>
        {pursuit && pursuit.count > 1 && <span className="status-bar__narrative-toggle-count">{pursuit.count}</span>}
      </button>
      {props.narrativePanelOpen && (
        // Deliberately NOT role="status": the banner this replaces announced
        // itself on every render, which is one of the things being fixed.
        <div
          className="status-bar__narrative-panel"
          data-testid="narrative-pursuit-panel"
          id={pursuit?.id ? `narrative-pursuit-${pursuit.id}` : undefined}
        >
          {pursuit && <p className="status-bar__narrative-panel-opening" data-testid="narrative-pursuit-hint">{pursuit.hint}</p>}
          {director && <p data-testid="narrative-director-status">{director.label}</p>}
        </div>
      )}
    </>
  ) : null;

  // Present-NPC names: chips that pick the TARGET in minimal (rendered inline
  // on the location line), plain spans in the standard layouts.
  const presentChips = present.length > 0 ? (
    <>
      在场：
      {present.map((c) =>
        minimal && props.onSelectChara ? (
          <button
            key={c.charaNum}
            type="button"
            className={`status-bar__present-name status-bar__present-name--chip${props.target === c.charaNum ? " status-bar__present-name--selected" : ""}`}
            data-testid="minimal-roster-name"
            data-chara={c.charaNum}
            aria-pressed={props.target === c.charaNum}
            onClick={() => props.onSelectChara!(c.charaNum)}
          >
            [{c.callName ?? `#${c.charaNum}`}]
          </button>
        ) : (
          <span key={c.charaNum} className="status-bar__present-name">
            [{c.callName ?? `#${c.charaNum}`}]
          </span>
        ),
      )}
    </>
  ) : null;

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
        {!minimal && tzName && (
          <span className="status-bar__timezone" data-testid="status-bar-timezone">
            （{tzName}）
          </span>
        )}
        <span className="status-bar__weather" data-testid="status-bar-weather">
          ―{weather}―
        </span>
        {!minimal && (
          <span className="status-bar__weather-detail" data-testid="status-bar-region">
            区域:{weatherInfo.regionName}
          </span>
        )}
        {!minimal && (
          <span className="status-bar__weather-detail" data-testid="status-bar-wind">
            风:{wind}
          </span>
        )}
        {!minimal && (
          <span className="status-bar__weather-detail" data-testid="status-bar-rainbow">
            天象:{rainbow}
          </span>
        )}
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
        {!minimal && (
          <span className="status-bar__weather-detail" data-testid="status-bar-umbrella">
            {umbrellaText}
          </span>
        )}
        <span
          className="status-bar__temp"
          data-testid="status-bar-temp"
          style={{ color: temperatureColor(temp01) }}
        >
          {formatTemperature(temp01)}
        </span>
        <ActionHints hints={actionHints} />
        {minimal && timestopButton}
        {minimal && narrativeToggle}
      </div>
      <div className="status-bar__rule" />

      {/* TSP bar + 時間停止 control — a fixed top row, BELOW the date line and
          ABOVE the Status section (NOT inside Status, NOT in the Act_COM grid).
          The TSP gauge is always visible; the 時間停止 button sits to its RIGHT:
          「时停」to enter, swapping to「解除时停」while stopped.
          Minimal: the whole row collapses (the button moved onto the date
          line) so the top band stays two rows tall. */}
      {!minimal && (
        <div className="status-bar__tsp-row" data-testid="status-bar-tsp-row">
          <StatBars who="主人公" state={master.state} keys={["TSP"]} testidSuffix="tsp" />
          {timestopButton}
          {narrativeToggle}
        </div>
      )}

      {/* ② 地点 / 清洁度 / 所持金 — minimal keeps the location line and inlines
          the present-NPC chips onto it (two-row top band). */}
      <div className="status-bar__line">
        <span className="status-bar__loc" data-testid="status-bar-loc">
          ［{fmtLocation(master.location)}］
        </span>
        {!minimal && cleanliness && (
          <span className="status-bar__cleanliness" data-testid="status-bar-cleanliness">
            清洁度:{cleanliness}
          </span>
        )}
        {!minimal && <span className="status-bar__money">所持金：<AsciiNumber value={money} grouped /></span>}
        {props.state.dateSession && (
          <span data-testid="status-bar-date">
            约会：{datePartner?.callName ?? `#${props.state.dateSession.partner}`} · 约会中
          </span>
        )}
        {minimal && (
          <span className="status-bar__present-inline" data-testid="status-bar-present">
            {presentChips}
          </span>
        )}
      </div>

      {props.showHSessionStatus !== false && <HSessionStatus state={props.state} focusedTarget={props.target} />}

      {/* ③ 在场角色 — the mock's `[先代] [灵梦]` line (minimal inlines it
          above instead of taking a third top row). */}
      {!minimal && (
        <div className="status-bar__present" data-testid="status-bar-present">
          {presentChips}
        </div>
      )}

      {!worldOnly && targetSlot && (
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
      {!worldOnly && <div
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
              {props.state.training && (
                <HBodyStats who={master.callName ?? "主人公"} state={master.state} />
              )}
              {targetSlot && (
                <>
                  <StatBars who={targetName} state={targetSlot.state} keys={["体力", "気力"]} />
                  <AlcoholStatus state={props.state} charaNum={targetSlot.charaNum} who={targetName} showWho={false} />
                  <RelationStats who={targetName} state={targetSlot.state} showWho={false} />
                  <HBodyStats who={targetName} state={targetSlot.state} showWho={false} />
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
      </div>}
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
