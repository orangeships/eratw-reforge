/**
 * 角色情报看板 — 忠实移植 eraTW 上游 6+1 页 + Personal History。
 *
 * Props:
 *   - `state`  : GameState（只读）。
 *   - `charaNum` : 要显示的角色编号（0 = MASTER）。
 *   - `onClose`  : 关闭回调（由父组件 `GameClient` 控制 open/close）。
 *
 * 设计原则：
 *   - UI 层只读 `buildCharaInfoSnapshot` 结果，禁止直读 legacy namespace.
 *   - tab 按钮 + 折叠开关全用 React state，不侵入 GameState。
 *   - 样式贴 CommissionPopup（圆角毛玻璃） + ExComPanel（字段行布局）。
 *   - 所有门控、分支条件调 chara-info-state.ts 纯函数，组件纯展示。
 *
 * ⚠️ 本文件在 `web/app/game/` 下，受 forbidden-names 守卫 — 不允许拼写 legacy namespace tokens.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import {
  buildCharaInfoSnapshot,
  evaluateFallRequirements,
  evaluateSkillTrack,
  probeKojoOption,
  type CharaInfoSnapshot,
  type AgentInfoSnapshot,
  type BasicHeader,
  type CharaPreference,
  type ExEntry,
  type PregnancyInfo,
  type CompatRow,
  type FallRequirement,
  type SkillTrackEntry,
  type KojoOptionProbe,
  type AbilityGridValueCell,
} from "../../../modernization/runtime/state/chara-info-state.js";
import type {
  TasteTag,
} from "../../../modernization/runtime/state/chara-data.js";
import type {
  TalentCategoryRow,
} from "../../../modernization/runtime/state/talent-categories.js";
import type {
  GiftHistoryRow,
} from "../../../modernization/runtime/state/gifts.js";
import type {
  BodyInfo,
  BodySection,
  BodyLine,
  BodyTone,
} from "../../../modernization/runtime/state/body-info.js";
import type {
  UwakiRow,
} from "../../../modernization/runtime/state/uwaki.js";
import {
  activeWorkEntry,
  JOB_LABEL,
  workEntriesForDay,
} from "../../../modernization/runtime/world/work/work-manifest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGES = ["服装&能力", "经验&宝珠", "个人情报", "个人好恶", "身体情报", "陷落状态"] as const;

function lustTierEmoji(tier: string): string {
  switch (tier) {
    case "calm": return "—";
    case "want": return "○";
    case "frustrated": return "●";
    case "restless": return "❤";
    case "burning": return "❤️‍🔥";
    default: return "";
  }
}

function felLabel(hMode: BasicHeader["hModeChip"]): string {
  switch (hMode) {
    case "dangerous-day-raw": return "危険日生Ｈ解禁";
    case "raw-ok": return "生Ｈ解禁";
    case "consent": return "合意取得";
    default: return "";
  }
}

function hhmm(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** mm → "150cm" (上游 /10 — 身高体重以 10mm / 100g 为单位). */
function mmToCm(mm: number): string {
  return `${(mm / 10).toFixed(1)}cm`;
}
/** 100g → "55.0kg". 上游体重 × 100 (=10kg unit divide by 10). */
function hgToKg(hg: number): string {
  return `${(hg / 10).toFixed(1)}kg`;
}

/** 渲染单一标签 + Lv (SHOW_TASTE line shape). `masked` ⇒ 显示 [？？？？] 但权重仍可见. */
function TasteTagView({ tag, masked }: { tag: TasteTag; masked: boolean }) {
  const tierClass = tag.tier === 3 ? "ci-panel__taste-tag--tier3" : tag.tier === 2 ? "ci-panel__taste-tag--tier2" : "";
  return (
    <span className={`ci-panel__taste-tag ${tierClass}`}>
      <span className={masked ? "ci-panel__taste-tag-mask" : undefined}>
        {masked ? "[？？？？]" : `[${tag.tag}]`}
      </span>
      Lv{tag.weight}
    </span>
  );
}

