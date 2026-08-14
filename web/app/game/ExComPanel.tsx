/**
 * Ex_COM display panels (能力显示 / 能力显示(主角) / 日历 / 污渍显示).
 *
 * The original eraTW Ex_COM row carries read-only utility tools alongside the
 * settlement Act_COM grid. This component is the modern equivalent for the
 * *display* tools the user asked to restore: a modal over the current
 * `GameState`, built ENTIRELY from the namespace-free accessors the status bar
 * already uses (getNamedStat / getRelationStat / calendar / weather /
 * getCleanlinessLabel) — so it stays clear of the UI forbidden-names boundary
 * and never re-derives game data.
 *
 * Tools NOT here (no clean backend yet, see GameClient Ex_COM row): 道具一览
 * needs an item-id→name table; 外出 needs the out-of-shrine locations built.
 * Those render as disabled buttons with a reason, not fake actions.
 */
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { DatePlanEvent } from "../../../modernization/runtime/state/game-state.js";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { getDish } from "../../../modernization/runtime/state/dish.js";
import { dishFreshnessStatus } from "../../../modernization/runtime/state/dish-freshness.js";
import {
  allBrewNames,
  currentFerment,
  fermentDays,
  fermentTarget,
} from "../../../modernization/runtime/state/brewing.js";
import itemsBundle from "./items.bundle.json";
import {
  getNamedStat,
  getRelationStat,
  getFortune,
  getPalamStat,
  palamLvBar,
  PALAM_STAT_KEYS,
  NAMED_STAT_KEYS,
  getCleanlinessLabel,
  weekdayName,
  seasonOf,
  dateOf,
  monthName,
  festivalOf,
} from "../../../modernization/runtime";
import {
  formatTemperature,
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
import { resolveWhereabouts } from "../../../modernization/runtime/world/whereabouts.js";
import {
  JOB_LABEL,
  WORK_MANIFEST,
  resolveWorkEntry,
} from "../../../modernization/runtime/world/work/work-manifest.js";

export type ExComTool = "ability-master" | "ability-target" | "calendar" | "yogore" | "living" | "whereabouts";

const RELATION_LABELS = ["好感度", "信頼度", "情緒", "理性", "憤怒"] as const;

type Slot = GameState["master"]["state"];

/** 体力/気力/酒/TSP/精力 bars — the same accessor the status bar uses. */
function AbilityView({ slot, name, isTarget }: { slot: Slot; name: string; isTarget: boolean }) {
  return (
    <div className="excom-panel__ability" data-testid="excom-ability">
      <div className="excom-panel__who">{name}</div>
      {NAMED_STAT_KEYS.map((label) => {
        const { value, max } = getNamedStat(slot, label);
        const fill = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
        return (
          <div key={label} className="excom-panel__statline">
            <span className="excom-panel__statlabel">{label}</span>
            <span
              className="excom-panel__bar"
              role="progressbar"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={Math.max(0, max)}
              aria-valuenow={Math.max(0, value)}
            >
              <span className="excom-panel__bar-fill" style={{ width: `${fill}%` }} />
            </span>
            <span className="excom-panel__statnum">{value}/{max}</span>
          </div>
        );
      })}

      {isTarget && (
        <div className="excom-panel__relations">
          <div className="excom-panel__subtitle">关系 / 情绪</div>
          {RELATION_LABELS.map((label) => {
            const { value } = getRelationStat(slot, label);
            return (
              <div key={label} className="excom-panel__statline">
                <span className="excom-panel__statlabel">{label}</span>
                <span className="excom-panel__statnum">{value}</span>
              </div>
            );
          })}
          <div className="excom-panel__statline">
            <span className="excom-panel__statlabel">今日运势</span>
            <span className="excom-panel__statnum">{getFortune(slot)}</span>
          </div>
        </div>
      )}

      <div className="excom-panel__palam">
        <div className="excom-panel__subtitle">状态参数 Lv</div>
        {PALAM_STAT_KEYS.map((label) => {
          const value = getPalamStat(slot, label);
          const { level } = palamLvBar(value);
          return (
            <div key={label} className="excom-panel__statline">
              <span className="excom-panel__statlabel">{label}</span>
              <span className="excom-panel__statnum">Lv {level}　{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarDetails({ state, onCancelAppointment }: { state: GameState; onCancelAppointment?: (eventId: string) => void }) {
  const { time } = state;
  const regionWeather = currentRegionWeather(state);
  const minutes = time.tickValue % 60;
  const hh = String(time.hourOfDay).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const rows: Array<[string, string]> = [
    ["第几日", `第 ${time.dayIndex + 1} 日`],
    ["月／日", `${monthName(seasonOf(time))} ${dateOf(time)}日`],
    ["星期", weekdayName(time.dayIndex)],
    ["时间", `${timezoneName(currentTimezone(time.hourOfDay))}　${hh}:${mm}`],
    ["天候", `${formatRegionWeather(regionWeather)}（${regionWeather.regionName}）`],
    ["風・天象", `${formatRegionWind(regionWeather)} / ${formatRegionRainbow(regionWeather)}`],
    ["气温", formatTemperature(getCurrentTemperature(state))],
  ];
  const upcoming = projectCalendarDays(state, 7);
  const appointments = (state.worldEvents ?? []).filter((event): event is DatePlanEvent => event.kind === "date-plan" && ["scheduled", "waiting"].includes(event.phase));
  return (
    <div data-testid="excom-calendar-body">
      <dl className="excom-panel__kv">
        {rows.map(([k, v]) => (
          <div key={k} className="excom-panel__kvrow">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="excom-panel__subtitle">未来七日</div>
      <div data-testid="excom-calendar-appointments">
        {appointments.length === 0 ? <span>无约会预约</span> : appointments.map((event) => (
          <div key={event.id}>
            <span>{state.charas[event.partner]?.callName ?? `#${event.partner}`}　{event.scheduledStartTick != null ? minuteLabel(event.scheduledStartTick % 1440) : "时间未定"}　{event.location ?? "地点未定"}　赴约窗口 -30/+60分</span>
            {onCancelAppointment && <button type="button" data-testid={`cancel-date-${event.id}`} onClick={() => onCancelAppointment(event.id)}>[取消]</button>}
          </div>
        ))}
      </div>
      <div className="excom-panel__calendar-list" data-testid="excom-calendar-upcoming">
        {upcoming.map((day) => (
          <section key={day.dayIndex} className="excom-panel__calendar-day">
            <strong>第 {day.dayIndex + 1} 日　{monthName(day.season)}{day.date}日（{weekdayName(day.dayIndex)}）</strong>
            <span>{day.festival || "无节日"}</span>
            {day.work.length > 0 ? (
              <ul>
                {day.work.map((entry) => (
                  <li key={`${entry.charaNum}:${entry.startMin}:${entry.jobType}`}>
                    {entry.name}　{minuteLabel(entry.startMin)}-{minuteLabel(entry.endMin)}　{JOB_LABEL[entry.jobType] ?? "工作"}　{entry.location}
                  </li>
                ))}
              </ul>
            ) : <span>无已解析日程</span>}
          </section>
        ))}
      </div>
    </div>
  );
}

function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function nextCalendarDate(season: number, date: number): { season: number; date: number } {
  if (date < 31) return { season, date: date + 1 };
  return { season: season === 4 ? 1 : season + 1, date: 1 };
}

function projectCalendarDays(state: GameState, count: number) {
  const result: Array<{
    dayIndex: number;
    season: number;
    date: number;
    festival: string;
    work: Array<{ charaNum: number; name: string; startMin: number; endMin: number; jobType: number; location: string }>;
  }> = [];
  let season = seasonOf(state.time);
  let date = dateOf(state.time);
  for (let offset = 0; offset < count; offset++) {
    const dayIndex = state.time.dayIndex + offset;
    // Conditions in WORK_MANIFEST read the supplied state's day/time. Build a
    // throwaway projection so this information display never mutates runtime.
    const projected = { ...state, time: { ...state.time, dayIndex, season, date } };
    const work = WORK_MANIFEST.flatMap((entry) => {
      const ctx = { state: projected, dayIndex };
      if (!entry.cond(ctx)) return [];
      const resolved = resolveWorkEntry(entry, ctx);
      if (!resolved) return [];
      const slot = state.charas[entry.charaNum];
      return [{
        charaNum: entry.charaNum,
        name: slot?.callName ?? `#${entry.charaNum}`,
        startMin: resolved.startMin,
        endMin: resolved.endMin,
        jobType: resolved.jobType,
        location: resolved.location,
      }];
    });
    result.push({ dayIndex, season, date, festival: festivalOf(season, date), work });
    ({ season, date } = nextCalendarDate(season, date));
  }
  return result;
}

function YogoreView({ state }: { state: GameState }) {
  const loc = state.master.location;
  return (
    <dl className="excom-panel__kv" data-testid="excom-yogore-body">
      <div className="excom-panel__kvrow">
        <dt>当前位置</dt>
        <dd>{loc || "(未知)"}</dd>
      </div>
      <div className="excom-panel__kvrow">
        <dt>清洁度</dt>
        <dd>{loc ? getCleanlinessLabel(state, loc) : "—"}</dd>
      </div>
      <p className="excom-panel__note">※ 目前只跟踪所在房间的污渍；逐角色／全房间污渍待接。</p>
    </dl>
  );
}

/** Read-only equivalent of the original INFO living-state block. */
function LivingView({ state }: { state: GameState }) {
  const dish = getDish(state);
  const freshness = dishFreshnessStatus(dish);
  const ferment = currentFerment(state);
  const target = fermentTarget(ferment);
  const days = fermentDays(ferment);
  const known = Object.keys(state.brewKnown ?? {}).length;
  const names = (itemsBundle as { byId: Record<string, { name?: string } | undefined> }).byId;
  const owned = Object.entries(state.items ?? {})
    .map(([id, count]) => ({ id: Number(id), count, name: names[id]?.name ?? `未命名道具 #${id}` }))
    .filter((item) => item.count > 0)
    .sort((a, b) => a.id - b.id);

  return (
    <div className="excom-panel__living" data-testid="excom-living-body">
      <section>
        <div className="excom-panel__subtitle">当前料理</div>
        {dish ? (
          <dl className="excom-panel__kv">
            <div className="excom-panel__kvrow"><dt>料理</dt><dd>{dish.name}（{dish.type}）</dd></div>
            <div className="excom-panel__kvrow"><dt>鲜度</dt><dd>{dish.maxLimit > 0 ? `${dish.limit}/${dish.maxLimit}（${({ fresh: "刚做好", normal: "新鲜", stale: "劣化", spoiled: "腐坏", unmodeled: "待建模" } as const)[freshness]}）` : "待建模"}</dd></div>
            <div className="excom-panel__kvrow"><dt>风味</dt><dd>{dish.taste || "未记录"}</dd></div>
          </dl>
        ) : <p className="excom-panel__note">当前没有待食用的料理。</p>}
      </section>
      <section>
        <div className="excom-panel__subtitle">酒虫酿造</div>
        <dl className="excom-panel__kv">
          <div className="excom-panel__kvrow"><dt>容器内容</dt><dd>{ferment}</dd></div>
          <div className="excom-panel__kvrow"><dt>发酵进度</dt><dd>{days > 0 ? `${state.brewDays ?? 0}/${days} 天` : "成品／无后续发酵"}</dd></div>
          <div className="excom-panel__kvrow"><dt>下一阶段</dt><dd>{target ?? "—"}</dd></div>
          <div className="excom-panel__kvrow"><dt>已知配方</dt><dd>{known}/{allBrewNames().length}</dd></div>
        </dl>
      </section>
      <section>
        <div className="excom-panel__subtitle">持有道具</div>
        {owned.length > 0 ? (
          <div className="excom-panel__items">
            {owned.map((item) => <div key={item.id}><span>{item.name}</span><span>×{item.count}</span></div>)}
          </div>
        ) : <p className="excom-panel__note">当前没有持有道具。</p>}
      </section>
      <section className="excom-panel__deferred" aria-disabled="true">
        <div className="excom-panel__subtitle">原版栏目（待建模）</div>
        <div>□ 保温容器与鲜度提示　□ 酒虫迁移　□ 道具分类筛选　□ 配方图鉴详情</div>
      </section>
    </div>
  );
}

function scheduleText(minute: number): string {
  if (minute <= 0) return "—";
  const value = ((Math.trunc(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** EXCOM 811 / HITOSAGASI_2 — current-map character information. */
function WhereaboutsView({ state, onTrackChara }: { state: GameState; onTrackChara?: (charaNum: number) => void }) {
  const result = resolveWhereabouts(state);
  if (!result.ok) {
    return <p className="excom-panel__note" data-testid="excom-whereabouts-blocked">{result.reason}</p>;
  }
  if (result.rows.length === 0) {
    return <p className="excom-panel__note" data-testid="excom-whereabouts-empty">当前地图没有可察觉的角色。</p>;
  }
  return (
    <div className="whereabouts" data-testid="excom-whereabouts-body">
      <div className="whereabouts__legend">当前地图 · MAP {result.mapId}　绿色=在住　蓝色=睡眠　橙色=工作　黄色=自由行动</div>
      <div className="whereabouts__rows" role="table" aria-label="所在地察觉角色列表">
        {result.rows.map((row) => (
          <button
            type="button"
            className="whereabouts__row"
            role="row"
            key={row.charaNum}
            data-chara={row.charaNum}
            data-testid="whereabouts-track"
            onClick={() => onTrackChara?.(row.charaNum)}
            disabled={!onTrackChara}
          >
            <span className={row.resident ? "whereabouts__name whereabouts__name--resident" : "whereabouts__name"}>{row.name}</span>
            <span className="whereabouts__mark">{row.commissionMark}</span>
            <span className={row.heart ? "whereabouts__heart" : "whereabouts__dim"}>{row.heart ? "♥" : "·"}</span>
            <span className={`whereabouts__relation whereabouts__relation--${row.relationTone}`}>{row.relation || "—"}</span>
            <span className={`whereabouts__safety whereabouts__safety--${row.safety}`}>
              {row.safety === "danger" ? "[危险]" : row.safety === "safe" ? "[安全]" : ""}
            </span>
            <span className="whereabouts__room">{row.roomId ?? "?"}</span>
            <span className={row.activity === "sleep" ? "whereabouts__place whereabouts__place--sleep" : "whereabouts__place"}>{row.location}</span>
            <span className={`whereabouts__activity whereabouts__activity--${row.activity}`}>
              {row.activity === "sleep" ? `就寝中:${row.activityValue}` : row.activity === "work" ? "工作中" : `积攒度:${row.activityValue}`}
            </span>
            <span className="whereabouts__schedule">
              睡{scheduleText(row.sleepMinute)}　起{scheduleText(row.wakeMinute)}　回{scheduleText(row.returnMinute)}
            </span>
            <span className="whereabouts__remaining">余{row.remainingMinutes}分</span>
            <span className={row.freeActionMinutes > 0 ? "whereabouts__free" : "whereabouts__dim"}>
              {row.freeActionMinutes > 0 ? `自由行动 ${row.freeActionMinutes}分` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const TITLES: Record<ExComTool, string> = {
  "ability-master": "能力显示（主角）",
  "ability-target": "能力显示",
  calendar: "日历",
  yogore: "污渍显示",
  living: "生活与物品",
  whereabouts: "所在地察觉",
};

export default function ExComPanel({
  state,
  tool,
  target,
  onClose,
  onTrackChara,
  onCancelAppointment,
}: {
  state: GameState;
  tool: ExComTool;
  /** charaNum for ability-target. */
  target?: number;
  onClose: () => void;
  onTrackChara?: (charaNum: number) => void;
  onCancelAppointment?: (eventId: string) => void;
}) {
  let body: React.ReactNode;
  if (tool === "ability-master") {
    body = <AbilityView slot={state.master.state} name="主角" isTarget={false} />;
  } else if (tool === "ability-target") {
    const slot = target !== undefined ? state.charas[target] : undefined;
    body = slot ? (
      <AbilityView slot={slot.state} name={slot.callName ?? `#${target}`} isTarget />
    ) : (
      <p className="excom-panel__note" data-testid="excom-no-target">未选择对象。</p>
    );
  } else if (tool === "calendar") {
    body = <CalendarDetails state={state} onCancelAppointment={onCancelAppointment} />;
  } else if (tool === "yogore") {
    body = <YogoreView state={state} />;
  } else if (tool === "whereabouts") {
    body = <WhereaboutsView state={state} onTrackChara={onTrackChara} />;
  } else {
    body = <LivingView state={state} />;
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="excom-panel__scrim" data-testid="excom-panel-scrim" onClick={onClose}>
      <div
        className={`excom-panel${tool === "whereabouts" ? " excom-panel--whereabouts" : ""}`}
        data-testid="excom-panel"
        role="dialog"
        aria-label={TITLES[tool]}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="excom-panel__head">
          <span className="excom-panel__title">{TITLES[tool]}</span>
          <button
            type="button"
            className="excom-panel__close"
            data-testid="excom-panel-close"
            onClick={onClose}
          >
            [关闭]
          </button>
        </div>
        <div className="excom-panel__bodywrap">{body}</div>
      </div>
    </div>,
    document.body,
  );
}
