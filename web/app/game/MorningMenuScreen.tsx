import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import { SAVE_SLOTS, type SaveSlot, type SlotInfo } from "../ipc/tauri-bridge.js";
import {
  getCleanlinessLabel,
  getNamedStat,
  masterWakeMinute,
  weekdayLabelZh,
  seasonOf,
  dateOf,
  monthName,
  festivalOf,
} from "../../../modernization/runtime";
import {
  SHOP_CATALOG,
  catalogEntry,
  type ShopBuyResult,
  type ShopCatalogEntry,
} from "../../../modernization/runtime/state/shop.js";
import { ITEM_ID, itemCount } from "../../../modernization/runtime/state/items.js";
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
import { weatherBackgroundStyle } from "../../../modernization/runtime/weather/background-color.js";
import ExComPanel, { CalendarDetails } from "./ExComPanel.js";
import { RESIDENCE_OPTIONS, type ResidenceOption } from "./pre/newgame-draft.js";
import { regionByMapName } from "./pre/residence-data.js";
import ResidencePicker from "./pre/ResidencePicker.js";
import { usePresentationMode } from "../state/presentation-mode.js";
import { getCharaCflag, CFLAG_ID, FLAG_ID, TALENT_ID } from "../../../modernization/runtime/state/settlement.js";
import { OMANEKI_PLACE } from "../../../modernization/runtime/world/omaneki.js";
import { buildGiftHistory, type GiftHistoryRow } from "../../../modernization/runtime/state/gifts.js";
import { getMasterCflag } from "../../../modernization/runtime/state/settlement.js";
import OptionsDialog from "./OptionsDialog.js";
import { BUG_CATALOG, MUSHI_MAX_CAGE } from "../../../modernization/runtime/state/bug-catching.js";
import { FISH_CATALOG } from "../../../modernization/runtime/state/fishing.js";
import {
  listPantyCollection,
  listPantyCollectionBonuses,
  pantyPieceName,
} from "../../../modernization/runtime/state/panty-collection.js";
import { GATHERING_SPOT_1_ITEMS, gatheringPower } from "../../../modernization/runtime/state/gathering.js";
import { usableMasterConsumables } from "../../../modernization/runtime/command/handlers/item-use.js";
import itemsBundle from "./items.bundle.json";
import dishesBundle from "./dishes.bundle.json";
import PortraitVariantPicker from "./PortraitVariantPicker.js";
import { useGameStateStore } from "../state/game-state-store.js";
import type { AgentNightCharaProgress } from "../ai/agent-night.js";
import ManualNarrativePanel from "../ai/ManualNarrativePanel.js";
import { useAiStore } from "../ai/store.js";

type PanelKind =
  | "ability"
  | "residence"
  | "gap-shop"
  | "inventory"
  | "collection"
  | "special-dishes"
  | "gathering-list"
  | "fishing-list"
  | "bug-list"
  | "save"
  | "calendar"
  | "move-home"
  | "gifts"
  | "reset-commission"
  | "reset-clothes"
  | "portrait-update"
  | "option"
  | "manual-narrative"
  | "l3-status";

interface Props {
  state: GameState;
  lastSavedAt?: number | null;
  initialPanel?: PanelKind | null;
  onOpenEyes: () => void;
  /** SAVE/LOAD 页面 — 3 存档位. */
  onSaveSlot?: (slot: SaveSlot) => void | boolean | Promise<void | boolean>;
  onLoadSlot?: (slot: SaveSlot) => void | boolean | Promise<void | boolean>;
  onRefreshSlots?: () => void | Promise<void>;
  saveSlots?: SlotInfo[] | null;
  onBuyCatalogItem?: (itemId: number, qty?: number) => ShopBuyResult;
  onUseInventoryItem?: (itemId: number) => { ok: boolean; message: string };
  onSetWakeMinute?: (minute: number) => void;
  onSetHomeLocation?: (homeLocation: string) => void;
  onResetCommissions?: () => { resetSlots: number; resetFlags: number };
  onResetClothes?: () => { resetNpcs: number; resetCoords: number };
  onReleaseBug?: (id: string) => boolean;
  onMaterializeBug?: (id: string) => boolean;
  /** Flip `FLAG:立絵種類` (OPTION [3] 角色绘的类型 — 立絵↔顔絵). Optional;
   *  when absent the OPTION [3] row renders read-only. */
  onTogglePortraitKind?: () => void;
  /** Persist a per-character portrait package selection (CFLAG 564). */
  onSetPortraitVariant?: (charaNum: number, variantId: number) => void;
  /** Toggle FLAG:87, the upstream automatic collection-gap transfer mode. */
  onTogglePantyGapAuto?: () => void;
  /** Claim one earned SHOP/BONUS2 panty collection milestone. */
  onClaimPantyCollectionBonus?: (id: number) => boolean;
  /** Sell duplicate permanent panties, retaining one of each species. */
  onSellPantyDuplicates?: () => number;
  /** 手动触发 L3 叙事导演，可选玩家自定义意图 */
  onTriggerManualNarrative?: (playerIntent?: string) => Promise<boolean>;
}

interface MenuCommand {
  code: number;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  reason?: string;
  dlc?: boolean;
  /** 未接入 / 暂不上菜单的入口. 定义连同 reason 一起保留, 日后放回只需去掉这一行. */
  hidden?: boolean;
}

function formatLocation(loc: string): string {
  const idx = loc.indexOf(":");
  if (idx < 0) return loc;
  const area = loc.slice(0, idx);
  const room = loc.slice(idx + 1);
  const areaNames: Record<string, string> = { 神社: "博丽神社" };
  return `${areaNames[area] ?? area} - ${room}`;
}