/** 单组 感/料理: title + (locked 文案 | tag 列表). 得意料理优先打印. */
function TasteView({
  title,
  locked,
  view,
  specialty,
}: {
  title: string;
  locked: boolean;
  view: { tags: TasteTag[] } | null;
  specialty?: string | null;
}) {
  if (!view) {
    return (
      <div className="ci-panel__taste">
        <div className="ci-panel__taste-head"><b>{title}</b></div>
        <div className="ci-panel__taste-locked">未收录角色数据</div>
      </div>
    );
  }
  return (
    <div className="ci-panel__taste">
      <div className="ci-panel__taste-head">
        <b>{title}</b>
        {locked && <span className="ci-panel__taste-locked">(未解锁 — 权重仍可见)</span>}
      </div>
      {specialty && <div className="ci-panel__taste-tags"><span className="ci-panel__taste-tag ci-panel__taste-tag--tier2">得意料理：{specialty}</span></div>}
      <div className="ci-panel__taste-tags">
        {view.tags.length === 0 ? (
          <span className="ci-panel__taste-locked">（无标签）</span>
        ) : view.tags.map((tag) => (
          <TasteTagView key={tag.tag} tag={tag} masked={locked} />
        ))}
      </div>
    </div>
  );
}

function TalentRow({ row }: { row: TalentCategoryRow }) {
  return (
    <div className="ci-panel__talent-cat">
      <div className="ci-panel__talent-cat-label">　{row.label}</div>
      <div className="ci-panel__talent-tags">
        {row.tags.map((t, i) => (
          <span
            key={`${t.id}-${i}`}
            className={`ci-panel__talent-tag ${t.highlight === 2 ? "ci-panel__talent-tag--hot" : t.highlight === 1 ? "ci-panel__talent-tag--pink" : ""}`}
          >
            [{t.name}]
          </span>
        ))}
      </div>
    </div>
  );
}

/** body line tone class — upstream 8 tone ladder. */
function bodyToneClass(tone: BodyTone): string {
  switch (tone) {
    case "red":    return "ci-panel__body-line-emph-red";
    case "pink":   return "ci-panel__body-line-emph-pink";
    case "orange": return "ci-panel__body-line-emph-orange";
    case "yellow": return "ci-panel__body-line-emph-yellow";
    case "green":  return "ci-panel__body-line-emph-green";
    case "aqua":   return "ci-panel__body-line-emph-aqua";
    case "cream":  return "ci-panel__body-line-emph-cream";
    case "purple": return "ci-panel__body-line-emph-purple";
    case "plain":  return "";
  }
}

