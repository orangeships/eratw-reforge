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
import type { BanquetEventInstance, GameState } from "../../../modernization/runtime/state/index.js";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import NarrativeStatusPanel from "../ai/NarrativeStatusPanel.js";
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
  weekdayLabelZh,
  seasonOf,
  dateOf,
  monthName,
  projectCalendarAgenda,
} from "../../../modernization/runtime";
import {
  formatTemperature,
  currentTimezone,
  timezoneName,
} from "../../../modernization/runtime/state/weather.js";
import { getCurrentTemperature } from "../../../modernization/runtime/weather/temperature.js";
import {
  currentRegionWeather,
  formatRegionWeather,
} from "../../../modernization/runtime/weather/region-override.js";
import { resolveWhereabouts } from "../../../modernization/runtime/world/whereabouts.js";
import {
  buildAbilityGrid,
  type AbilityGridValueCell,
} from "../../../modernization/runtime/state/chara-info-state.js";
import type { CalendarAgendaItem } from "../../../modernization/runtime/world/calendar-agenda.js";

export type ExComTool = "ability-master" | "ability-target" | "calendar" | "yogore" | "living" | "whereabouts" | "l3-status";

const RELATION_LABELS = ["好感度", "信頼度", "情緒", "理性", "憤怒"] as const;

type Slot = GameState["master"]["state"];

function excomAbilityTone(value: number, maxRank: 6 | 99): string {
  const ratio = value / maxRank;
  if (value <= 0) return "ci-panel__ability-cell--zero";
  if (ratio >= 0.8) return "ci-panel__ability-cell--hi";
  if (ratio >= 0.4) return "ci-panel__ability-cell--mid";
  return "ci-panel__ability-cell--lo";
}

