import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { deriveRelationshipAuthority } from "../../../modernization/runtime/state/attitude.js";
import {
  STONE_CONTEST_THEMES,
  stoneClerkStoryOpportunity,
  stoneContestDifficulty,
  stoneOpponentStatus,
  type StoneContestItem,
  type StoneContestStrategy,
} from "../../../modernization/runtime/state/stone-contest.js";
import {
  STONE_CONTEST_DURATION_FRAMES,
  STONE_PLATFORM_LEFT_Q,
  STONE_PLATFORM_RIGHT_Q,
  STONE_WORLD_WIDTH_Q,
  advanceStoneSimulation,
  createStoneSimulation,
  stoneCandidateQueue,
  stoneOperationFromKeyboard,
  stoneOperationFromPointer,
  stoneReplayFromSimulation,
  type StoneBody,
  type StoneCandidate,
  type StonePlacementOperation,
  type StoneReplayResult,
  type StoneSimulationState,
} from "../../../modernization/runtime/state/stone-contest-physics.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { useSceneStore } from "../state/scene-store.js";

const WIDTH = 1_000;
const HEIGHT = 680;

const STRATEGIES: readonly { id: StoneContestStrategy; label: string; hint: string }[] = [
  { id: "quick", label: "快速", hint: "候选更险，接触更活跃" },
  { id: "normal", label: "普通", hint: "标准物理手感" },
  { id: "careful", label: "小心", hint: "候选稍规整，摩擦更强" },
];

const ITEMS: readonly { id: StoneContestItem; label: string; level: number }[] = [
  { id: "small-hat", label: "小石帽", level: 1 },
  { id: "strength-jizo", label: "肉体强化地藏", level: 2 },
  { id: "carefree", label: "随心堆石", level: 3 },
  { id: "honest-sign", label: "诚实石路标", level: 4 },
  { id: "none", label: "不携带", level: 0 },
];