function BodySectionView({ section }: { section: BodySection }) {
  return (
    <div className="ci-panel__body-section" data-testid={`ci-body-${section.title.replace(/[【】]/g, "")}`}>
      <div className="ci-panel__body-section-title">{section.title}</div>
      {section.lines.map((line: BodyLine, i) => (
        <div key={i} className={`ci-panel__body-line ${bodyToneClass(line.tone)}`}>
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  );
}

function BodySideView({ sections }: { sections: BodySection[] }) {
  return (
    <div className="ci-panel__body-split" data-testid="ci-body-side">
      {sections.map((s, i) => <BodySectionView key={i} section={s} />)}
    </div>
  );
}

function GiftHistoryView({ rows }: { rows: GiftHistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="ci-panel__gift-empty">尚未送过礼物。</p>;
  }
  return (
    <div className="ci-panel__gift-hist" data-testid="ci-gift-hist">
      {rows.map((row, i) => (
        <div key={i} className={`ci-panel__gift-row ${row.favorite ? "ci-panel__gift-row--fav" : ""}`}>
          {row.favorite && <span className="ci-panel__gift-fav">★</span>}
          <span className="ci-panel__gift-name">{row.name}</span>
          <span className="ci-panel__gift-meta">评分 {row.score} · 第{row.day + 1}日 · 第{row.count}次{row.orderMade ? " · 定制" : ""}</span>
        </div>
      ))}
    </div>
  );
}

function CompatTableView({ rows }: { rows: CompatRow[] }) {
  if (rows.length === 0) {
    return <p className="ci-panel__compat-empty">未发现与其他角色的相性记录。</p>;
  }
  return (
    <div className="ci-panel__compat" data-testid="ci-compat">
      {rows.map((row, i) => (
        <div key={i} className="ci-panel__compat-row">
          <span className="ci-panel__compat-name">{row.callName}</span>
          <span className={`ci-panel__compat-val ci-panel__compat--${row.tier}`}>{row.value}%</span>
        </div>
      ))}
    </div>
  );
}

function UwakiView({ rows }: { rows: UwakiRow[] }) {
  if (rows.length === 0) {
    return <p className="ci-panel__uwaki-empty">该角色尚未察觉任何浮气情况。</p>;
  }
  return (
    <div className="ci-panel__taste-tags" data-testid="ci-uwaki">
      {rows.map((row, i) => (
        <span
          key={i}
          className={`ci-panel__uwaki-row ${row.level === 2 ? "ci-panel__uwaki-row--accepted" : ""}`}
        >
          {row.callName}
        </span>
      ))}
    </div>
  );
}

/** 介绍文段: 每段独立 paragraph, CSTR 10..19 段按出现顺序. */
function IntroView({ paragraphs, workInfo }: { paragraphs: string[]; workInfo: string }) {
  return (
    <div>
      {workInfo && workInfo.trim() !== "" && (
        <p className="ci-panel__intro" data-testid="ci-work-info">
          <b style={{ color: "#8893a3", marginRight: 6 }}>工作情報</b>
          {workInfo}
        </p>
      )}
      {paragraphs.length === 0 ? (
        <p className="ci-panel__compat-empty">介绍文待抽取（无 CSTR 10..19）。</p>
      ) : (
        <div className="ci-panel__intro-list" data-testid="ci-intro">
          {paragraphs.map((p, i) => (
            <p key={i} className="ci-panel__intro-para">{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="ci-panel__bar" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <span className="ci-panel__barfill" style={{ width: `${pct}%` }} />
    </span>
  );
}

function BasicHeaderView({ header, callName, charaNum }: { header: BasicHeader; callName: string; charaNum: number }) {
  const fel = felLabel(header.hModeChip);
  return (
    <div className="ci-panel__basic" data-testid="ci-basic">
      <div className="ci-panel__basichead">
        <span className="ci-panel__who">
          ■{callName}
          {!header.isMaster && <span className="ci-panel__id"> #{charaNum}</span>}
        </span>
        {fel && <span className="ci-panel__chip">{fel}</span>}
        <span className="ci-panel__fortune-chip">运势 {header.fortune > 0 ? header.fortune : "—"}</span>
      </div>

      {header.isMaster
        ? (
          <div className="ci-panel__kv-row">
            <span className="ci-panel__kv"><b>所持金</b> ¥{header.money?.current.toLocaleString() ?? 0}</span>
            <span className="ci-panel__kv"><b>筹码</b> {header.money?.chips.toLocaleString() ?? 0} CM</span>
            <span className="ci-panel__kv"><b>守札</b> {header.money?.talisman ?? 0} 枚</span>
          </div>
        )
        : (
          <div className="ci-panel__kv-row">
            <span className="ci-panel__kv"><b>好感度</b> {header.favor?.value ?? 0}</span>
            <span className="ci-panel__kv"><b>信赖度</b> {header.favor?.trust ?? 0}</span>
            {header.lust && (
              <span className="ci-panel__kv ci-panel__kv--lust">
                <b>欲求不満</b> {lustTierEmoji(header.lust.tier)} {header.lust.value}
              </span>
            )}
            {header.brand && header.brand.tier > 0 && (
              <span className="ci-panel__kv ci-panel__kv--lust" data-testid="ci-rebellion-brand">
                <b>反发刻印</b> Lv{header.brand.tier}/{header.brand.max}
              </span>
            )}
          </div>
        )}

      <div className="ci-panel__bars">
        {header.named.map((n) => (
          <div key={n.key} className="ci-panel__statline">
            <span className="ci-panel__statlabel">{n.key}</span>
            <Bar value={n.value} max={n.max} />
            <span className="ci-panel__statnum">{n.value}/{n.max}</span>
          </div>
        ))}
      </div>

      {!header.isMaster && (
        <div className="ci-panel__relations">
          {header.relations.map((r) => (
            <span key={r.key} className="ci-panel__reltag">{r.key} <b>{r.rankLabel}</b> {r.value}</span>
          ))}
        </div>
      )}

      <div className="ci-panel__stars">
        {header.victory.map((v) => (
          <span key={v.key}>★{v.key} {v.value}</span>
        ))}
      </div>
    </div>
  );
}

/** 能力标签 + 等级色阶（GG..SSS）。 */
function abilityTone(value: number, maxRank: 6 | 99): string {
  const cap = maxRank === 6 ? 6 : 99;
  const r = cap > 0 ? value / cap : 0;
  if (value <= 0) return "ci-panel__ability-cell--zero";
  if (r >= 0.8) return "ci-panel__ability-cell--hi";
  if (r >= 0.4) return "ci-panel__ability-cell--mid";
  return "ci-panel__ability-cell--lo";
}

function AbilityGrid({ grid }: { grid: AbilityGridValueCell[][] }) {
  return (
    <div className="ci-panel__ability-grid" data-testid="ci-ability-body">
      {grid.map((row, ri) => (
        <div key={ri} className="ci-panel__ability-row">
          {row.map((cell, ci) => {
            if (cell.kind === "placeholder") {
              return <span key={ci} className="ci-panel__ability-cell ci-panel__ability-cell--empty" />;
            }
            if (cell.kind === "hidden") {
              return <span key={ci} className="ci-panel__ability-cell ci-panel__ability-cell--empty" />;
            }
            return (
              <span key={ci} className={`ci-panel__ability-cell ${abilityTone(cell.value ?? 0, cell.maxRank)}`}>
                <span className="ci-panel__ability-name">{cell.name}</span>
                <span className="ci-panel__ability-val">{cell.value ?? 0}</span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Section({ title, children, testid }: { title: string; children: ReactNode; testid?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ci-panel__section">
      <button type="button" className="ci-panel__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▼" : "▷"} {title}
      </button>
      {open && <div className="ci-panel__body" data-testid={testid}>{children}</div>}
    </div>
  );
}

function Page0ClothesAbility({ snap }: { snap: CharaInfoSnapshot }) {
  return (
    <div className="ci-panel__page" data-testid="ci-page-0">
      <BasicHeaderView header={snap.header} callName={snap.callName} charaNum={snap.charaNum} />

      <Section title="尺寸" testid="ci-size-body">
        {!snap.size.measured ? (
          <p className="ci-panel__size-masked" data-testid="ci-size-unmeasured">未测定（跑一次 身体測定 命令生身高三围）。</p>
        ) : (
          <div data-testid="ci-size-measured">
            <div className="ci-panel__size-row">
              <b>身高</b>
              <span className="ci-panel__size-val">
                {snap.size.heightMasked ? "???cm" : snap.size.heightMm !== undefined ? mmToCm(snap.size.heightMm) : "—"}
              </span>
              <b>体重</b>
              <span className="ci-panel__size-val">
                {snap.size.heightMasked ? "??kg" : snap.size.weight100g !== undefined ? hgToKg(snap.size.weight100g) : "—"}
              </span>
            </div>
            {snap.size.showMeasurements && (
              <div className="ci-panel__size-row" data-testid="ci-size-three">
                <b>胸围</b>
                <span className="ci-panel__size-val">{snap.size.bustMm !== undefined ? mmToCm(snap.size.bustMm) : "—"}</span>
                <span className="ci-panel__size-cup">{snap.size.cup ?? ""}</span>
                <b>腰围</b>
                <span className="ci-panel__size-val">{snap.size.waistMm !== undefined ? mmToCm(snap.size.waistMm) : "—"}</span>
                <b>臀围</b>
                <span className="ci-panel__size-val">{snap.size.hipMm !== undefined ? mmToCm(snap.size.hipMm) : "—"}</span>
              </div>
            )}
            {!snap.size.showMeasurements && <p className="ci-panel__muted">（性別==2 不显三围）</p>}
          </div>
        )}
      </Section>

      <Section title="服装" testid="ci-clothes-body">
        {snap.clothing.naked && <p className="ci-panel__chip ci-panel__chip--naked">＜全裸＞</p>}
        {snap.clothing.lines.length > 0 ? (
          <div className="ci-panel__cloth-list">
            {snap.clothing.lines.map((l, i) => (
              <div key={i} className="ci-panel__cloth-line">
                <span className="ci-panel__cloth-label">装备:{l.label}</span>
                <span className="ci-panel__cloth-val">[{l.value}]</span>
              </div>
            ))}
          </div>
        ) : (
          !snap.clothing.naked && <p className="ci-panel__muted">该角色的服装数据尚未收录。</p>
        )}
      </Section>

      <Section title="能力" testid="ci-ability-section">
        <AbilityGrid grid={snap.abilityGrid} />
        <p className="ci-panel__legend">
          <span className="ci-panel__dot ci-panel__dot--hi" /> 高
          <span className="ci-panel__dot ci-panel__dot--mid" /> 中
          <span className="ci-panel__dot ci-panel__dot--lo" /> 低
          <span className="ci-panel__dot ci-panel__dot--zero" /> 无
        </p>
      </Section>

      <Section title="素质 6 分类" testid="ci-talent-section">
        {snap.talentCategories.length === 0 ? (
          <p className="ci-panel__muted">（无持有素质）</p>
        ) : (
          <div data-testid="ci-talent-body">
            {snap.talentCategories.map((row) => (
              <TalentRow key={row.key} row={row} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Page1ExpJuel({ snap }: { snap: CharaInfoSnapshot }) {
  const exp = snap.expHighlights;
  return (
    <div className="ci-panel__page" data-testid="ci-page-1">
      <BasicHeaderView header={snap.header} callName={snap.callName} charaNum={snap.charaNum} />

      {snap.inTraining && (
        <p className="ci-panel__in-training" data-testid="ci-in-training">
          ✿ 调教中（うふふ） ✿　 PAGE 1 切到绝顶回数板
        </p>
      )}

      <Section title={snap.inTraining ? "绝顶回数" : "宝珠"} testid="ci-juel-section">
        {snap.inTraining ? (
          snap.exBoard && snap.exBoard.length > 0 ? (
            <div className="ci-panel__ex-grid" data-testid="ci-ex-board">
              {snap.exBoard.map((row: ExEntry) => (
                <div key={row.label} className="ci-panel__ex-cell">
                  <b>{row.label}</b>
                  <span>{row.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ci-panel__muted">（无绝顶记录）</p>
          )
        ) : (
          <div className="ci-panel__juel-grid">
            {snap.juels.map((j) => (
              <div key={j.label} className={`ci-panel__juel${j.value > 0 ? " ci-panel__juel--has" : ""}`}>
                <span className="ci-panel__juel-name">{j.label}</span>
                <span className="ci-panel__juel-val">{j.display}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="经验" testid="ci-exp-body">
        {exp.length > 0 ? (
          <div className="ci-panel__grid2">
            {exp.map((e) => (
              <div key={e.label} className="ci-panel__kv">
                <b>{e.label}</b>
                <span className="ci-panel__kv-val">{e.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="ci-panel__muted">暂无可显示的经验值（尚未积累）。</p>
        )}
      </Section>

      {snap.pregnancy && (
        <Section title="妊娠関連" testid="ci-pregnancy-body">
          <div data-testid="ci-pregnancy-info">
            <PregnancyView info={snap.pregnancy} />
          </div>
        </Section>
      )}
    </div>
  );
}

function PregnancyView({ info }: { info: PregnancyInfo }) {
  return (
    <div>
      <div className="ci-panel__preg-row"><b>上一次体内射精量</b><span className="ci-panel__kv-val">{info.lastCreampieVolume}</span></div>
      <div className="ci-panel__preg-row"><b>妊娠后经过时间</b><span className="ci-panel__kv-val">{info.pregnancyDays} 日</span></div>
      <div className="ci-panel__preg-row"><b>现在育儿中儿童数</b><span className="ci-panel__kv-val">{info.nursingCount}</span></div>
      <div className="ci-panel__preg-row"><b>现在育儿经过时间</b><span className="ci-panel__kv-val">{info.nursingDays} 日</span></div>
      <div className="ci-panel__preg-row"><b>孩子数量</b><span className="ci-panel__kv-val">{info.childCount}</span></div>
    </div>
  );
}

function WorkScheduleView({ state, charaNum }: { state: GameState; charaNum: number }) {
  if (charaNum === 0) return null;
  const minuteOfDay = ((state.time.tickValue % 1440) + 1440) % 1440;
  const active = activeWorkEntry(state, charaNum, minuteOfDay);
  const entries = workEntriesForDay(state, charaNum);
  return (
    <div className="ci-panel__work-schedule" data-testid="ci-work-schedule">
      <b>今日工作日程</b>
      {entries.length === 0 ? (
        <span className="ci-panel__kv-val">今日没有满足条件的工作安排。</span>
      ) : (
        <div className="ci-panel__work-schedule-list">
          {entries.map((entry) => {
            const isActive = active?.jobType === entry.jobType
              && active.startMin === entry.startMin
              && active.endMin === entry.endMin
              && active.workRoomId === entry.workRoomId;
            return (
              <div key={`${entry.jobType}:${entry.startMin}:${entry.workRoomId}`} className="ci-panel__work-schedule-row">
                {isActive && <span className="ci-panel__work-now">当前</span>}
                <span>{JOB_LABEL[entry.jobType] ?? "工作"}</span>
                <span>{hhmm(entry.startMin)}–{hhmm(entry.endMin)}</span>
                <span>{entry.location}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Page2Personal({ snap, state }: { snap: CharaInfoSnapshot; state: GameState }) {
  const p = snap.personality;
  return (
    <div className="ci-panel__page" data-testid="ci-page-2">
      <BasicHeaderView header={snap.header} callName={snap.callName} charaNum={snap.charaNum} />

      <Section title="个人情报" testid="ci-personal-body">
        <div className="ci-panel__grid2">
          <div className="ci-panel__kv"><b>性格傾向</b> <span className="ci-panel__kv-val">{p.type || "（未判明）"}</span></div>
          <div className="ci-panel__kv"><b>自宅位置</b> <span className="ci-panel__kv-val">{p.homeLocationMasked ? "■■■■■" : (p.homeLocation ?? "（未知）")}</span></div>
          <div className="ci-panel__kv"><b>起床</b> <span className="ci-panel__kv-val">{hhmm(p.schedule.wakeMin)}</span></div>
          <div className="ci-panel__kv"><b>就寝</b> <span className="ci-panel__kv-val">{hhmm(p.schedule.sleepMin)}</span></div>
          {!snap.header.isMaster && (
            <>
              <div className="ci-panel__kv"><b>来訪</b> <span className="ci-panel__kv-val">{hhmm(p.schedule.visitMin)}</span></div>
              <div className="ci-panel__kv"><b>帰宅</b> <span className="ci-panel__kv-val">{hhmm(p.schedule.returnMin)}</span></div>
            </>
          )}
        </div>
        <WorkScheduleView state={state} charaNum={snap.charaNum} />
      </Section>

      <Section title="角色介绍" testid="ci-introduction-body">
        <IntroView paragraphs={p.introduction} workInfo="" />
      </Section>

      <Section title="人际关系（相性表）" testid="ci-compat-body">
        <CompatTableView rows={snap.compat} />
      </Section>

      {snap.narrative.length > 0 && (
        <Section title="心境" testid="ci-narrative-body">
          {snap.narrative.map((para) => (
            <p key={para.id} className="ci-panel__narrative">
              <span className="ci-panel__narrative-label">{para.label}</span>
              {para.text}
            </p>
          ))}
        </Section>
      )}

      {snap.personalHistory.length > 0 && (
        <Section title="初次记录" testid="ci-history-body">
          <div className="ci-panel__grid2">
            {snap.personalHistory.map((h) => (
              <div key={h.category} className="ci-panel__kv">
                <b>{h.label}</b>
                <span className="ci-panel__kv-val">第 {(h.dayIndex ?? 0) + 1} 日</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Page3Preference({ snap }: { snap: CharaInfoSnapshot }) {
  const pref: CharaPreference = snap.preference;
  return (
    <div className="ci-panel__page" data-testid="ci-page-3">
      <BasicHeaderView header={snap.header} callName={snap.callName} charaNum={snap.charaNum} />

      <Section title="感性 · 喜欢" testid="ci-taste-sense-like">
        <TasteView title="好き" view={pref.likes} locked={pref.likes?.masked ?? false} />
      </Section>
      <Section title="感性 · 讨厌" testid="ci-taste-sense-dislike">
        <TasteView title="嫌い" view={pref.dislikes} locked={pref.dislikes?.masked ?? false} />
      </Section>
      <Section title="料理 · 喜欢味道" testid="ci-taste-food-like">
        <TasteView title="好きな味" view={pref.foodLikes} locked={pref.foodLikes?.masked ?? false} />
      </Section>
      <Section title="料理 · 讨厌味道" testid="ci-taste-food-dislike">
        <TasteView title="讨厌な味" view={pref.foodDislikes} locked={pref.foodDislikes?.masked ?? false} />
      </Section>

      {pref.assistEffects.length > 0 && (
        <Section title="料理 · 助手効果（得意料理永远可见）" testid="ci-taste-assist">
          <TasteView title="助手効果" view={{ tags: pref.assistEffects }} locked={false} specialty={pref.specialty} />
        </Section>
      )}

      {pref.preferredPosition && (
        <Section title="喜欢的体位" testid="ci-taste-position">
          <p className="ci-panel__narrative"><span className="ci-panel__narrative-label"># {pref.preferredPosition.tier}</span>{pref.preferredPosition.text}</p>
        </Section>
      )}

      <Section title="礼物历史" testid="ci-gift-history-body">
        <GiftHistoryView rows={snap.giftHistory} />
      </Section>
    </div>
  );
}

function Page4BodyInfo({ snap }: { snap: CharaInfoSnapshot }) {
  const bi: BodyInfo | null = snap.bodyInfo;
  return (
    <div className="ci-panel__page" data-testid="ci-page-4">
      <BasicHeaderView header={snap.header} callName={snap.callName} charaNum={snap.charaNum} />

      {!bi ? (
        <Section title="身体情报" testid="ci-body-info">
          <p className="ci-panel__body-empty">该角色不在场内。</p>
        </Section>
      ) : (
        <>
          <Section title="身体情报表（前面）" testid="ci-body-front">
            <BodySideView sections={bi.front} />
          </Section>
          <Section title="身体情报里（里面）" testid="ci-body-back">
            <BodySideView sections={bi.back} />
          </Section>
        </>
      )}
    </div>
  );
}

function Page5FallOrSkill({ snap, state }: { snap: CharaInfoSnapshot; state: GameState }) {
  if (snap.charaNum === 0) {
    const track: SkillTrackEntry[] = evaluateSkillTrack(state, snap.charaNum);
    return (
      <div className="ci-panel__page" data-testid="ci-page-5">
        <BasicHeaderView header={snap.header} callName={snap.callName} charaNum={snap.charaNum} />
        <Section title="素质获得" testid="ci-skill-body">
          {track.map((t) => (
            <div key={t.name} className="ci-panel__skillrow">
              <span className={`ci-panel__skillname${t.achieved ? " ci-panel__skillname--got" : ""}`}>
                {t.achieved ? "✅" : "⬜"} {t.name}
              </span>
              <span className="ci-panel__skillcond">
                {t.achieved ? "已获得" : t.conditions.map((c) => `${c.label} ${c.passed ? "✓" : `${c.current}/${c.threshold}`}`).join("　")}
              </span>
            </div>
          ))}
        </Section>
      </div>
    );
  }
  const reqs: FallRequirement[] = evaluateFallRequirements(state, snap.charaNum);
  return (
    <div className="ci-panel__page" data-testid="ci-page-5">
      <BasicHeaderView header={snap.header} callName={snap.callName} charaNum={snap.charaNum} />
      <Section title="陷落状态" testid="ci-fall-body">
        {reqs.map((r) => (
          <div key={r.stage} className="ci-panel__fallcard" data-testid={`ci-fall-${r.stage}`}>
            <p className="ci-panel__subtitle">
              <span className={`ci-panel__fallbadge ci-panel__fallbadge--${r.status}`}>
                {r.status === "achieved" ? "✅ 已达成" : r.status === "infeasible" ? "⛔ 无法达成" : "⬜ 待达成"}
              </span>
              {r.label}
            </p>
            <div className="ci-panel__fallrows">
              {r.rows.map((row) => (
                <span key={row.key} className={`ci-panel__fallrow${row.passed ? " ci-panel__fallrow--ok" : ""}`}>
                  {row.key} {row.current}/{row.threshold} {row.passed ? "✓" : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Section>
      <Section title="浮气把握" testid="ci-uwaki-body">
        <UwakiView rows={snap.uwaki} />
      </Section>
    </div>
  );
}

function Page6KojOption({ snap, state }: { snap: CharaInfoSnapshot; state: GameState }) {
  const probe: KojoOptionProbe = useMemo(() => probeKojoOption(state, snap.charaNum), [state, snap.charaNum]);
  return (
    <div className="ci-panel__page" data-testid="ci-page-6">
      <BasicHeaderView header={snap.header} callName={snap.callName} charaNum={snap.charaNum} />
      <Section title="剧本设置" testid="ci-kojo-body">
        {probe.hasOptionPage ? (
          <p className="ci-panel__muted">该角色的剧本设置由其 kojo 作者提供（已检测到 OPTION 钩子）。现代 runtime 暂未加载外部 ERB 模块 — 设置页由 mod 作者接管。</p>
        ) : (
          <p className="ci-panel__muted">该角色暂无剧本设置页。</p>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main popup
// ---------------------------------------------------------------------------

interface Props {
  state: GameState;
  charaNum: number;
  onClose: () => void;
}

function fmtWindow(windowStart: number, windowEnd: number): string {
  const sh = Math.floor(windowStart / 60);
  const sm = windowStart % 60;
  const eh = Math.floor(windowEnd / 60);
  const em = windowEnd % 60;
  return `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}-${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

function AgentPage({ snap }: { snap: AgentInfoSnapshot }) {
  return (
    <div className="ci-panel__page ci-panel__page--agent" data-testid="ci-agent-page">
      {snap.goals.length > 0 && (
        <section className="ci-panel__section" data-testid="ci-agent-goals">
          <h4>当前目标</h4>
          <ul>
            {snap.goals.map((g, i) => (
              <li key={i}>
                <span className={`ci-panel__badge ci-panel__badge--${g.status}`}>{g.status === "active" ? "进行中" : g.status}</span>
                {" "}{g.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {snap.planSelections.length > 0 && (
        <section className="ci-panel__section" data-testid="ci-agent-plan">
          <h4>今日计划</h4>
          <ul>
            {snap.planSelections.map((p, i) => (
              <li key={i}>[{fmtWindow(p.windowStart, p.windowEnd)}] {p.label}</li>
            ))}
          </ul>
        </section>
      )}

      {snap.latestReflection && (
        <section className="ci-panel__section" data-testid="ci-agent-reflection">
          <h4>最近心境</h4>
          <p>{snap.latestReflection}</p>
        </section>
      )}

      {snap.topMemories.length > 0 && (
        <section className="ci-panel__section" data-testid="ci-agent-memories">
          <h4>重要记忆</h4>
          <ul>
            {snap.topMemories.map((m, i) => (
              <li key={i}>
                <span className="ci-panel__badge ci-panel__badge--importance">{m.importance}</span>
                {" "}{m.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {snap.latestDiary && (
        <section className="ci-panel__section" data-testid="ci-agent-diary">
          <h4>今日日记</h4>
          <p>{snap.latestDiary}</p>
        </section>
      )}

      {!snap.goals.length && !snap.planSelections.length && !snap.latestReflection
        && !snap.topMemories.length && !snap.latestDiary && (
        <p className="ci-panel__note">暂无智能体数据。与角色多互动后，夜间会自动整理。</p>
      )}
    </div>
  );
}

export default function CharacterInfoPopup({ state, charaNum, onClose }: Props) {
  const [page, setPage] = useState(0);
  const snap: CharaInfoSnapshot | null = useMemo(
    () => buildCharaInfoSnapshot(state, charaNum),
    [state, charaNum],
  );

  if (!snap) {
    return (
      <div className="ci-panel__scrim" data-testid="character-info-panel" onClick={onClose}>
        <div className="ci-panel" role="dialog" onClick={(e) => e.stopPropagation()}>
          <div className="ci-panel__head">
            <span className="ci-panel__title">角色情报 — 未选择</span>
            <button type="button" className="ci-panel__close" data-testid="ci-panel-close" onClick={onClose}>✕</button>
          </div>
        </div>
      </div>
    );
  }

  const isMaster = snap.charaNum === 0;
  const label5 = isMaster ? "技能习得" : "陷落状态";
  // PAGE 6 剧本设置 — NPC 且检测到 kojo OPTION 钩子才显示 tab。
  const showKojo = !isMaster && probeKojoOption(state, snap.charaNum).hasOptionPage;
  // PAGE 7 智能体 — NPC 且 agent runtime enabled 且 agent 数据非空。
  const showAgent = !isMaster && snap.agentSnapshot !== null;

  return (
    <div className="ci-panel__scrim" data-testid="character-info-panel" onClick={onClose}>
      <div className="ci-panel" role="dialog" aria-label="角色情报" onClick={(e) => e.stopPropagation()}>
        <div className="ci-panel__head">
          <span className="ci-panel__title">
            角色情报
            <span className="ci-panel__title-name">{snap.callName}</span>
            <span className="ci-panel__title-role">{isMaster ? "主角" : "NPC"}</span>
          </span>
          <button type="button" className="ci-panel__close" data-testid="ci-panel-close" onClick={onClose}>✕</button>
        </div>

        <div className="ci-panel__bodywrap">
          {/* Tab navigation */}
          <nav className="ci-panel__tabs" data-testid="ci-tabs">
            {PAGES.map((name, idx) => {
              const label = idx === 5 ? label5 : name;
              return (
                <button
                  key={idx}
                  type="button"
                  className={`ci-panel__tab${page === idx ? " ci-panel__tab--active" : ""}`}
                  data-testid={`ci-tab-${idx}`}
                  onClick={() => setPage(idx)}
                >{label}</button>
              );
            })}
            {showKojo && (
              <button
                key="6"
                type="button"
                className={`ci-panel__tab${page === 6 ? " ci-panel__tab--active" : ""}`}
                data-testid="ci-tab-6"
                onClick={() => setPage(6)}
              >剧本设置</button>
            )}
            {showAgent && (
              <button
                key="7"
                type="button"
                className={`ci-panel__tab${page === 7 ? " ci-panel__tab--active" : ""}`}
                data-testid="ci-tab-7"
                onClick={() => setPage(7)}
              >智能体</button>
            )}
          </nav>

          {/* Page body */}
          <div className="ci-panel__pagebody" data-testid="ci-page-body">
            {page === 0 && <Page0ClothesAbility snap={snap} />}
            {page === 1 && <Page1ExpJuel snap={snap} />}
            {page === 2 && <Page2Personal snap={snap} state={state} />}
            {page === 3 && <Page3Preference snap={snap} />}
            {page === 4 && <Page4BodyInfo snap={snap} />}
            {page === 5 && <Page5FallOrSkill snap={snap} state={state} />}
            {page === 6 && showKojo && <Page6KojOption snap={snap} state={state} />}
            {page === 7 && showAgent && <AgentPage snap={snap.agentSnapshot!} />}
          </div>
        </div>
      </div>
    </div>
  );
}