function ExComAbilityGrid({ grid }: { grid: AbilityGridValueCell[][] }) {
  return (
    <div className="ci-panel__ability-grid" data-testid="excom-ability-grid">
      {grid.map((row, ri) => (
        <div key={ri} className="ci-panel__ability-row">
          {row.map((cell, ci) => cell.kind === "placeholder" || cell.kind === "hidden" ? (
            <span key={ci} className="ci-panel__ability-cell ci-panel__ability-cell--empty" />
          ) : (
            <span key={ci} className={`ci-panel__ability-cell ${excomAbilityTone(cell.value ?? 0, cell.maxRank)}`}>
              <span className="ci-panel__ability-name">{cell.name}</span>
              <span className="ci-panel__ability-val">{cell.value ?? 0}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Base stats, status parameters, and the runtime-projected ability grid. */
function AbilityView({ slot, name, isTarget, abilityGrid }: { slot: Slot; name: string; isTarget: boolean; abilityGrid: AbilityGridValueCell[][] }) {
  return (
    <div className="excom-panel__ability" data-testid="excom-ability">
      <div className="excom-panel__who">{name}</div>
      <div className="excom-panel__ability-levels">
        <div className="excom-panel__subtitle">能力等级</div>
        <ExComAbilityGrid grid={abilityGrid} />
      </div>
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
    ["今天", `${monthName(seasonOf(time))}${dateOf(time)}日（${weekdayLabelZh(time.dayIndex)}）`],
    ["时刻", `${timezoneName(currentTimezone(time.hourOfDay))} ${hh}:${mm}`],
    ["天气", `${formatRegionWeather(regionWeather)} · ${formatTemperature(getCurrentTemperature(state))}`],
  ];
  const upcoming = projectCalendarAgenda(state, 7);
  const distantBanquet = (state.worldEvents ?? [])
    .filter((event): event is BanquetEventInstance => event.kind === "banquet"
      && event.phase !== "resolved"
      && event.phase !== "cancelled"
      && Math.floor(event.scheduledStartTick / 1440) >= time.dayIndex + 7)
    .sort((a, b) => a.scheduledStartTick - b.scheduledStartTick)[0];
  const distantBanquetDay = distantBanquet
    ? projectCalendarAgenda(state, Math.floor(distantBanquet.scheduledStartTick / 1440) - time.dayIndex + 1).at(-1)
    : undefined;
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
      <div className="excom-panel__calendar-wrap" data-testid="excom-calendar-upcoming">
        <table className="excom-panel__calendar-table">
          <thead><tr><th>日期</th><th>活动安排 / 参与角色</th></tr></thead>
          <tbody>{upcoming.map((day) => (
            <tr key={day.dayIndex} className={day.dayIndex === time.dayIndex ? "is-today" : undefined}>
              <th scope="row"><strong>{day.date}日</strong><small>{weekdayLabelZh(day.dayIndex)}</small></th>
              <td>
                {day.items.length === 0 ? <span className="excom-panel__calendar-empty">—</span> : groupCalendarItems(day.items).map((group) => {
                  const item = group.items[0]!;
                  const participants = group.items.flatMap((agendaItem) => agendaItem.participantIds.map((id) => ({
                    key: `${agendaItem.id}:${id}`,
                    name: calendarParticipantName(state, id),
                    title: [calendarTimeLabel(agendaItem), agendaItem.location ?? ""]
                      .filter(Boolean).join(" · "),
                  })));
                  return (
                    <div key={group.key} className={`excom-panel__calendar-item excom-panel__calendar-item--${group.kind}`}>
                      <span className="excom-panel__calendar-label">【{group.label}】</span>
                      {participants.length > 0 && (
                        <span className="excom-panel__calendar-participants">
                          {participants.map((participant) => (
                            <span key={participant.key} className="excom-panel__calendar-person" title={participant.title || undefined}>
                              {participant.name}
                            </span>
                          ))}
                        </span>
                      )}
                      {item.kind === "narrative" && (item.arcId || item.narrativeStatus) && (
                        <span className="excom-panel__calendar-meta">
                          {[item.arcId ? "剧情线" : "", item.narrativeStatus ?? ""].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {item.kind === "date" && item.worldEventId && onCancelAppointment && (
                        <button
                          type="button"
                          data-testid={`cancel-date-${item.worldEventId}`}
                          onClick={() => onCancelAppointment(item.worldEventId!)}
                        >[取消]</button>
                      )}
                    </div>
                  );
                })}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {distantBanquet && distantBanquetDay && (
        <p className="excom-panel__calendar-distant" data-testid="excom-calendar-distant-banquet">
          远期宴会　{distantBanquetDay.date}日（{weekdayLabelZh(distantBanquetDay.dayIndex)}）　
          {minuteLabel(distantBanquet.scheduledStartTick % 1440)}　{distantBanquet.venue}
        </p>
      )}
    </div>
  );
}

function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function calendarTimeLabel(item: CalendarAgendaItem): string {
  if (item.startMinute === undefined) return "";
  const start = minuteLabel(item.startMinute);
  return item.endMinute === undefined ? start : `${start}–${minuteLabel(item.endMinute)}`;
}

interface CalendarAgendaGroup {
  key: string;
  kind: CalendarAgendaItem["kind"];
  label: string;
  items: CalendarAgendaItem[];
}

function groupCalendarItems(items: CalendarAgendaItem[]): CalendarAgendaGroup[] {
  const groups: CalendarAgendaGroup[] = [];
  const workGroups = new Map<string, CalendarAgendaGroup>();
  for (const item of items) {
    if (item.kind !== "work") {
      groups.push({ key: item.id, kind: item.kind, label: item.label, items: [item] });
      continue;
    }
    const key = `${item.kind}:${item.label}`;
    const group = workGroups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      const next = { key, kind: item.kind, label: item.label, items: [item] };
      workGroups.set(key, next);
      groups.push(next);
    }
  }
  return groups;
}

function calendarParticipantName(state: GameState, charaNum: number): string {
  return charaNum === 0 ? state.master.callName ?? "主人公" : state.charas[charaNum]?.callName ?? `#${charaNum}`;
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
  "l3-status": "L3 剧情状态 / 调试",
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
    body = <AbilityView slot={state.master.state} name="主角" isTarget={false} abilityGrid={buildAbilityGrid(state, 0)} />;
  } else if (tool === "ability-target") {
    const slot = target !== undefined ? state.charas[target] : undefined;
    body = slot ? (
      <AbilityView slot={slot.state} name={slot.callName ?? `#${target}`} isTarget abilityGrid={buildAbilityGrid(state, slot.charaNum)} />
    ) : (
      <p className="excom-panel__note" data-testid="excom-no-target">未选择对象。</p>
    );
  } else if (tool === "l3-status") {
    body = <NarrativeStatusPanel state={state} />;
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
        className={`excom-panel${tool === "whereabouts" ? " excom-panel--whereabouts" : ""}${tool === "calendar" ? " excom-panel--calendar" : ""}${tool === "l3-status" ? " excom-panel--l3" : ""}`}
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
