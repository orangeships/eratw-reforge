import { useEffect, useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { StoryProgram } from "../../../modernization/runtime/story/types.js";
import { hookBlockReason } from "../../../modernization/runtime/story/dialogue-hook.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { useAiStore } from "./store.js";
import { describeNarrativeDirectorStatus, formatNarrativeWindow, NARRATIVE_PHASE_LABELS } from "./narrative-status.js";

const LABELS: Record<string, string> = {
  scheduled: "已创建 · 等待时间或到场", ready: "已就绪", active: "进行中", missed: "错过窗口",
  resolved: "已完成", expired: "已过期", cancelled: "已取消", completed: "已完成", aborted: "已中止",
  "awaiting-player": "等待玩家互动", paused: "已暂停", abandoned: "已放弃",
  pending: "等待处理", offered: "已表达 · 等待回应或执行", blocked: "条件阻塞", deferred: "已推迟", declined: "已拒绝",
  waiting: "等待触发", playing: "正在演出", "waiting-hooks": "等待对话钩子完成",
  success: "成功", error: "失败", skipped: "未启动 / 跳过",
};
const label = (value: string) => LABELS[value] ?? value;
const programTitle = (program: StoryProgram) => program.version === 2 ? program.title : `旧版剧情 ${program.templateId}`;

function ProgramProgress({ program }: { program: StoryProgram }) {
  return <div className="l3-status__program">
    <p>执行器：{label(program.status)}{program.version === 2 && program.lifecycleReason ? `；${program.lifecycleReason}` : ""}</p>
    {program.version === 2 ? <>
      {program.lifecycleReason?.startsWith("dialogue-wait:") && <p>本次剧情未推进，等待下一次演化；故事线仍保留。</p>}
      {program.status === "active" && program.nodes.some(node => node.id === program.cursorNodeId && node.kind === "dialogue-hook")
        && <p>等待角色通过普通交谈或 AI 对话自然引出剧情；不会预先播放固定台词。</p>}
      <p>第 {(program.roundIndex ?? 0) + 1} 幕 · 本幕已执行 {program.executedNodeIds.length} / {program.nodes.length} 个节点（分支不会全部执行）</p>
      <p>当前节点：{program.cursorNodeId ?? "本幕结束"}；已完成 {program.rounds?.length ?? 0} 幕</p>
      <p>已执行能力：{program.executedCapabilityIds.length}；已记录选择：{Object.keys(program.selectedChoices).length}</p>
    </> : <p>兼容旧版剧情（V1）</p>}
  </div>;
}

/** Live diagnostics with explicit, Runtime-owned story management actions. */
export default function NarrativeStatusPanel({ state }: { state: GameState }) {
  const settings = useAiStore(s => s.settings);
  const entries = useAiStore(s => s.debugEntries);
  const status = useGameStateStore(s => s.narrativeDirectorStatus);
  const choose = useGameStateStore(s => s.chooseNarrativeSituationAction);
  const setArcStatus = useGameStateStore(s => s.setStoryArcStatusAction);
  const abortProgram = useGameStateStore(s => s.abortStoryProgramAction);
  const [showHistory, setShowHistory] = useState(false);
  const [managementResult, setManagementResult] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [choiceResult, setChoiceResult] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!status && !choosing) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status, choosing]);
  const logs = entries.filter(e => e.feature === "narrative-director");
  const running = logs.find(e => e.status === "pending");
  const view = describeNarrativeDirectorStatus(state, status, entries);
  const events = state.narrativeEvents ?? [];
  const arcs = state.storyArcs ?? [];
  const visibleArcs = arcs.filter(arc => showHistory || ["active", "paused"].includes(arc.status));
  const visibleEvents = events.filter(event => showHistory || ["scheduled", "ready", "active"].includes(event.status));
  const liveArcCount = arcs.filter(arc => ["active", "paused"].includes(arc.status)).length;
  const session = state.narrativeSituationSession;
  const program = state.storyProgram;
  const busy = status !== null || choosing;
  const gateReasons = [
    ...(!settings.enabled ? ["AI 总开关关闭"] : []),
    ...(!settings.narrativeEnabled ? ["L3 叙事导演关闭"] : []),
    ...(state.agentRuntime?.settings.masterEnabled !== true ? ["Agent Runtime 关闭"] : []),
    ...(!settings.apiKey.trim() ? ["未配置 API 密钥"] : []),
  ];
  const canChoose = gateReasons.length === 0 && !busy;
  const name = (id: number) => id === 0 ? "主角" : state.charas[id]?.callName ?? state.charas[id]?.name ?? `角色 #${id}`;
  const getFailure = () => {
    const latest = useAiStore.getState().debugEntries.find(e => e.feature === "narrative-director");
    return latest?.error ?? latest?.skipReason ?? "未能提交剧情，请查看下方请求记录。";
  };
  const chooseSituation = async (id: string) => {
    setChoosing(true);
    setChoiceResult(null);
    try {
      setChoiceResult(await choose(id) ? "剧情已创建，可查看下方事件和进度。" : getFailure());
    } catch (error) {
      setChoiceResult(`创建失败：${String(error)}`);
    } finally { setChoosing(false); }
  };
  const manageArc = (id: string, title: string, next: "active" | "paused" | "abandoned") => {
    setArcStatus(id, next);
    if (useGameStateStore.getState().state?.storyArcs?.find(arc => arc.id === id)?.status !== next) {
      setManagementResult(`「${title}」的状态已变化，请查看最新记录。`);
      return;
    }
    setManagementResult(next === "abandoned" ? `「${title}」已结束，不再演化；已发生的记录保留。` : `「${title}」已${next === "paused" ? "暂停" : "恢复"}。`);
  };

  return <div className="l3-status" data-testid="l3-status-panel">
    <div className="l3-status__summary" role="status" aria-live="polite">
      <strong>{status ? NARRATIVE_PHASE_LABELS[status.phase] : program && !["completed", "aborted"].includes(program.status) ? `当前剧情：${label(program.status)}` : view?.label ?? "当前没有正在生成的 L3 请求"}</strong>
      {view?.detail && <p>{view.detail}</p>}
      {!status && (logs[0]?.error || logs[0]?.skipReason) && <p>最近结果：{logs[0].error ?? logs[0].skipReason}</p>}
      {status && running && <p>本次请求已等待 {Math.max(0, Math.floor((now - running.createdAt) / 1000))} 秒；{status.phase === "commit" ? "正在等待当前对话释放提交位置" : "等待的是模型响应与校验"}，不代表游戏时间推进。</p>}
      <p className="l3-status__counts" data-testid="l3-created-summary">存档累计已创建事件：{events.length}（当前可参与 {visibleEvents.filter(event => ["scheduled", "ready", "active"].includes(event.status)).length}）；故事线：{arcs.length}（未结束 {liveArcCount}）；待选方向：{session?.situations.length ?? 0}</p>
      <p>累计包含已完成、错过和过期记录；本次生成结果请查看候选菜单或最近请求。</p>
      {events.length === 0 && <p>{program ? "已有保存的剧情执行器，尚无叙事事件记录。" : "尚未创建叙事事件。候选方向生成成功后，还需要选定方向并通过剧情校验。"}</p>}
    </div>
    <div className="l3-status__toolbar">
      <label><input type="checkbox" checked={showHistory} onChange={event => setShowHistory(event.target.checked)} /> 显示已结束 / 过期记录</label>
      <span>过期的是事件窗口时，所属故事线仍可能演化。</span>
    </div>
    {managementResult && <p className="l3-status__feedback" role="status">{managementResult}</p>}

    {session && <section aria-label="候选故事方向">
      <h3>候选方向 · {session.autoSelect ? "由系统选择" : "请选择一个，继续创建剧情"}</h3>
      {session.playerIntent && <p>你的意图：{session.playerIntent}</p>}
      {session.situations.map(situation => <article className="l3-status__card" key={situation.id}>
        <strong>{situation.premise}</strong>
        <p>{situation.tension}</p><p>相遇线索：{situation.meetingPoint}</p>
        <p>参与者：{situation.participantIds.map(name).join("、")}；地点：{situation.locationIds.join("、")}</p>
        {!session.autoSelect && <button type="button" disabled={!canChoose} onClick={() => void chooseSituation(situation.id)}>选择这个方向并生成剧情</button>}
      </article>)}
    </section>}
    {choiceResult && <p role="status">{choiceResult}</p>}

    <section aria-label="故事线进度">
      <h3>故事线与等待条件</h3>
      <p className="l3-status__hint">暂停可恢复；结束会停止后续演化并保留历史，不会补写剧情结局。</p>
      {!visibleArcs.length && <p>{arcs.length ? "所有故事线均已结束，可勾选上方选项查看历史。" : "尚无故事线。"}</p>}
      {visibleArcs.map(arc => <article className="l3-status__card" key={arc.id}>
        <div className="l3-status__card-head"><strong>{arc.title}</strong><span className="l3-status__badge">{label(arc.status)} · 阶段 {arc.phase}</span></div>
        {["active", "paused"].includes(arc.status) && <div className="l3-status__actions">
          <button type="button" onClick={() => manageArc(arc.id, arc.title, arc.status === "paused" ? "active" : "paused")}>{arc.status === "paused" ? "恢复故事线" : "暂停故事线"}</button>
          <button type="button" className="l3-status__danger" onClick={() => manageArc(arc.id, arc.title, "abandoned")}>结束故事线</button>
        </div>}
        {arc.background && <details>
          <summary>稳定故事背景 · {({ player: "玩家原文 / 必要信息", generated: "候选方向生成", legacy: "旧档记录恢复" })[arc.background.source]}</summary>
          <p style={{ whiteSpace: "pre-wrap" }}>{arc.background.text}</p>
          <small>绑定后沿用；创作背景不等于已发生事实或角色共有知识。</small>
        </details>}
        <p>已完成剧情记录：{arc.beatHistory.length}；未解决线索：{arc.unresolvedThreads.join("；") || "无"}</p>
        {arc.goals.length > 0 && <p>目标：{arc.goals.join("；")}</p>}
        {arc.maintenance?.conflict && <p>当前局势：{arc.maintenance.conflict.summary}</p>}
        {arc.maintenance?.waitOn && <p>等待条件：{({ time: "时间", event: "事件", meeting: "相遇", "player-action": "玩家行动" })[arc.maintenance.waitOn.kind]} {arc.maintenance.waitOn.refId ?? ""}</p>}
        {arc.maintenance?.nextChance && <p>下次机会：{arc.maintenance.nextChance.locationIds.join("、")}；{formatNarrativeWindow(arc.maintenance.nextChance.earliestTick, arc.maintenance.nextChance.latestTick)}（机会承诺，尚不代表事件已创建）</p>}
        {(arc.maintenance?.lastFailure || arc.lifecycleReason) && <p>最近原因：{arc.maintenance?.lastFailure?.reason ?? arc.lifecycleReason}</p>}
        <small>{arc.id}</small>
      </article>)}
      {(state.storylets ?? []).filter(story => showHistory || story.status === "active").map(story => <article className="l3-status__card" key={story.id}>
        <strong>{story.document.title} · {label(story.status)}</strong>
        <p>当前场景：{story.currentSceneId} · {label(story.phase)}；完成场景：{story.history.length}</p>
        {story.blockedReason && <p>等待原因：{story.blockedReason}</p>}
      </article>)}
      {(state.narrativeHooks ?? []).filter(hook => showHistory || ["pending", "offered", "blocked", "deferred"].includes(hook.status)).map(hook => <article className="l3-status__card" key={hook.id}>
        <strong>对话钩子 · {name(hook.speakerId)} · {label(hook.status)}</strong>
        <p>{hook.objective}</p><p>故事 {hook.storyId} / 场景 {hook.sceneId}</p>
        {hookBlockReason(state, hook) && <p>条件原因：{hookBlockReason(state, hook)}</p>}
        <p>完成条件：{hook.completion?.kind === "capability" ? "等待 Runtime 实际执行能力" : hook.completion?.kind === "player-response" ? "等待玩家正式回应" : "表达完成"}；已表达：{hook.lastReceipt ? "是" : "否"}；玩家回应：{hook.playerResponse?.result ?? "无"}</p>
      </article>)}
    </section>

    <section aria-label="已创建剧情">
      <h3>已创建剧情与执行进度</h3>
      {!visibleEvents.length && <p>{events.length ? `暂无待进行事件；${events.length} 条历史记录已收起。` : "没有已接纳的事件。"}</p>}
      {program && (showHistory || !["completed", "aborted"].includes(program.status)) && <article className="l3-status__card"><strong>当前执行：{programTitle(program)}</strong><ProgramProgress program={program} />
        {!["completed", "aborted"].includes(program.status) && <button type="button" className="l3-status__danger" onClick={() => { abortProgram(); setManagementResult("当前剧情已中止，所属故事线（如有）停止演化；历史记录保留。"); }}>中止当前剧情</button>}
      </article>}
      {[...visibleEvents].reverse().map(event => <article className="l3-status__card" key={event.id}>
        <div className="l3-status__card-head"><strong>{event.title}</strong><span className="l3-status__badge">{label(event.status)}</span></div>
        {(event.introText || event.objectiveText) && <details><summary>开场与目标</summary><p>{event.introText}</p>{event.objectiveText && <p>目标：{event.objectiveText}</p>}</details>}
        <p>地点：{event.locationIds.join("、")}；参与者：{event.participantIds.map(name).join("、")}</p>
        <p>窗口：{formatNarrativeWindow(event.windowStartTick, event.windowEndTick)}</p>
        {event.lifecycleReason && <p>状态原因：{event.lifecycleReason}</p>}
        {event.program.id !== program?.id && <ProgramProgress program={event.program} />}
        <small>事件 {event.id} · 故事线 {event.arcId ?? "独立事件"}</small>
      </article>)}
    </section>

    <details className="l3-status__diagnostics" aria-label="L3 组件状态">
      <summary>组件状态</summary>
      <dl className="l3-status__components">
        <dt>启动条件</dt><dd>{gateReasons.length ? gateReasons.join("；") : "已满足"}</dd>
        <dt>角色上下文</dt><dd>活跃角色 {state.agentRuntime?.activeRoster?.length ?? 0} 人；{(state.agentRuntime?.activeRoster ?? []).map(name).join("、") || "暂无活跃角色，可能没有合法候选"}</dd>
        <dt>候选规划</dt><dd>{status?.phase === "situations" ? "正在请求模型" : session ? session.autoSelect ? "自动选择中" : "等待你选择方向" : "没有待选方向"}</dd>
        <dt>开场与结构</dt><dd>{status && ["opening", "graph", "validating"].includes(status.phase) ? NARRATIVE_PHASE_LABELS[status.phase] : "当前无生成请求"}</dd>
        <dt>前台执行器</dt><dd>{program ? `${programTitle(program)} · ${label(program.status)}` : "尚无剧情占用前台"}</dd>
        <dt>后台推演 / 续幕</dt><dd>{status?.phase === "evolution" || status?.phase === "continuation" ? NARRATIVE_PHASE_LABELS[status.phase] : "当前空闲；满足条件时才请求"}</dd>
        <dt>对话钩子 / 小故事</dt><dd>{state.narrativeHooks?.length ?? 0} 个钩子；{state.storylets?.length ?? 0} 个小故事</dd>
      </dl>
      <p>状态页自动刷新。查看页面不会触发 L3、推进时间或修改存档。请求记录仅保留本次会话的最近条目。</p>
    </details>

    <details className="l3-status__diagnostics" aria-label="L3 最近请求">
      <summary>最近请求与输出（{logs.length}）</summary>
      {!logs.length && <p>本次会话暂无 L3 请求记录。已创建的剧情仍以上方存档状态为准。</p>}
      {logs.map(entry => <details className="l3-status__card" key={entry.requestId}>
        <summary>{new Date(entry.createdAt).toLocaleTimeString()} · {entry.narrativePhase ? NARRATIVE_PHASE_LABELS[entry.narrativePhase] : "L3 调度"} · {label(entry.status)}{entry.durationMs !== undefined ? ` · ${(entry.durationMs / 1000).toFixed(1)} 秒` : ""}</summary>
        <p>{entry.error ?? entry.skipReason ?? (entry.status === "success" ? "该请求阶段已通过；剧情是否创建以上方事件列表为准。" : entry.status === "pending" ? "等待模型响应或提交校验。" : "请求已结束，未提交新结果。")}</p>
        <small>{entry.requestId}</small>
        {entry.response && <pre>{entry.response}</pre>}
      </details>)}
    </details>
  </div>;
}