function timeText(state: GameState): string {
  const minuteOfDay = ((state.time.tickValue % 1440) + 1440) % 1440;
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function minuteText(minute: number): string {
  const normalized = ((Math.trunc(minute) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
  const mm = String(normalized % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function StatLine({
  state,
  label,
}: {
  state: GameState["master"]["state"];
  label: string;
}) {
  const { value, max } = getNamedStat(state, label);
  const fill = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="morning-menu__statline">
      <span className="morning-menu__statlabel">{label}</span>
      <span
        className="morning-menu__bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, max)}
        aria-valuenow={Math.max(0, value)}
      >
        <span className="morning-menu__bar-fill" style={{ width: `${fill}%` }} />
      </span>
      <span className="morning-menu__statnum">
        （{value} / {max}）
      </span>
    </div>
  );
}

function CommandButton({ command }: { command: MenuCommand }) {
  const disabled = command.disabled || !command.onClick;
  return (
    <button
      type="button"
      className={
        "morning-menu__command" +
        (command.dlc ? " morning-menu__command--dlc" : "") +
        (disabled ? " morning-menu__command--disabled" : "")
      }
      data-testid="morning-menu-command"
      data-command-code={command.code}
      disabled={disabled}
      title={command.reason}
      onClick={command.onClick}
    >
      <span className="morning-menu__command-code">[{command.code}]</span>
      <span className="morning-menu__command-dash">－</span>
      <span className="morning-menu__command-label">{command.label}</span>
    </button>
  );
}

function CommandSection({
  title,
  commands,
}: {
  title: string;
  commands: MenuCommand[];
}) {
  // hidden 的入口整条不渲染 (含分区只剩 hidden 时连标题一起收掉), 但
  // disabled 仍照旧渲染 —— 那类是按运行时状态开关的, 玩家需要看得见.
  const visible = commands.filter((command) => !command.hidden);
  if (visible.length === 0) return null;
  return (
    <section className="morning-menu__section">
      <h2>【{title}】</h2>
      <div className="morning-menu__commands">
        {visible.map((command) => (
          <CommandButton key={command.code} command={command} />
        ))}
      </div>
    </section>
  );
}

// ── 睁眼等待门 — agent-night sidecar progress ────────────────────────────────
//
// While the background night cycle (character reflections/diaries/plans) is
// still running, day-break waits. The block shows what the system is doing
// per character plus the classic generic loading line; after NIGHT_SKIP_DELAY_MS
// a 「不再等待」 escape hatch appears (per failure fallback decision).

const NIGHT_STATUS_DOT_FRAMES = 4;
const NIGHT_STATUS_FRAME_MS = 400;
const NIGHT_SKIP_DELAY_MS = 30_000;

function nightCharaPhaseText(entry: AgentNightCharaProgress): string | null {
  if (entry.phase === "reflecting") return `${entry.name}正在回想一天的经历`;
  if (entry.phase === "reviewing") return `${entry.name}正在整理反思`;
  if (entry.phase === "judging-diary") return `${entry.name}正在考虑是否写日记`;
  if (entry.phase === "writing") return `${entry.name}正在写日记`;
  // failed — the character slept through their reflection; no line to show.
  return null;
}

function NightCycleStatusBlock({
  entries,
  onSkip,
}: {
  entries: readonly AgentNightCharaProgress[];
  /** Cancel the night cycle and wake up anyway (「不再等待」). */
  onSkip: () => void;
}) {
  // Dots advance through React state, not CSS animation, so the text stays
  // test-observable (same rationale as GatheringProgress).
  const [frame, setFrame] = useState(1);
  const [showSkip, setShowSkip] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => (current % NIGHT_STATUS_DOT_FRAMES) + 1);
    }, NIGHT_STATUS_FRAME_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowSkip(true), NIGHT_SKIP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      className="morning-menu__night-status"
      data-testid="morning-night-status"
      role="status"
      aria-live="polite"
    >
      <p data-testid="morning-night-status-generic">少女祈祷中{".".repeat(frame)}</p>
      {entries.map((entry) => {
        const text = nightCharaPhaseText(entry);
        return text
          ? <p key={entry.charaNum} data-testid="morning-night-status-chara">{text}</p>
          : null;
      })}
      {showSkip && (
        <button
          type="button"
          className="morning-menu__night-skip"
          data-testid="morning-night-skip"
          onClick={onSkip}
        >
          不再等待，直接天亮
        </button>
      )}
    </div>
  );
}

function PanelShell({
  title,
  variant,
  children,
  onClose,
}: {
  title: string;
  variant?: "calendar";
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="morning-menu__modal-scrim" data-testid="morning-menu-panel" onClick={onClose}>
      <div
        className={`morning-menu__modal${variant === "calendar" ? " morning-menu__modal--calendar" : ""}`}
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="morning-menu__modal-head">
          <span>{title}</span>
          <button type="button" data-testid="morning-panel-close" onClick={onClose}>
            [关闭]
          </button>
        </div>
        <div className="morning-menu__modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Save-slot info line, faithful to eraTW `@createSaveInfo` (`INFO.ERB:260`):
 * `第{N}日（{月之名}{日}日） · {地点} · {主角名}`. The upstream also prepends a
 * real-world timestamp + version; the real-time part is shown separately as
 * 「上次存档」, the version is omitted (single modern build).
 */
function formatSaveInfo(state: GameState): string {
  const t = state.time;
  const dayLabel = `第${t.dayIndex + 1}日（${monthName(seasonOf(t))}${dateOf(t)}日）`;
  const place = state.master.location || "未知地点";
  const name = state.master.callName ?? "主人公";
  return `${dayLabel} · ${place} · ${name}`;
}

/** One slot's saved-content label. Empty slot → 「空存档位」. */
function slotLabel(info: SlotInfo | undefined): string {
  if (!info || !info.exists) return "空存档位";
  const s = info.summary;
  if (!s) return "已有存档（详情未知）";
  return `第${s.day}日 · ${s.place || "未知地点"} · ${s.name || "主人公"}`;
}

function SaveSlotRow({
  slot,
  info,
  currentInfo,
  onSave,
  onLoad,
}: {
  slot: SaveSlot;
  info: SlotInfo | undefined;
  currentInfo: string;
  onSave: (slot: SaveSlot) => void | Promise<void>;
  onLoad?: (slot: SaveSlot) => void | Promise<void>;
}) {
  // Two-click confirms so a stray tap can't overwrite / discard a run.
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const exists = !!info?.exists;
  const savedText = info?.savedAt ? new Date(info.savedAt).toLocaleString() : "";

  return (
    <div className="morning-menu__save-slot" data-testid="morning-save-slot" data-slot={slot}>
      <span className="morning-menu__command-code">存档位 {slot}</span>
      <span className="morning-menu__save-slot-main">
        <strong data-testid="morning-save-slot-label">{slotLabel(info)}</strong>
        <small>{savedText ? `存档时间：${savedText}` : "（此存档位为空）"}</small>
      </span>
      <span className="morning-menu__save-slot-actions">
        <button
          type="button"
          data-testid="morning-save-slot-button"
          onClick={() => {
            // Confirm only when about to overwrite an existing slot.
            if (exists && !confirmSave) {
              setConfirmSave(true);
              return;
            }
            setConfirmSave(false);
            void onSave(slot);
          }}
          title={`将当前进度（${currentInfo}）存入存档位 ${slot}`}
        >
          {exists && confirmSave ? "确认覆盖" : "存档"}
        </button>
        <button
          type="button"
          data-testid="morning-load-slot-button"
          disabled={!onLoad || !exists}
          onClick={() => {
            if (!onLoad || !exists) return;
            if (!confirmLoad) {
              setConfirmLoad(true);
              return;
            }
            setConfirmLoad(false);
            void onLoad(slot);
          }}
          title={exists ? `读取存档位 ${slot}` : "空存档位无法读取"}
        >
          {confirmLoad ? "确认读档" : "读档"}
        </button>
      </span>
    </div>
  );
}

function SavePanel({
  currentInfo,
  slots,
  onRefresh,
  onSave,
  onLoad,
}: {
  currentInfo: string;
  slots?: SlotInfo[] | null;
  onRefresh?: () => void | Promise<void>;
  onSave: (slot: SaveSlot) => void | Promise<void>;
  onLoad?: (slot: SaveSlot) => void | Promise<void>;
}) {
  // Pull the 3 slots' metadata when the page opens (and after a save the store
  // pushes fresh `slots` in).
  useEffect(() => {
    void onRefresh?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bySlot = new Map((slots ?? []).map((s) => [s.slot, s] as const));
  return (
    <div className="morning-menu__save-panel" data-testid="morning-save-panel">
      <p className="morning-menu__message">
        SAVE / LOAD 页面：3 个存档位，各自独立。「继续游戏」会读取最近一次存档的存档位。
      </p>
      {/* 当前进度 — faithful to eraTW @createSaveInfo (INFO.ERB:260):
          第N日 · 地点 · 主角名. */}
      <p className="morning-menu__save-info" data-testid="morning-save-info">
        当前进度：{currentInfo}
      </p>
      {SAVE_SLOTS.map((slot) => (
        <SaveSlotRow
          key={slot}
          slot={slot}
          info={bySlot.get(slot)}
          currentInfo={currentInfo}
          onSave={onSave}
          onLoad={onLoad}
        />
      ))}
    </div>
  );
}

function ResidencePanel({
  state,
  onSetWakeMinute,
  onSetHomeLocation,
}: {
  state: GameState;
  onSetWakeMinute?: (minute: number) => void;
  onSetHomeLocation?: (homeLocation: string) => void;
}) {
  const wake = masterWakeMinute(state);
  const wakeChoices = [360, 420, 480, 540, 600, 720];
  const currentOption = RESIDENCE_OPTIONS.find((option) => option.value === state.homeLocation);
  const currentRegion = currentOption ? regionByMapName(currentOption.mapName) : undefined;
  const defaultOption =
    (currentRegion && RESIDENCE_OPTIONS.find((option) => option.mapName === currentRegion.mapName)) ??
    RESIDENCE_OPTIONS[0];
  const cohabitationCandidates = Object.values(state.charas)
    .filter((slot) => {
      const resident = (slot.state.CFLAG[CFLAG_ID.神社在住] ?? 0) !== 0;
      const lover =
        (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 ||
        (slot.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0;
      return slot.charaNum > 0 && resident && lover && !!slot.homeLocation;
    })
    .sort((a, b) => a.charaNum - b.charaNum);

  return (
    <div data-testid="morning-residence-panel">
      <dl className="morning-menu__kv">
        <div>
          <dt>住址</dt>
          <dd>{state.homeLocation ? formatLocation(state.homeLocation) : "未设置"}</dd>
        </div>
        <div>
          <dt>起床时间</dt>
          <dd>{minuteText(wake)}</dd>
        </div>
        <div>
          <dt>调整起床时间</dt>
          <dd className="morning-menu__choice-row">
            {wakeChoices.map((minute) => (
              <button
                key={minute}
                type="button"
                data-testid="morning-wake-choice"
                className={minute === wake ? "morning-menu__choice morning-menu__choice--active" : "morning-menu__choice"}
                disabled={!onSetWakeMinute}
                onClick={() => onSetWakeMinute?.(minute)}
              >
                {minuteText(minute)}
              </button>
            ))}
          </dd>
        </div>
      </dl>

      <section className="morning-menu__cohabitation" data-testid="morning-cohabitation">
        <p className="morning-menu__section-title">私室设定／同居</p>
        <p className="morning-menu__note">
          这里对应原版 SCHEDULE：只能回到当前地区的默认私室，或搬进已经取得「恋慕／爱欲」且标记为神社在住的角色房间。变更从翌日起生效。
        </p>
        <div className="morning-menu__choice-col">
          {defaultOption && (
            <button
              type="button"
              data-testid="morning-residence-default"
              data-location={defaultOption.value}
              className={defaultOption.value === state.homeLocation ? "morning-menu__choice morning-menu__choice--active" : "morning-menu__choice"}
              disabled={!onSetHomeLocation}
              onClick={() => onSetHomeLocation?.(defaultOption.value)}
            >
              默认私室：{defaultOption.label} - {defaultOption.roomName}
            </button>
          )}
          {cohabitationCandidates.length === 0 ? (
            <p className="morning-menu__note">目前没有满足同居条件的角色。</p>
          ) : (
            cohabitationCandidates.map((slot) => (
              <button
                key={slot.charaNum}
                type="button"
                data-testid="morning-cohab-choice"
                data-location={slot.homeLocation}
                className={slot.homeLocation === state.homeLocation ? "morning-menu__choice morning-menu__choice--active" : "morning-menu__choice"}
                disabled={!onSetHomeLocation}
                onClick={() => slot.homeLocation && onSetHomeLocation?.(slot.homeLocation)}
              >
                与{slot.callName ?? `角色${slot.charaNum}`}同居：{formatLocation(slot.homeLocation ?? "")}
              </button>
            ))
          )}
        </div>
      </section>
      <p className="morning-menu__note">
        家是场景内部的房间（睡觉／回家的位置）；起床时间会影响下一次睡眠结算；安眠枕／桐木床的恢复补正已按持有道具生效。
      </p>
    </div>
  );
}

function buyDisabledReason(state: GameState, entry: ShopCatalogEntry): string | null {
  const owned = itemCount(state, entry.id);
  if (owned >= 999) return "已达所持上限";
  if (entry.sales === "unique" && owned > 0) return "已拥有";
  if (entry.sales === "limited") {
    const stock = state.itemSales?.[entry.id] ?? 0;
    if (stock <= 0) return "今日未入荷（补货流程未接）";
  }
  if (state.money < entry.price) return "所持金不足";
  return null;
}

function stockText(state: GameState, entry: ShopCatalogEntry): string {
  if (entry.sales === "infinite") return "常备";
  if (entry.sales === "unique") return itemCount(state, entry.id) > 0 ? "已拥有" : "一次限购";
  const stock = state.itemSales?.[entry.id] ?? 0;
  return stock > 0 ? `库存 ${stock}` : "未入荷";
}

function GapShopPanel({
  state,
  onBuyCatalogItem,
}: {
  state: GameState;
  onBuyCatalogItem?: (itemId: number, qty?: number) => ShopBuyResult;
}) {
  const [message, setMessage] = useState("通信贩卖目录已接入一部分；DLC/特殊商店暂不显示。");
  const entries = SHOP_CATALOG
    // The shared catalog may expose the same inventory item through several
    // upstream shop categories. The gap-shop screen is item-centric, so one
    // row per item avoids duplicate React identities and duplicate purchases.
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index);
  const categories = ["全部", ...new Set(entries.map((entry) => entry.category || "其他"))];
  const [category, setCategory] = useState(categories[0]!);
  const visibleEntries = category === "全部"
    ? entries
    : entries.filter((entry) => (entry.category || "其他") === category);
  const buyOne = (entry: ShopCatalogEntry): void => {
    if (!onBuyCatalogItem) return;
    const result = onBuyCatalogItem(entry.id, 1);
    if (result.ok) {
      setMessage(`购买成功：${entry.name} ×1，花费 ${result.total.toLocaleString()} 円。`);
    } else {
      setMessage(`无法购买：${entry.name}。`);
    }
  };
  return (
    <div className="morning-menu__shop" data-testid="morning-gap-shop">
      <p className="morning-menu__message">{message}</p>
      <div className="morning-menu__shop-tabs" role="tablist" aria-label="商品分类">
        {categories.map((label) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={category === label}
            className={category === label ? "is-active" : undefined}
            onClick={() => setCategory(label)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="morning-menu__shop-list">
        {visibleEntries.map((entry) => {
          const reason = buyDisabledReason(state, entry);
          return (
            <div key={entry.id} className="morning-menu__shop-row">
              <span className="morning-menu__shop-name">{entry.name}</span>
              <span className="morning-menu__shop-meta">{entry.category}</span>
              <span className="morning-menu__shop-meta">{stockText(state, entry)}</span>
              <span className="morning-menu__shop-price">{entry.price.toLocaleString()}円</span>
              <button
                type="button"
                data-testid="morning-shop-buy"
                disabled={!!reason || !onBuyCatalogItem}
                title={reason ?? undefined}
                onClick={() => buyOne(entry)}
              >
                购买1个
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InventoryPanel({
  state,
  onUseItem,
}: {
  state: GameState;
  onUseItem?: (itemId: number) => { ok: boolean; message: string };
}) {
  const [message, setMessage] = useState("");
  const usableIds = useMemo(() => new Set(usableMasterConsumables(state).map((item) => item.id)), [state]);
  const owned = useMemo(
    () =>
      Object.entries(state.items ?? {})
        .map(([id, count]) => ({ id: Number(id), count }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => a.id - b.id),
    [state.items],
  );
  return (
    <div className="morning-menu__inventory" data-testid="morning-inventory">
      {owned.length === 0 ? (
        <p className="morning-menu__note">当前没有持有道具。</p>
      ) : (
        owned.map(({ id, count }) => {
          // 三级 fallback: SHOP_CATALOG(可买物) → items.bundle.csv 全表 → #N
          const bundle = itemsBundle as { byId: Record<string, { name?: string } | undefined> };
          const name =
            catalogEntry(id)?.name ??
            bundle.byId[String(id)]?.name ??
            `未命名道具 #${id}`;
          return (
            <div key={id} className="morning-menu__list-row">
              <span>{name}</span>
              <span>×{count}</span>
              {usableIds.has(id) && (
                <button
                  type="button"
                  data-testid="morning-inventory-use"
                  disabled={!onUseItem}
                  onClick={() => {
                    const result = onUseItem?.(id);
                    if (result) setMessage(result.message);
                  }}
                >
                  使用
                </button>
              )}
            </div>
          );
        })
      )}
      <p className="morning-menu__note">
        ※ 「使用」只会出现在 COMF490 效果已确定的道具旁；其他道具保留但不会被误消费。
      </p>
      {message && <p className="morning-menu__message" data-testid="morning-inventory-message">{message}</p>}
    </div>
  );
}

/** SHOP [105] SHOW_COLLECTION — permanent collection + PANTS_TEMP viewer. */
function CollectionPanel({
  state,
  onTogglePantyGapAuto,
  onClaimPantyCollectionBonus,
  onSellPantyDuplicates,
}: {
  state: GameState;
  onTogglePantyGapAuto?: () => void;
  onClaimPantyCollectionBonus?: (id: number) => boolean;
  onSellPantyDuplicates?: () => number;
}) {
  const rows = listPantyCollection(state);
  const permanentRows = rows.filter((row) => row.source === "permanent");
  const species = state.flagStore[FLAG_ID.獲得胖次種数] ?? permanentRows.length;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const duplicateCount = permanentRows.reduce((sum, row) => sum + Math.max(0, row.count - 1), 0);
  const gapCharges = itemCount(state, ITEM_ID.收藏隙間);
  const gapAuto = (state.flagStore[FLAG_ID.C隙間自動仕様] ?? 0) !== 0;
  const bonuses = listPantyCollectionBonuses(state);
  return (
    <div className="morning-menu__inventory" data-testid="morning-collection">
      <p>收集种数：{species}　总数：{total}</p>
      <p>收藏隙间：{gapCharges}　随身运输：{rows.filter((row) => row.source === "transit").length}种</p>
      <button
        type="button"
        className="morning-menu__choice"
        data-testid="morning-collection-toggle-auto"
        disabled={!onTogglePantyGapAuto}
        onClick={() => onTogglePantyGapAuto?.()}
      >
        自动放入收藏隙间：{gapAuto ? "开" : "关"}
      </button>
      <button
        type="button"
        className="morning-menu__choice"
        data-testid="morning-collection-sell-duplicates"
        disabled={duplicateCount === 0 || !onSellPantyDuplicates}
        onClick={() => onSellPantyDuplicates?.()}
      >
        卖出重复胖次：{duplicateCount}条（￥{duplicateCount * 100}）
      </button>
      {rows.length === 0 ? <p>收藏柜还是空的。</p> : rows.map((row) => (
        <div className="morning-menu__list-row" key={`${row.charaNum}:${row.pieceId}:${row.source}`}>
          <span>{row.name}的{pantyPieceName(state, row.charaNum, row.pieceId)}{row.source === "transit" ? "（随身）" : ""}</span><span>×{row.count}</span>
        </div>
      ))}
      <div className="morning-menu__subsection" data-testid="morning-collection-bonuses">
        <p>胖次收集奖励</p>
        {bonuses.map((bonus) => (
          <div className="morning-menu__list-row" key={bonus.id}>
            <span>[{bonus.id}] {bonus.threshold}种：{bonus.label}{bonus.claimed ? "（已取得）" : ""}</span>
            <button
              type="button"
              className="morning-menu__choice"
              data-testid={`morning-collection-bonus-${bonus.id}`}
              disabled={bonus.claimed || !bonus.available || !onClaimPantyCollectionBonus}
              onClick={() => onClaimPantyCollectionBonus?.(bonus.id)}
            >
              {bonus.claimed ? "已取得" : bonus.available ? "领取" : "未达成"}
            </button>
          </div>
        ))}
      </div>
      <p className="morning-menu__note">※ 永久收藏与随身运输都按原版状态显示；回家可用 [401] 收藏，外出时消耗收藏隙间次数。</p>
    </div>
  );
}

/** SHOP [111] SHOW_SP_DISH_LIST — learned/practice progress backed by LEARNED_MENU. */
function SpecialDishPanel({ state }: { state: GameState }) {
  const dishes = (dishesBundle as { dishes: Record<string, { name: string; spChara?: number }> }).dishes;
  const rows = Object.values(state.charas)
    .map((slot) => {
      const dish = dishes[String(400 + slot.charaNum)];
      return dish ? { slot, dish, progress: state.learnedMenu?.[slot.charaNum] ?? 0 } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.slot.charaNum - b.slot.charaNum);
  return (
    <div className="morning-menu__inventory" data-testid="morning-special-dishes">
      {rows.map(({ slot, dish, progress }) => (
        <div className="morning-menu__list-row" key={slot.charaNum}>
          <span>{slot.callName ?? `#${slot.charaNum}`}　「{dish.name}」</span>
          <span>{progress >= 100 ? "习得" : `练习 ${Math.max(0, progress)}/100`}</span>
        </div>
      ))}
      <p className="morning-menu__note">※ 习得状态直接读取料理练习写入的 LEARNED_MENU；不会把未练习的料理标成已学会。</p>
    </div>
  );
}

/** SHOP [410] — the currently implemented GATHERING_PRODUCT spot. */
function GatheringListPanel({ state }: { state: GameState }) {
  const power = gatheringPower(state);
  return (
    <div className="morning-menu__inventory" data-testid="morning-gathering-list">
      <p>采集点 1：镇守之森／妖精的大树　当前采集力 {power}</p>
      {GATHERING_SPOT_1_ITEMS.map((item) => {
        const need = Math.floor(Math.sqrt(item.price + 1000));
        return (
          <div className="morning-menu__list-row" key={item.id}>
            <span>{item.name}</span>
            <span>{power >= need ? "可发现" : `需要采集力 ${need}`}　持有×{itemCount(state, item.id)}</span>
          </div>
        );
      })}
      <p className="morning-menu__note">※ 当前仅 spot 1 有完整掉落表；其余地点不会在这里伪造条目。</p>
    </div>
  );
}

/** SHOP [108] — persisted fishing records written by finishFishingSession. */
function FishingListPanel({ state }: { state: GameState }) {
  const gear = state.fishingGear;
  const catchCounts = gear?.catchCounts ?? {};
  const discovered = FISH_CATALOG.filter((fish) => (catchCounts[fish.id] ?? 0) > 0).length;
  return (
    <div className="morning-menu__inventory" data-testid="morning-fishing-list">
      <p>总钓获：{gear?.catches ?? 0}　鱼类图鉴：{discovered} / {FISH_CATALOG.length}</p>
      {FISH_CATALOG.map((fish) => {
        const count = catchCounts[fish.id] ?? 0;
        const best = gear?.bestSizes?.[fish.id] ?? 0;
        return (
          <div className="morning-menu__list-row" key={fish.id}>
            <span>{count > 0 ? fish.name : "？？？"}</span>
            <span>{count > 0 ? `钓获 ×${count}${best > 0 ? `　最大 ${best} cm` : ""}` : "未发现"}</span>
          </div>
        );
      })}
      <p className="morning-menu__note">※ 木材、护符、青蛙等非鱼收获会计入总钓获；现有存档结构不记录它们的分类次数，因此不会伪造分项统计。</p>
    </div>
  );
}

/** SHOP [110] — faithful MUSHI_CAGE / MUSHI_COLLECT read view. */
function BugListPanel({ state, onRelease, onMaterialize }: { state: GameState; onRelease?: (id: string) => boolean; onMaterialize?: (id: string) => boolean }) {
  const byNum = new Map(BUG_CATALOG.map((bug) => [bug.num, bug]));
  const cage = state.bugCage ?? [];
  const collected = state.bugCollection ?? {};
  const discovered = Object.keys(collected).length;
  return (
    <div className="morning-menu__inventory" data-testid="morning-bug-list">
      <p>虫笼：{cage.length} / {MUSHI_MAX_CAGE}　图鉴：{discovered} / {BUG_CATALOG.length}</p>
      {state.bugTrap && (
        <p data-testid="morning-bug-trap">
          诱捕装置：{state.bugTrap.location}　诱饵 {state.bugTrap.baitName}（{"☆".repeat(state.bugTrap.baitQuality)}）
          {state.bugTrap.caughtBugNum !== undefined ? "　有虫上钩了，回到该地点用「设置陷阱」领取。" : "　等待虫子上钩中。"}
        </p>
      )}
      {cage.length === 0 ? <p>虫笼里空空如也。捕虫后会自动收纳到这里。</p> : (
        <ul>
          {cage.map((caught, index) => {
            const bug = byNum.get(caught.bugNum);
            return <li key={caught.id}>【{index + 1}】{bug?.name ?? `未知虫种 #${caught.bugNum}`}　稀有度{bug?.rarity ?? "?"}　Rank {caught.rank}{caught.gType ? " G型" : ""}{caught.xType ? " X型" : ""}
              {onRelease && <button type="button" onClick={() => onRelease(caught.id)}>放生</button>}
              {onMaterialize && <button type="button" onClick={() => onMaterialize(caught.id)}>做成素材</button>}
            </li>;
          })}
        </ul>
      )}
      <p>图鉴会在首次捕获时登记；放生/素材化可直接操作。斗虫编队仍将在后续操作页开放。</p>
    </div>
  );
}

/**
 * SHOP [3333] 日历 — read-only 月日/星期/天气/气温一览. 复用 ExComPanel
 * 的 CalendarView(已在游戏画面 Ex_COM 行使用). 这里在 panel 顶端额外补一行
 * 当日祭日 (节日) ,上游 `FESTIVAL()` 已在 `calendar.ts` 落地,ExComPanel 还没
 * 接,所以这里 inline 渲染一条. `festivalOf` 已在 runtime 根 barrel 导出.
 */
function CalendarPanel({ state }: { state: GameState }) {
  const fest = festivalOf(seasonOf(state.time), dateOf(state.time));
  return (
    <div className="morning-menu__calendar" data-testid="morning-calendar">
      {fest && (
        <p className="morning-menu__calendar-fest" data-testid="morning-calendar-festival">
          节日：{fest}
        </p>
      )}
      <CalendarDetails state={state} />
    </div>
  );
}

/**
 * SHOP [120] 搬家 — 私室候補 picker + OMANEKI 客中门. 提取自 ResidencePanel
 * 的「搬家（私室候補）」段(`MorningMenuScreen.tsx:347-383` 既有逻辑). 上游
 * `SHOP.ERB:105-110, :304` 在玩家位于 OMANEKIBEYA() 时禁止搬家;现代 runtime
 * 没有专门的「客中」按钮,所以我们用 `state.master.location === OMANEKI_PLACE`
 * 作为 客中 判定,若命中则显示「正在待客室中,无法搬家」并禁用全部选项.
 */
function MoveHomePanel({
  state,
  onSetHomeLocation,
}: {
  state: GameState;
  onSetHomeLocation?: (homeLocation: string) => void;
}) {
  const inOmaneki = state.master.location === OMANEKI_PLACE;
  const wake = masterWakeMinute(state);
  const wakeChoices = [360, 420, 480, 540, 600, 720];
  const firstDay = state.time.dayIndex === 0;

  const optionState = (option: ResidenceOption) => {
    const ownerPresent = option.ownerChara > 0 && state.charas[option.ownerChara] !== undefined;
    const trust = ownerPresent ? getCharaCflag(state, option.ownerChara, CFLAG_ID.信頼度) : 0;
    const locked = !firstDay && option.ownerChara > 0 && trust < option.requiredTrust;
    return {
      disabled: locked,
      title: locked
        ? `${option.ownerName}还没有信赖你到这种程度…（信赖度 ${trust} / ${option.requiredTrust}）`
        : undefined,
      status: option.ownerChara > 0
        ? locked
          ? `信赖度 ${trust} / ${option.requiredTrust}（不足）`
          : firstDay
            ? "首日免判定"
            : `信赖度 ${trust} / ${option.requiredTrust}（可入住）`
        : "默认住所，无需家主判定",
    };
  };

  return (
    <div className="morning-menu__movehome" data-testid="morning-movehome">
      {inOmaneki ? (
        <p className="morning-menu__note morning-menu__note--warn" data-testid="morning-movehome-omaneki">
          正在待客室（{OMANEKI_PLACE}）中，无法搬家。请先用 699「外出」／让角色离开。
        </p>
      ) : (
        <ResidencePicker
          currentLocation={state.homeLocation}
          onSelect={onSetHomeLocation}
          optionState={optionState}
          testIdPrefix="morning-movehome-"
          optionTestId="morning-home-choice"
          note={
            <p className="residence-map-ui__note">
              第一天可无视必要信赖度；之后按上游 SET_MAINHOME 的家主信赖度判定。这里的信赖度是搬家门槛，普通好感度不会替代该判定。
            </p>
          }
        />
      )}
      <p className="morning-menu__note">
        当前住址：{state.homeLocation ? formatLocation(state.homeLocation) : "未设置"}。搬家后回家／起床落点会同步。
      </p>
      <p className="morning-menu__note">
        起床时间（{minuteText(wake)}）在「居住环境设定」面板可调；可选：{wakeChoices.map(minuteText).join(" / ")}。
      </p>
    </div>
  );
}

/**
 * SHOP [107] 收到的礼物 — 礼物历史列表. 数据 `state.gifts[charaNum]` 是
 * 「master 送给该角色的礼物历史」(`recordGiftPurchase` 由 COMF626 写入,
 * gifts.ts:257);上游 SHOP.ERB:155 读的是 `GIFT_GAVE:CHARA:n` =「该角色送给
 * master 的礼物」.方向相反,现代 runtime 还没建「收到的礼物」存储.这里显示
 * 我们有真实数据的「送礼历史」并明确标注方向,不伪造收到的部分.
 */
function GiftListPanel({ state }: { state: GameState }) {
  const charas = Object.values(state.charas).sort((a, b) => a.charaNum - b.charaNum);
  const [picked, setPicked] = useState<number | null>(charas[0]?.charaNum ?? null);
  const pickedSlot = picked !== null ? state.charas[picked] : undefined;
  const rows: GiftHistoryRow[] = pickedSlot ? buildGiftHistory(state, pickedSlot.charaNum) : [];
  const totalSent = pickedSlot
    ? state.gifts?.[pickedSlot.charaNum]?.records.length ?? 0
    : 0;
  const totalReceived = pickedSlot
    ? getMasterCflag(state, CFLAG_ID.送出的礼物) > 0
      ? Math.trunc(getMasterCflag(state, CFLAG_ID.送出的礼物) / 1000)
      : 0
    : 0;
  return (
    <div className="morning-menu__gifts" data-testid="morning-gifts">
      <p className="morning-menu__message">
        礼物历史按角色查看.方向说明：本面板显示「你送给 TA 的礼物」(现代 runtime 真实写入),
        「TA 送给你的礼物」上游为 `GIFT_GAVE:CHARA:n`,现代尚未建 received-gifts 存储 →
        收到的历史暂不显示(已累计送出回数 {totalReceived} 次,可在下方状态条看到).
      </p>
      <div className="morning-menu__gift-picker" data-testid="morning-gift-picker">
        {charas.map((slot) => {
          const active = slot.charaNum === picked;
          const sent = state.gifts?.[slot.charaNum]?.records.length ?? 0;
          return (
            <button
              key={slot.charaNum}
              type="button"
              data-testid="morning-gift-pick"
              data-chara={slot.charaNum}
              className={
                active
                  ? "morning-menu__choice morning-menu__choice--active"
                  : "morning-menu__choice"
              }
              onClick={() => setPicked(slot.charaNum)}
            >
              {slot.callName ?? `#${slot.charaNum}`}
              {sent > 0 && <small>　已送 {sent} 次</small>}
            </button>
          );
        })}
      </div>
      {pickedSlot ? (
        rows.length === 0 ? (
          <p className="morning-menu__note" data-testid="morning-gift-empty">
            还没有送给「{pickedSlot.callName ?? `#${pickedSlot.charaNum}`}」的礼物记录.
            在 626 土産屋 买一件试试.
          </p>
        ) : (
          <div className="morning-menu__gift-list" data-testid="morning-gift-list">
            {rows.map((row, i) => (
              <div
                key={`${row.day}-${row.count}-${i}`}
                className={`morning-menu__gift-row${row.favorite ? " morning-menu__gift-row--fav" : ""}`}
              >
                {row.favorite && <span className="morning-menu__gift-fav">★</span>}
                <span className="morning-menu__gift-name">{row.name}</span>
                <span className="morning-menu__gift-meta">
                  评分 {row.score} · 第 {row.day + 1} 日 · 第 {row.count} 次
                  {row.orderMade && " · 定制"}
                </span>
              </div>
            ))}
          </div>
        )
      ) : (
        <p className="morning-menu__note">还没有角色数据.</p>
      )}
      <p className="morning-menu__note" data-testid="morning-gift-stats">
        ※ 本角色累计送出 {totalSent} 次.
      </p>
    </div>
  );
}

/**
 * SHOP [160] 重置委托 — ASK_YN 风格两段确认,忠实 upstream
 * `IRAI_RESET_PROCESS` 行为(CTRL_IRAI.ERB:740-762 + SHOP.ERB:350):
 * 清 commissions.slots + per-chara 委托状況/内容状态 + 同步 MASTER 411-419
 * 镜像. lastMorningDay 保留(同日防二跑守卫).
 */
function ResetCommissionPanel({
  state,
  onReset,
  onClose,
}: {
  state: GameState;
  onReset?: () => { resetSlots: number; resetFlags: number };
  onClose: () => void;
}) {
  const activeSlots = state.commissions?.slots.length ?? 0;
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);
  const [result, setResult] = useState<{ resetSlots: number; resetFlags: number } | null>(null);
  const armConfirm = (): void => setConfirmStep(1);
  const cancelConfirm = (): void => {
    setConfirmStep(0);
    setResult(null);
  };
  const doReset = (): void => {
    if (!onReset) return;
    const r = onReset();
    setResult(r);
    setConfirmStep(2);
  };
  return (
    <div className="morning-menu__reset" data-testid="morning-reset-commission">
      <p className="morning-menu__message">
        重置所有的委托。当前进行中委托 <strong>{activeSlots}</strong> 槽,
        全部归零。角色侧 委托状况/委托内容 状态也会清空,
        下一晨委托会从干净状态重新 roll。
      </p>
      <p className="morning-menu__note">
        ※ 等同上游 <code>IRAI_RESET_PROCESS</code>(CTRL_IRAI.ERB:740-762),但现代 runtime
        只清 slots+委托状况/委托内容 状态,不伪造 委托状况==3 强制来访;收到的委托报酬/物品
        已经发了不会被回收。玩家在委托进行中重置 → 与上游忠实：报酬会丢。
      </p>
      {confirmStep === 0 && (
        <div className="morning-menu__choice-row" data-testid="morning-reset-commission-ask1">
          <button
            type="button"
            className="morning-menu__choice"
            data-testid="morning-reset-commission-confirm"
            disabled={!onReset}
            onClick={armConfirm}
          >
            确认重置
          </button>
          <button
            type="button"
            className="morning-menu__choice"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      )}
      {confirmStep === 1 && (
        <div className="morning-menu__choice-row" data-testid="morning-reset-commission-ask2">
          <span className="morning-menu__note morning-menu__note--warn">真的要重置吗？</span>
          <button
            type="button"
            className="morning-menu__choice morning-menu__choice--danger"
            data-testid="morning-reset-commission-doit"
            disabled={!onReset}
            onClick={doReset}
          >
            真的要重置
          </button>
          <button
            type="button"
            className="morning-menu__choice"
            onClick={cancelConfirm}
          >
            算了
          </button>
        </div>
      )}
      {confirmStep === 2 && result && (
        <div data-testid="morning-reset-commission-done">
          <p className="morning-menu__message">
            ✓ 已重置：清空 {result.resetSlots} 个进行中委托槽,
            归零 {result.resetFlags} 个角色状态。
          </p>
          <button
            type="button"
            className="morning-menu__choice"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * SHOP [161] 重置服装 — 两段确认(同 160 风格). 忠实 upstream
 * `RESET_ALL_CLOTHES`(CLOTHES.ERB:707-718),但现代 runtime
 * 排除 master(charaNum 0 没 CHARA_OUTFITS 数据 → okigaeRestore 是 no-op);
 * 上游 FOR LOCAL 0..CHARANUM 含 master,此处 UI 注明"主角不参与"。
 */
function ResetClothesPanel({
  state,
  onReset,
  onClose,
}: {
  state: GameState;
  onReset?: () => { resetNpcs: number; resetCoords: number };
  onClose: () => void;
}) {
  const npcCount = Object.keys(state.charas).filter((k) => Number(k) > 0).length;
  const coordCount = (() => {
    const os = (state as any).outfitSets as
      | Record<number, Record<number, Record<number, number>>>
      | undefined;
    if (!os) return 0;
    let n = 0;
    for (const charaNum of Object.keys(os).map(Number)) {
      if (charaNum <= 0) continue;
      n += Object.keys(os[charaNum] ?? {}).length;
    }
    return n;
  })();
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);
  const [result, setResult] = useState<{ resetNpcs: number; resetCoords: number } | null>(null);
  const armConfirm = (): void => setConfirmStep(1);
  const cancelConfirm = (): void => {
    setConfirmStep(0);
    setResult(null);
  };
  const doReset = (): void => {
    if (!onReset) return;
    const r = onReset();
    setResult(r);
    setConfirmStep(2);
  };
  return (
    <div className="morning-menu__reset" data-testid="morning-reset-clothes">
      <p className="morning-menu__message">
        恢复所有 NPC(<strong>{npcCount}</strong> 名)的默认便装,
        并清空自定义套装(<strong>coordinate 1-99</strong>, 当前 {coordCount} 个)。
        半脱/H 段改写的装备槽位全部还原为便装默认。
      </p>
      <p className="morning-menu__note">
        ※ <strong>主角不参与</strong>(charaNum 0 无 CHARA_OUTFITS 数据 →
        <code>okigaeRestore</code> 是 no-op)。上游 <code>RESET_ALL_CLOTHES</code>
        (CLOTHES.ERB:707-718) FOR 循环含 master,现代侧偏差记录于
        <code>UNIMPLEMENTED-MAP.md</code>,等 P3 全角色全目录再补 master 默认 outfit。
        角色侧的「基本服装」「指定胖次」「睡衣胖次」等服装位元数据现代未建模,coordinate
        即 <code>state.outfitSets</code> 全清。
      </p>
      {confirmStep === 0 && (
        <div className="morning-menu__choice-row" data-testid="morning-reset-clothes-ask1">
          <button
            type="button"
            className="morning-menu__choice"
            data-testid="morning-reset-clothes-confirm"
            disabled={!onReset}
            onClick={armConfirm}
          >
            确认重置
          </button>
          <button
            type="button"
            className="morning-menu__choice"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      )}
      {confirmStep === 1 && (
        <div className="morning-menu__choice-row" data-testid="morning-reset-clothes-ask2">
          <span className="morning-menu__note morning-menu__note--warn">真的要重置便装 + 清空套装吗？</span>
          <button
            type="button"
            className="morning-menu__choice morning-menu__choice--danger"
            data-testid="morning-reset-clothes-doit"
            disabled={!onReset}
            onClick={doReset}
          >
            真的要重置
          </button>
          <button
            type="button"
            className="morning-menu__choice"
            onClick={cancelConfirm}
          >
            算了
          </button>
        </div>
      )}
      {confirmStep === 2 && result && (
        <div data-testid="morning-reset-clothes-done">
          <p className="morning-menu__message">
            ✓ 已重置：恢复 {result.resetNpcs} 名 NPC 的默认便装,
            清空 {result.resetCoords} 个自定义套装。
          </p>
          <button
            type="button"
            className="morning-menu__choice"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * In-game UPDATE page for deterministic portrait-package selection. The old
 * Web-only implementation treated [500] as an unavailable external updater;
 * this page keeps the command number but gives it the authored visual-update
 * function the player can use without leaving the game.
 */
function PortraitUpdatePanel({
  state,
  onSetPortraitVariant,
}: {
  state: GameState;
  onSetPortraitVariant?: (charaNum: number, variantId: number) => void;
}) {
  const rows = Object.values(state.charas).sort((a, b) => a.charaNum - b.charaNum);
  const [selectedChara, setSelectedChara] = useState(rows[0]?.charaNum ?? 0);
  const selected = rows.find((slot) => slot.charaNum === selectedChara) ?? rows[0];
  return (
    <div className="morning-menu__portrait-update" data-testid="morning-portrait-update">
      <p className="morning-menu__message">
        选择角色后切换其立绘包。选择会保存到角色自身；立绘／颜绘的全局显示类型仍在 OPTION [3] 中切换。
      </p>
      <div className="morning-menu__portrait-update-layout">
        <div className="morning-menu__portrait-roster" role="list" aria-label="立绘更新角色列表">
          {rows.map((slot) => (
            <button
              type="button"
              key={slot.charaNum}
              className={
                "morning-menu__choice" +
                (slot.charaNum === selected?.charaNum ? " morning-menu__choice--active" : "")
              }
              data-testid="morning-portrait-character"
              data-chara={slot.charaNum}
              onClick={() => setSelectedChara(slot.charaNum)}
            >
              [{slot.charaNum}] {slot.callName ?? slot.name ?? `角色${slot.charaNum}`}
            </button>
          ))}
        </div>
        <div className="morning-menu__portrait-detail">
          {selected ? (
            <PortraitVariantPicker
              state={state}
              charaNum={selected.charaNum}
              onSelect={(variantId) => onSetPortraitVariant?.(selected.charaNum, variantId)}
            />
          ) : (
            <p className="morning-menu__note">当前没有可更新的角色。</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MorningMenuScreen({
  state,
  lastSavedAt,
  initialPanel,
  onOpenEyes,
  onSaveSlot,
  onLoadSlot,
  onRefreshSlots,
  saveSlots,
  onBuyCatalogItem,
  onUseInventoryItem,
  onSetWakeMinute,
  onSetHomeLocation,
  onResetCommissions,
  onResetClothes,
  onReleaseBug,
  onMaterializeBug,
  onTogglePortraitKind,
  onSetPortraitVariant,
  onTogglePantyGapAuto,
  onClaimPantyCollectionBonus,
  onSellPantyDuplicates,
  onTriggerManualNarrative,
}: Props) {
  // Minimal mode keeps wake/save plus the explicitly requested L3 controls.
  // The auto-opened initial panel (e.g. gap-shop after night settlement) is
  // ignored so no shop modal pops up uninvited.
  const minimal = usePresentationMode() === "minimal";
  const [panel, setPanel] = useState<PanelKind | null>(() => (minimal ? null : (initialPanel ?? null)));
  const [saveMessage, setSaveMessage] = useState("");
  // 睁眼等待门 — while the background agent-night sidecar (character
  // reflections/diaries) is still running, [100] stays disabled and the
  // status block shows its progress. 「不再等待」 cancels it (abandon).
  const nightCycleStatus = useGameStateStore((s) => s.nightCycleStatus);
  const abandonNightCycleAction = useGameStateStore((s) => s.abandonNightCycleAction);
  const nightRunning = nightCycleStatus?.running === true;
  const { time } = state;
  const day = time.dayIndex + 1;
  const weekday = weekdayLabelZh(time.dayIndex);
  const dateLabel = `${monthName(seasonOf(time))}${dateOf(time)}日`;
  const tz = timezoneName(currentTimezone(time.hourOfDay));
  const cleanliness = state.master.location ? getCleanlinessLabel(state, state.master.location) : "";
  const regionWeather = currentRegionWeather(state);
  const weatherStyle = weatherBackgroundStyle(state) as CSSProperties;
  const savedText = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : "";

  const saveToSlot = async (slot: SaveSlot): Promise<void> => {
    if (!onSaveSlot) {
      setSaveMessage("当前环境没有可用的存档后端。");
      return;
    }
    setSaveMessage(`正在存档到存档位 ${slot}…`);
    try {
      const ok = await onSaveSlot(slot);
      setSaveMessage(ok === false ? "存档失败，请查看错误信息。" : `已存档到存档位 ${slot}。`);
    } catch (e) {
      setSaveMessage(`存档失败：${String(e)}`);
    }
  };

  const loadFromSlot = async (slot: SaveSlot): Promise<void> => {
    if (!onLoadSlot) {
      setSaveMessage("当前环境没有可读取的存档。");
      return;
    }
    setSaveMessage(`正在从存档位 ${slot} 读档…`);
    try {
      const ok = await onLoadSlot(slot);
      setSaveMessage(ok === false ? "该存档位没有可读取的存档。" : `已读取存档位 ${slot}。`);
    } catch (e) {
      setSaveMessage(`读档失败：${String(e)}`);
    }
  };

  // 检查 L3 是否可用
  const aiSettings = useAiStore((s) => s.settings);
  // L3 stands on its own switch: it does not need the shell to replace authored
  // kojo with AI, so those two toggles are not part of this gate.
  const l3Available = aiSettings.enabled && aiSettings.narrativeEnabled &&
    state.agentRuntime?.settings.masterEnabled === true;

  // 菜单按功能分组 (2026-09-11): 不再按上游 1xx/2xx/4xx 的编号分段.
  // [200] SAVE 已撤下, 存读档统一走 [300] 档案操作; [411] 出现场所列表
  // 已撤下. 未接入 / DLC 暂不做的入口标 hidden —— 定义和 reason 留着,
  // 恢复时去掉 hidden 即可.
  const menuSections: { title: string; commands: MenuCommand[] }[] = [
    {
      title: "起居",
      commands: [
        { code: 100, label: "睁开眼睛", onClick: onOpenEyes, disabled: nightRunning, reason: nightRunning ? "少女祈祷中，请稍候…" : undefined },
        { code: 102, label: "居住环境设定", onClick: () => setPanel("residence") },
        { code: 120, label: "搬家", onClick: () => setPanel("move-home") },
      ],
    },
    {
      title: "情报一览",
      commands: [
        { code: 101, label: "能力显示", onClick: () => setPanel("ability") },
        { code: 104, label: "所持道具一览", onClick: () => setPanel("inventory") },
        { code: 105, label: "收集", onClick: () => setPanel("collection") },
        { code: 106, label: "入手的乐谱", hidden: true, reason: "乐谱列表尚未接入" },
        { code: 107, label: "收到的礼物", onClick: () => setPanel("gifts") },
        { code: 108, label: "钓鱼列表", onClick: () => setPanel("fishing-list") },
        { code: 109, label: "狩猎兽列表", hidden: true, reason: "狩猎列表尚未接入" },
        { code: 110, label: "捕虫列表", onClick: () => setPanel("bug-list") },
        { code: 111, label: "固有料理列表", onClick: () => setPanel("special-dishes") },
        { code: 112, label: "战斗履历列表", hidden: true, reason: "弹幕玩法已接入，但战斗履历尚未持久化" },
      ],
    },
    {
      title: "商店与服务",
      commands: [
        { code: 103, label: "隙间商店", onClick: () => setPanel("gap-shop") },
        { code: 410, label: "采集列表", onClick: () => setPanel("gathering-list") },
        { code: 500, label: "UPDATE／立绘更新", onClick: () => setPanel("portrait-update") },
      ],
    },
    {
      title: "系统",
      commands: [
        { code: 150, label: "实绩解除", hidden: true, reason: "实绩系统尚未接入" },
        { code: 151, label: "农家设定", hidden: true, reason: "家庭菜园已接入，但农家职业设定尚未建模" },
        { code: 160, label: "重置委托", onClick: () => setPanel("reset-commission") },
        { code: 161, label: "重置服装", onClick: () => setPanel("reset-clothes") },
        { code: 300, label: "档案操作", onClick: () => setPanel("save") },
        { code: 3333, label: "日历", onClick: () => setPanel("calendar") },
        { code: 400, label: "OPTION", onClick: () => setPanel("option") },
        { code: 420, label: "单独指导", hidden: true, reason: "指导系统尚未接入" },
        { code: 113, label: "手动触发故事（L3）", onClick: () => setPanel("manual-narrative"), disabled: !l3Available || !onTriggerManualNarrative, reason: !l3Available ? "需要同时开启 AI、L3 叙事导演与 Agent Runtime" : undefined },
        { code: 114, label: "L3 剧情状态 / 调试", onClick: () => setPanel("l3-status") },
        { code: 600, label: "卖出筹码", hidden: true, reason: "筹码/赌场兑换尚未接入" },
        { code: 666, label: "幻想乡之主", hidden: true, reason: "DLC 暂不做", dlc: true },
      ],
    },
  ];

  return (
    <section className="morning-menu" data-testid="screen-morning-menu" style={weatherStyle}>
      <div className="morning-menu__panel">
        <div className="morning-menu__rule" />
        <div className="morning-menu__topline">
          <span>
            第{day}日（{weekday}）　{dateLabel}　{timeText(state)} {tz ? `(${tz})` : ""}
          </span>
          {!minimal && <span>所持金：￥{state.money.toLocaleString()}</span>}
        </div>
        <div className="morning-menu__rule" />

        {nightRunning && (
          <NightCycleStatusBlock
            entries={nightCycleStatus!.entries}
            onSkip={() => {
              abandonNightCycleAction();
              onOpenEyes();
            }}
          />
        )}

        {minimal ? (
          /* Minimal wake-up page: wake/save and L3 generation/diagnostics. */
          <div className="morning-menu__minimal-actions" data-testid="morning-minimal-actions">
            <CommandButton command={{ code: 100, label: "睁开眼睛", onClick: onOpenEyes, disabled: nightRunning, reason: nightRunning ? "少女祈祷中，请稍候…" : undefined }} />
            <CommandButton command={{ code: 300, label: "档案操作", onClick: () => setPanel("save") }} />
            <CommandButton command={{ code: 113, label: "手动触发故事（L3）", onClick: () => setPanel("manual-narrative"), disabled: !l3Available || !onTriggerManualNarrative, reason: !l3Available ? "需要同时开启 AI、L3 叙事导演与 Agent Runtime" : undefined }} />
            <CommandButton command={{ code: 114, label: "L3 剧情状态 / 调试", onClick: () => setPanel("l3-status") }} />
          </div>
        ) : (
          <>
        <div className="morning-menu__bars">
          {["体力", "気力", "TSP", "精力"].map((label) => (
            <StatLine key={label} state={state.master.state} label={label} />
          ))}
        </div>

        <div className="morning-menu__home">
          <div>［住址］：{state.homeLocation ? formatLocation(state.homeLocation) : "未设置"}</div>
          <div>［当前位置］：{formatLocation(state.master.location)}</div>
          <div>［起床时间］：{minuteText(masterWakeMinute(state))}</div>
          <div>
            ［天气］：{formatRegionWeather(regionWeather)}（{regionWeather.regionName}）
            风:{formatRegionWind(regionWeather)}　天象:{formatRegionRainbow(regionWeather)}
            {formatTemperature(getCurrentTemperature(state))}
          </div>
          {cleanliness && <div>［清洁度］：{cleanliness}</div>}
        </div>

        <p className="morning-menu__tip">
          温馨提示：有些素材不在特定季节或特定地点就无法采集到。
        </p>

        {menuSections.map((section) => (
          <CommandSection key={section.title} title={section.title} commands={section.commands} />
        ))}
          </>
        )}
        {saveMessage && (
          <p className="morning-menu__save-message" data-testid="morning-save-message">
            {saveMessage}{savedText ? `（上次保存：${savedText}）` : ""}
          </p>
        )}

        {panel === "l3-status" && <ExComPanel state={state} tool="l3-status" onClose={() => setPanel(null)} />}
        {panel === "ability" && (
          <ExComPanel
            state={state}
            tool="ability-master"
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "residence" && (
          <PanelShell title="居住环境设定" onClose={() => setPanel(null)}>
            <ResidencePanel
              state={state}
              onSetWakeMinute={onSetWakeMinute}
              onSetHomeLocation={onSetHomeLocation}
            />
          </PanelShell>
        )}
        {panel === "gap-shop" && (
          <PanelShell title="隙间商店" onClose={() => setPanel(null)}>
            <GapShopPanel state={state} onBuyCatalogItem={onBuyCatalogItem} />
          </PanelShell>
        )}
        {panel === "inventory" && (
          <PanelShell title="所持道具一览" onClose={() => setPanel(null)}>
            <InventoryPanel state={state} onUseItem={onUseInventoryItem} />
          </PanelShell>
        )}
        {panel === "collection" && (
          <PanelShell title="收集" onClose={() => setPanel(null)}>
            <CollectionPanel
              state={state}
              onTogglePantyGapAuto={onTogglePantyGapAuto}
              onClaimPantyCollectionBonus={onClaimPantyCollectionBonus}
              onSellPantyDuplicates={onSellPantyDuplicates}
            />
          </PanelShell>
        )}
        {panel === "special-dishes" && (
          <PanelShell title="固有料理列表" onClose={() => setPanel(null)}><SpecialDishPanel state={state} /></PanelShell>
        )}
        {panel === "gathering-list" && (
          <PanelShell title="采集列表" onClose={() => setPanel(null)}><GatheringListPanel state={state} /></PanelShell>
        )}
        {panel === "fishing-list" && (
          <PanelShell title="钓鱼列表" onClose={() => setPanel(null)}><FishingListPanel state={state} /></PanelShell>
        )}
        {panel === "bug-list" && (
          <PanelShell title="捕虫列表" onClose={() => setPanel(null)}>
            <BugListPanel state={state} onRelease={onReleaseBug} onMaterialize={onMaterializeBug} />
          </PanelShell>
        )}
        {panel === "save" && (minimal ? (
          /* Minimal: the save slots render inline in the page — no modal box. */
          <div className="morning-menu__inline-save" data-testid="morning-inline-save">
            <h3 className="morning-menu__field-title">SAVE / LOAD（3 存档位）</h3>
            <SavePanel
              currentInfo={formatSaveInfo(state)}
              slots={saveSlots}
              onRefresh={onRefreshSlots}
              onSave={saveToSlot}
              onLoad={onLoadSlot ? loadFromSlot : undefined}
            />
            <button type="button" className="morning-menu__choice" data-testid="morning-inline-save-close" onClick={() => setPanel(null)}>
              [收起]
            </button>
          </div>
        ) : (
          <PanelShell title="SAVE / LOAD（3 存档位）" onClose={() => setPanel(null)}>
            <SavePanel
              currentInfo={formatSaveInfo(state)}
              slots={saveSlots}
              onRefresh={onRefreshSlots}
              onSave={saveToSlot}
              onLoad={onLoadSlot ? loadFromSlot : undefined}
            />
          </PanelShell>
        ))}
        {panel === "calendar" && (
          <PanelShell title="日历" variant="calendar" onClose={() => setPanel(null)}>
            <CalendarPanel state={state} />
          </PanelShell>
        )}
        {panel === "move-home" && (
          <PanelShell title="搬家" onClose={() => setPanel(null)}>
            <MoveHomePanel state={state} onSetHomeLocation={onSetHomeLocation} />
          </PanelShell>
        )}
        {panel === "gifts" && (
          <PanelShell title="收到的礼物（送礼历史）" onClose={() => setPanel(null)}>
            <GiftListPanel state={state} />
          </PanelShell>
        )}
        {panel === "reset-commission" && (
          <PanelShell title="重置委托" onClose={() => setPanel(null)}>
            <ResetCommissionPanel
              state={state}
              onReset={onResetCommissions}
              onClose={() => setPanel(null)}
            />
          </PanelShell>
        )}
        {panel === "reset-clothes" && (
          <PanelShell title="重置服装" onClose={() => setPanel(null)}>
            <ResetClothesPanel
              state={state}
              onReset={onResetClothes}
              onClose={() => setPanel(null)}
            />
          </PanelShell>
        )}
        {panel === "option" && (
          <OptionsDialog
            state={state}
            onTogglePortraitKind={onTogglePortraitKind}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "portrait-update" && (
          <PanelShell title="UPDATE／立绘更新" onClose={() => setPanel(null)}>
            <PortraitUpdatePanel state={state} onSetPortraitVariant={onSetPortraitVariant} />
          </PanelShell>
        )}
        {panel === "manual-narrative" && (
          <PanelShell title="手动触发故事（L3 叙事导演）" onClose={() => setPanel(null)}>
            <ManualNarrativePanel
              state={state}
              onTriggerNarrative={onTriggerManualNarrative ?? (async () => false)}
              onClose={() => setPanel(null)}
            />
          </PanelShell>
        )}
      </div>
    </section>
  );
}