function polygonPath(ctx: CanvasRenderingContext2D, body: Pick<StoneBody, "verticesQ">, scale: number): void {
  body.verticesQ.forEach((point, index) => {
    const x = point.xQ * scale;
    const y = -point.yQ * scale;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function drawBody(ctx: CanvasRenderingContext2D, body: StoneBody, width: number, floorY: number, scale: number): void {
  const returned = body.state === "returned";
  const x = returned ? 62 + (body.id % 10) * Math.min(58, (width - 120) / 10) : body.xQ / STONE_WORLD_WIDTH_Q * width;
  const y = returned ? floorY + 72 + (body.id % 2) * 13 : floorY - body.yQ * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(body.angleQ * Math.PI / 1_800);
  ctx.beginPath();
  polygonPath(ctx, body, scale);
  const color = returned
    ? "rgba(73, 91, 90, .42)"
    : body.actor === "partner"
      ? body.stable ? "#d4a562" : "#f0bd72"
      : body.stable ? "#69d7c6" : "#9dfff0";
  ctx.fillStyle = color;
  ctx.strokeStyle = returned ? "rgba(112,140,136,.35)" : body.actor === "partner" ? "#ffe0a5" : "#d8fff8";
  ctx.lineWidth = returned ? 1 : 1.6;
  ctx.shadowColor = returned ? "transparent" : color;
  ctx.shadowBlur = returned ? 0 : body.state === "falling" ? 17 : 8;
  ctx.fill();
  ctx.stroke();
  ctx.clip();
  const sheen = ctx.createLinearGradient(-body.widthQ * scale / 2, -body.heightQ * scale / 2, body.widthQ * scale / 2, body.heightQ * scale / 2);
  sheen.addColorStop(0, "rgba(255,255,255,.26)");
  sheen.addColorStop(.35, "rgba(255,255,255,.03)");
  sheen.addColorStop(1, "rgba(0,0,0,.22)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-body.widthQ * scale, -body.heightQ * scale, body.widthQ * scale * 2, body.heightQ * scale * 2);
  ctx.restore();
}

function drawCandidateGhost(ctx: CanvasRenderingContext2D, candidate: StoneCandidate, x: number, y: number, rotationQ: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotationQ * 5 * Math.PI / 180);
  ctx.beginPath();
  polygonPath(ctx, { verticesQ: candidate.verticesQ }, scale);
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = "rgba(150, 255, 238, .78)";
  ctx.lineWidth = 1.3;
  ctx.shadowColor = "rgba(91, 245, 220, .45)";
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();
}

function drawContest(
  canvas: HTMLCanvasElement,
  replay: StoneReplayResult | null,
  cursorQ: number,
  rotationQ: number,
  candidate: StoneCandidate,
  elapsedFrames: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || WIDTH));
  const height = Math.max(1, Math.round(rect.height || HEIGHT));
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#010303";
  ctx.fillRect(0, 0, width, height);
  const floorY = height * .76;
  const scale = Math.min(width / STONE_WORLD_WIDTH_Q, height * .68 / 7_000);

  ctx.strokeStyle = "rgba(103, 226, 206, .055)";
  ctx.lineWidth = 1;
  for (let y = 54; y < floorY; y += 52) {
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 16) {
      const wave = y + Math.sin(x * .018 + elapsedFrames * .025 + y * .02) * 2.4;
      if (x < 0) ctx.moveTo(x, wave); else ctx.lineTo(x, wave);
    }
    ctx.stroke();
  }
  const left = STONE_PLATFORM_LEFT_Q / STONE_WORLD_WIDTH_Q * width;
  const right = STONE_PLATFORM_RIGHT_Q / STONE_WORLD_WIDTH_Q * width;
  const platform = ctx.createLinearGradient(left, 0, right, 0);
  platform.addColorStop(0, "rgba(50,104,96,.4)");
  platform.addColorStop(.5, "rgba(128,255,235,.82)");
  platform.addColorStop(1, "rgba(50,104,96,.4)");
  ctx.fillStyle = platform;
  ctx.fillRect(left, floorY, right - left, 3);
  ctx.fillStyle = "rgba(81, 160, 148, .1)";
  ctx.fillRect(left, floorY + 3, right - left, 17);
  ctx.strokeStyle = "rgba(125,255,235,.12)";
  ctx.strokeRect(left, floorY + 26, right - left, height - floorY - 34);
  ctx.fillStyle = "rgba(133,255,236,.36)";
  ctx.font = "10px 'Cascadia Mono', monospace";
  ctx.fillText("RETURN TRAY / 落石回收区", left + 8, floorY + 42);

  for (const body of replay?.bodies ?? []) drawBody(ctx, body, width, floorY, scale);

  const cursorX = cursorQ / STONE_WORLD_WIDTH_Q * width;
  drawCandidateGhost(ctx, candidate, cursorX, Math.max(66, height * .115), rotationQ, scale);
  ctx.setLineDash([5, 9]);
  ctx.strokeStyle = "rgba(128,255,236,.19)";
  ctx.beginPath();
  ctx.moveTo(cursorX, height * .16);
  ctx.lineTo(cursorX, floorY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function CandidateGlyph({ candidate }: { candidate: StoneCandidate }) {
  const points = candidate.verticesQ.map((point) => `${50 + point.xQ / Math.max(1, candidate.widthQ) * 62},${30 - point.yQ / Math.max(1, candidate.heightQ) * 38}`).join(" ");
  return <svg viewBox="0 0 100 60" aria-hidden="true"><polygon points={points} /></svg>;
}

export default function StoneContestScreen({ state }: { state: GameState }) {
  const session = state.stoneContestSession!;
  const progress = state.stoneContestProgress!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveFrameRef = useRef(session.elapsedFrames);
  const simulationRef = useRef<StoneSimulationState>(createStoneSimulation());
  const simulationKeyRef = useRef("");
  const [mode, setMode] = useState<"solo" | "couple">(session.partner > 0 ? "couple" : "solo");
  const [rank, setRank] = useState(0);
  const [partner, setPartner] = useState(session.partner);
  const [theme, setTheme] = useState(session.theme);
  const [strategy, setStrategy] = useState<StoneContestStrategy>("normal");
  const [item, setItem] = useState<StoneContestItem>("none");
  const [cursorQ, setCursorQ] = useState(5_000);
  const [rotationQ, setRotationQ] = useState(0);
  const [candidateSlot, setCandidateSlot] = useState(0);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(progress.clerkName);
  const setScreen = useSceneStore((store) => store.setScreen);
  const startContest = useGameStateStore((store) => store.startStoneContestAction);
  const appendPlacement = useGameStateStore((store) => store.appendStoneContestPlacementAction);
  const advanceClock = useGameStateStore((store) => store.advanceStoneContestClockAction);
  const continueContest = useGameStateStore((store) => store.continueStoneContestAction);
  const withdrawContest = useGameStateStore((store) => store.withdrawStoneContestAction);
  const forfeitContest = useGameStateStore((store) => store.forfeitStoneContestAction);
  const commitSettlement = useGameStateStore((store) => store.commitStoneContestSettlementAction);
  const leaveLobby = useGameStateStore((store) => store.leaveStoneContestLobbyAction);
  const renameClerk = useGameStateStore((store) => store.renameStoneContestClerkAction);
  const advanceStory = useGameStateStore((store) => store.advanceStoneClerkStoryAction);
  const [replay, setReplay] = useState<StoneReplayResult | null>(null);
  const difficulty = stoneContestDifficulty(state);
  const candidates = useMemo(() => stoneCandidateQueue(session.seed, difficulty, session.operations), [difficulty, session.operations, session.seed]);
  const candidate = candidates[Math.min(candidateSlot, 2)]!;
  const opponentStatus = stoneOpponentStatus(state);
  const story = stoneClerkStoryOpportunity(state);
  const clerk = progress.clerkCharaNum === undefined ? undefined : state.charas[progress.clerkCharaNum];
  const clerkRelationship = clerk
    ? deriveRelationshipAuthority(clerk, state.master, state)
    : undefined;
  const partners = Object.values(state.charas).filter((slot) => slot.charaNum !== progress.clerkCharaNum && slot.location === state.master.location);
  const dateLocked = state.dateSession?.phase === "active";
  const remainingSeconds = Math.max(0, Math.ceil((STONE_CONTEST_DURATION_FRAMES - session.elapsedFrames) * 20 / 1_000));
  const standing = replay?.stableCount ?? 0;
  const returned = replay?.returnedCount ?? 0;

  useEffect(() => {
    const key = `${session.id}:${session.round}:${session.bout}:${difficulty}:${session.item}:${session.strategy}`;
    const config = {
      seed: session.seed,
      difficulty,
      rescueCollapse: session.item === "small-hat",
      supportToleranceQ: session.strategy === "careful" ? 260 : session.strategy === "quick" ? -120 : 0,
    };
    if (simulationKeyRef.current !== key || session.elapsedFrames < simulationRef.current.frame) {
      simulationKeyRef.current = key;
      simulationRef.current = createStoneSimulation(config);
    }
    simulationRef.current = advanceStoneSimulation(simulationRef.current, session.operations, config, session.elapsedFrames);
    setReplay(stoneReplayFromSimulation(simulationRef.current, session.operations));
  }, [difficulty, session.bout, session.elapsedFrames, session.id, session.item, session.operations, session.round, session.seed, session.strategy]);

  useEffect(() => {
    if (session.phase !== "round") return;
    const baseFrame = session.elapsedFrames;
    const startedAt = performance.now();
    let lastCommitted = baseFrame;
    let raf = 0;
    const tick = (now: number) => {
      const frame = Math.min(STONE_CONTEST_DURATION_FRAMES, baseFrame + Math.floor((now - startedAt) / 20));
      liveFrameRef.current = frame;
      if (frame - lastCommitted >= 5 || frame === STONE_CONTEST_DURATION_FRAMES) {
        lastCommitted = frame;
        advanceClock(frame);
      }
      if (frame < STONE_CONTEST_DURATION_FRAMES) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advanceClock, session.bout, session.id, session.phase, session.round]);

  useEffect(() => {
    if (canvasRef.current && candidate) drawContest(canvasRef.current, replay, cursorQ, rotationQ, candidate, session.elapsedFrames);
  }, [candidate, cursorQ, replay, rotationQ, session.elapsedFrames]);

  const place = useCallback((operation: StonePlacementOperation) => {
    if (session.phase !== "round") return;
    appendPlacement(operation);
  }, [appendPlacement, session.phase]);

  const releaseKeyboard = useCallback(() => {
    place(stoneOperationFromKeyboard(
      liveFrameRef.current,
      cursorQ,
      rotationQ,
      candidate.sizeQ,
      candidate.candidateId % 4,
      "player",
      candidate.candidateId,
    ));
  }, [candidate, cursorQ, place, rotationQ]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (session.phase !== "round") return;
      if (["ArrowLeft", "ArrowRight", "Space", "Enter", "Escape", "KeyA", "KeyD", "KeyQ", "KeyE", "Digit1", "Digit2", "Digit3"].includes(event.code)) event.preventDefault();
      if (event.code === "Escape") { setConfirmForfeit(true); return; }
      if (event.code === "ArrowLeft" || event.code === "KeyA") setCursorQ((value) => Math.max(500, value - 230));
      if (event.code === "ArrowRight" || event.code === "KeyD") setCursorQ((value) => Math.min(9_500, value + 230));
      if (event.code === "KeyQ") setRotationQ((value) => Math.max(-12, value - 1));
      if (event.code === "KeyE") setRotationQ((value) => Math.min(12, value + 1));
      if (event.code === "Digit1") setCandidateSlot(0);
      if (event.code === "Digit2") setCandidateSlot(1);
      if (event.code === "Digit3") setCandidateSlot(2);
      if (event.code === "Space" || event.code === "Enter") releaseKeyboard();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [releaseKeyboard, session.phase]);

  const updatePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursorQ(Math.max(0, Math.min(STONE_WORLD_WIDTH_Q, Math.round((event.clientX - rect.left) / Math.max(1, rect.width) * STONE_WORLD_WIDTH_Q))));
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (session.phase !== "round") return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const operation = stoneOperationFromPointer(
      liveFrameRef.current,
      event.clientX,
      rect.left,
      rect.width,
      rotationQ,
      candidate.sizeQ,
      candidate.candidateId % 4,
      "player",
      candidate.candidateId,
    );
    setCursorQ(operation.xQ);
    place(operation);
  };

  const leave = () => { leaveLobby(); setScreen("mainGame"); };
  const settleAndLeave = () => { commitSettlement(); setScreen("mainGame"); };
  const chosenPartner = dateLocked ? state.dateSession!.partner : partner;
  const result = session.pendingSettlement?.roundResult;

  return (
    <main className={`stone-contest stone-contest--${session.phase}`} data-testid="stone-contest-screen">
      <header className="stone-contest__header">
        <div><small>SAI NO KAWARA / 彼岸</small><h1>STONE STACK // 积石竞赛</h1></div>
        <div className="stone-contest__clerk"><strong>{clerk?.callName ?? progress.clerkName}</strong><span>好感 {clerkRelationship?.favor ?? 0} · 信赖 {clerkRelationship?.trust ?? 0}</span></div>
        <button type="button" onClick={() => setHistoryOpen((value) => !value)}>LOG / 记录</button>
      </header>

      {session.phase === "lobby" ? (
        <section className="stone-contest__lobby" data-testid="stone-contest-lobby">
          <div className="stone-contest__panel stone-contest__welcome">
            <small className="stone-contest__eyebrow">30 SECOND PHYSICS MATCH</small>
            <h2>三选一，落下，然后让重力裁决。</h2>
            <p>每次从三枚随机不规则石头中选择一枚。越高 Rank，候选轮廓越险。石头会真实下落、碰撞、滚动；掉出台面的石头进入回收区，你可以继续选择下一枚。</p>
            <div className="stone-contest__tabs">
              <button className={mode === "solo" ? "is-active" : ""} type="button" onClick={() => setMode("solo")} disabled={dateLocked}>单人锦标赛</button>
              <button className={mode === "couple" ? "is-active" : ""} type="button" onClick={() => setMode("couple")} disabled={partners.length === 0 && !dateLocked}>双人共筑赛</button>
            </div>
            {mode === "solo" ? (
              <label>Rank
                <select value={rank} onChange={(event) => setRank(Number(event.target.value))}>
                  {["EASY", "NORMAL", "HARD", "LUNATIC", "PHANTASM"].map((label, index) => <option key={label} value={index} disabled={index > Math.min(4, progress.rank)}>{label} · 不规则度 {index + 1}</option>)}
                </select>
              </label>
            ) : (
              <>
                <label>搭档
                  <select value={chosenPartner} onChange={(event) => setPartner(Number(event.target.value))} disabled={dateLocked}>
                    <option value={0}>请选择</option>
                    {partners.map((slot) => <option key={slot.charaNum} value={slot.charaNum}>{slot.callName ?? `#${slot.charaNum}`}</option>)}
                  </select>
                </label>
                <label>主题
                  <select value={theme} onChange={(event) => setTheme(Number(event.target.value))} disabled={(state.time.date ?? 1) !== 31}>
                    {STONE_CONTEST_THEMES.map((label, index) => <option key={label} value={index + 1}>{index + 1}. {label}</option>)}
                  </select>
                </label>
              </>
            )}
            <label>手感
              <select value={strategy} onChange={(event) => setStrategy(event.target.value as StoneContestStrategy)}>
                {STRATEGIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {entry.hint}</option>)}
              </select>
            </label>
            <label>携带道具
              <select value={item} onChange={(event) => setItem(event.target.value as StoneContestItem)}>
                {ITEMS.map((entry) => <option key={entry.id} value={entry.id} disabled={entry.level > progress.itemLevel}>{entry.label}</option>)}
              </select>
            </label>
            <div className="stone-contest__lobby-actions">
              <button type="button" onClick={() => startContest({ mode, rank, partner: chosenPartner, theme, strategy, item })} disabled={mode === "couple" && chosenPartner <= 0}>START / 3,000 円</button>
              <button type="button" onClick={leave}>EXIT</button>
            </div>
          </div>
          <aside className="stone-contest__panel stone-contest__records">
            <h3>RECORD</h3>
            <p>单人 {progress.soloWins} 胜 / {progress.soloMatches} 次</p>
            <p>双人 {progress.coupleWins} 胜 / {progress.coupleMatches} 次</p>
            <p>主题奖杯 {progress.trophyCount} / 30</p>
            {story && <button type="button" onClick={advanceStory}>{story.title}</button>}
            {progress.namingStatus === "pending" && <div className="stone-contest__naming"><input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={24} /><button type="button" onClick={() => renameClerk(nameDraft)}>决定称呼</button></div>}
          </aside>
        </section>
      ) : (
        <section className="stone-contest__arena" data-testid="stone-contest-arena">
          <canvas ref={canvasRef} aria-label="积石重力碰撞赛场" onPointerMove={updatePointer} onPointerDown={onCanvasPointerDown} />
          <div className="stone-contest__scoreboard">
            <span>{session.mode === "solo" ? `ROUND ${Math.min(session.round + 1, session.maxRounds)} / ${session.maxRounds}` : `THEME / ${STONE_CONTEST_THEMES[session.theme - 1]}`}</span>
            <strong className={remainingSeconds <= 5 ? "is-danger" : ""}>{remainingSeconds.toString().padStart(2, "0")}.0</strong>
            <span>STACKED <b>{standing}</b> · RETURNED {returned}</span>
          </div>
          {session.phase === "round" && session.elapsedFrames < 34 && <div className="stone-contest__count-in">READY<br /><strong>30 SEC</strong></div>}
          <div className="stone-contest__candidate-rack" aria-label="三枚候选石">
            {candidates.map((entry, index) => (
              <button key={entry.candidateId} className={candidateSlot === index ? "is-active" : ""} type="button" onClick={() => setCandidateSlot(index)}>
                <small>0{index + 1}</small><CandidateGlyph candidate={entry} /><span>不规则 {entry.irregularityQ}</span>
              </button>
            ))}
          </div>
          <div className="stone-contest__controls">
            <button type="button" onClick={() => setRotationQ((value) => Math.max(-12, value - 1))}>Q ↶</button>
            <button className="stone-contest__drop" type="button" onClick={releaseKeyboard}>DROP / 放下</button>
            <button type="button" onClick={() => setRotationQ((value) => Math.min(12, value + 1))}>↷ E</button>
          </div>
          <aside className="stone-contest__subtitles" aria-live="polite">
            <small>LIVE OPPONENT FEED</small>
            {opponentStatus ? <p>{opponentStatus.text}</p> : <p>{state.charas[session.partner]?.callName ?? "搭档"} 正在自动挑选候选石，并与你交替共筑。</p>}
            {replay?.rescued && <p>小石帽介入：一枚落石被送回投放线上。</p>}
            {returned > 0 && <p>{returned} 枚石头已落入候选回收区，比赛继续。</p>}
          </aside>
          {session.phase === "between-rounds" && <div className="stone-contest__modal"><small>ROUND CLEAR</small><h2>本场胜利</h2>{result && <div className="stone-contest__versus"><span>我方<strong>{result.playerTotal}</strong></span><i>VS</i><span>对方<strong>{result.opponentTotal}</strong></span></div>}<button type="button" onClick={continueContest}>继续下一场</button><button type="button" onClick={withdrawContest}>结束并退还参赛费</button></div>}
          {session.phase === "settlement" && <div className="stone-contest__modal stone-contest__modal--result"><small>TIME UP / RESULT</small><h2>{session.pendingSettlement?.outcome === "champion" ? "锦标赛冠军" : session.pendingSettlement?.outcome === "couple" ? "双人赛结算" : "比赛结束"}</h2>{result && <div className="stone-contest__versus"><span>我方共堆<strong>{result.playerTotal}</strong><em>块</em></span><i>VS</i><span>对方共堆<strong>{result.opponentTotal}</strong><em>块</em></span></div>}{session.pendingSettlement?.coupleScore && <p>主题评分 {session.pendingSettlement.coupleScore.total} · {session.pendingSettlement.coupleScore.award}</p>}<button type="button" onClick={settleAndLeave}>确认结算并返回</button></div>}
        </section>
      )}

      {confirmForfeit && <div className="stone-contest__modal"><h2>比赛仍在计时</h2><p>现在离开会按本局失败结算。</p><button type="button" onClick={() => { setConfirmForfeit(false); forfeitContest(); }}>放弃本局</button><button type="button" onClick={() => setConfirmForfeit(false)}>继续比赛</button></div>}
      {historyOpen && <aside className="stone-contest__history"><button type="button" onClick={() => setHistoryOpen(false)}>CLOSE</button><h2>STONE LOG</h2>{progress.history.length === 0 ? <p>还没有已结算记录。</p> : progress.history.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</aside>}
    </main>
  );
}
