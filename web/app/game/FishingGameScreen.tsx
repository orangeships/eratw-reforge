import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  createFishingGameState,
  EMPTY_FISHING_INPUT,
  fishingCatchDescription,
  FISHING_LINES,
  FISHING_RODS,
  stepFishingGame,
  type FishingGameInput,
  type FishingGameState,
  type FishingKojoLine,
  type FishingShadow,
  type FishCatchResult,
  type GameState,
} from "../../../modernization/runtime/state/index.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { useSceneStore } from "../state/scene-store.js";
import { kojoColor } from "./kojo-colors.js";
import { clampDragVector } from "./touch-gesture.js";
import PixelSprite from "./pixel/PixelSprite.js";

import { drawFishing as draw } from "./ascii/fishing-renderer.js";
import "./ascii/fishing.css";

const WIDTH = 960;
const HEIGHT = 600;

/** Build a minimal session from a settlement so the screen can still render
 *  the terminal phase card when `state.fishingGame` has already been cleared
 *  (settlement-only reload / direct settled render). The screen never steps
 *  physics on this fallback — it only needs `catch` + `spotName`. */
function fishingFallbackSession(settlement: { catch: FishCatchResult; spotName: string; finishedAtTick: number }) {
  return {
    id: `fishing-settle-${settlement.finishedAtTick}`,
    seed: settlement.finishedAtTick,
    spotId: 1,
    spotName: settlement.spotName,
    partner: 0,
    startedAtTick: 0,
    rodId: "bamboo" as const,
    lineId: "cotton" as const,
    rodControl: 1,
    lineTension: 1,
    lineDurability: 100,
    catch: settlement.catch,
    biteDelayMs: 1,
    hookWindowMs: 1,
    difficulty: 1,
  };
}

function phaseTitle(phase: FishingGameState["phase"]): string {
  switch (phase) {
    case "casting": return "选择落点";
    case "waiting": return "静候咬钩";
    case "hook": return "鱼咬钩了！";
    case "fighting": return "收线搏鱼";
    case "landed": return "有所收获";
    case "snapped": return "鱼线断了";
    default: return "鱼脱钩了";
  }
}

function previewDensity(shadows: readonly FishingShadow[], x: number, y: number): number {
  return shadows.reduce((count, shadow) => count + (Math.hypot(shadow.x - x, shadow.y - y) < 12 ? 1 : 0), 0);
}

function Meter({ label, value, max, danger = false }: { label: string; value: number; max: number; danger?: boolean }) {
  const filled = Math.round(Math.max(0, Math.min(1, value / Math.max(1, max))) * 12);
  return <div className={`fishing-meter${danger ? " fishing-meter--danger" : ""}`}><span>{label}</span><span className="fishing-meter__glyphs" aria-hidden="true">[{"=".repeat(filled)}{".".repeat(12 - filled)}]</span><b>{Math.ceil(value)} / {Math.ceil(max)}</b></div>;
}

export type FishingCatchVisualKind = "fish" | "wood" | "creature" | "talisman" | "material" | "curio";

export interface FishingCatchPresentation {
  kind: FishingCatchVisualKind;
  label: string;
  glyph?: string;
  visualLabel: string;
}

/**
 * The fishing rank table can return ordinary inventory items as well as fish.
 * Keep this as a presentation-only projection so old persisted sessions do not
 * need a save migration just to render the correct catch identity.
 */
export function fishingCatchPresentation(result: FishCatchResult): FishingCatchPresentation {
  if (result.fish || result.itemId === 707 || result.itemId === 708) {
    const delicious = result.fish?.isDelicious ?? result.itemId === 708;
    return {
      kind: "fish",
      label: delicious ? "☆好吃的鱼☆" : "◇普通的鱼◇",
      visualLabel: "鱼",
    };
  }
  if (result.itemId === 610) return { kind: "wood", label: "◇漂流杂物◇", glyph: "木", visualLabel: "木材" };
  if (result.itemId === 706) return { kind: "creature", label: "◇水边生物◇", glyph: "蛙", visualLabel: "青蛙" };
  if (result.itemId === 131) return { kind: "talisman", label: "◇意外钓获◇", glyph: "札", visualLabel: "护符" };
  if ([606, 609, 643].includes(result.itemId)) {
    return { kind: "material", label: "◆珍稀素材◆", glyph: "材", visualLabel: "珍稀素材" };
  }
  return { kind: "curio", label: "◇奇怪的道具◇", glyph: "物", visualLabel: "道具" };
}

export function FishingCatchIdentity({ result }: { result: FishCatchResult }) {
  const presentation = fishingCatchPresentation(result);
  return <>
    <small>{presentation.label}</small>
    <div className="fishing-catch-card__pixel-art" data-testid="fishing-catch-visual" data-catch-kind={presentation.kind} aria-label={presentation.visualLabel} role="img">
      <PixelSprite name={presentation.kind === "creature" ? "frog" : presentation.kind === "material" ? "crystal" : presentation.kind} />
    </div>
    <h2>{result.name}</h2>
  </>;
}

export default function FishingGameScreen({ state }: { state: GameState }) {
  // The active session is null once `finishFishingAction` settles; the
  // settlement payload still carries the catch identity so the terminal
  // phase card can render the kojo branch until the player dismisses.
  const session = state.fishingGame;
  const settlement = state.fishingSettlement;
  // Track the most recent session so the settlement card has access to
  // catch identity even after `state.fishingGame` becomes null.
  const lastSessionRef = useRef<typeof session>(session);
  if (session) lastSessionRef.current = session;
  let viewSession = session ?? lastSessionRef.current;
  // A settlement can arrive with `fishingGame` already cleared (e.g. the
  // store settled on the previous render, or a reload landed on a settled
  // state). Rebuild a minimal session from the settlement so the terminal
  // phase card can render; only when both are absent is the screen empty.
  if (!viewSession && settlement) viewSession = fishingFallbackSession(settlement);
  if (!viewSession) {
    return <p data-testid="fishing-loading">正在准备钓场…</p>;
  }
  const [game, setGame] = useState(() => createFishingGameState(viewSession));
  const [kojoReveal, setKojoReveal] = useState(0);
  const gameRef = useRef(game);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef(new Set<string>());
  const pointerAimRef = useRef<{ x: number; y: number }>();
  const pointerDragRef = useRef<{ pointerId: number; x: number; y: number; phase: FishingGameState["phase"] } | null>(null);
  const pointerDirectionRef = useRef<-1 | 0 | 1>(0);
  const touchControlRef = useRef<HTMLDivElement>(null);
  const touchKnobRef = useRef<HTMLSpanElement>(null);
  const actionQueuedRef = useRef(false);
  const previousKeyActionRef = useRef(false);
  const finishFishing = useGameStateStore((store) => store.finishFishingAction);
  const commitFishingSettlement = useGameStateStore((store) => store.commitFishingSettlementAction);
  const setScreen = useSceneStore((store) => store.setScreen);
  const rod = FISHING_RODS.find((entry) => entry.id === viewSession.rodId)!;
  const line = FISHING_LINES.find((entry) => entry.id === viewSession.lineId)!;
  const description = fishingCatchDescription(viewSession.catch);
  // Settlement kojo wins once `finishFishingAction` has settled. Until
  // then we honor any early `session.kojoLines` (legacy path) so a save
  // mid-game still renders something on the terminal card.
  const authoredKojo: readonly FishingKojoLine[] = settlement?.settlementKojo.length
    ? settlement.settlementKojo
    : (viewSession.partner > 0 ? viewSession.kojoLines ?? [] : []);
  const kojoLength = authoredKojo.reduce((sum, entry) => sum + entry.text.length, 0);
  const priorBest = viewSession.catch.fish ? state.fishingGear?.bestSizes[viewSession.catch.fish.id] ?? 0 : 0;
  const newRecord = viewSession.catch.sizeCm !== undefined && viewSession.catch.sizeCm > priorBest;

  const leave = useCallback((outcome: "landed" | "escaped" | "snapped" | "aborted", immediate = false) => {
    finishFishing(outcome, gameRef.current.lineHealth);
    // `immediate` (abort button / Escape) returns to the scene right away —
    // the player left voluntarily, there is no kojo branch to read. Terminal
    // outcomes stay on the fishing screen so the settlement panel can render
    // the kojo branch; the terminal-card click handler then commits it via
    // `commitAndLeave()`.
    if (immediate) setScreen("mainGame");
  }, [finishFishing, setScreen]);

  const commitAndLeave = useCallback(() => {
    commitFishingSettlement();
    setScreen("mainGame");
  }, [commitFishingSettlement, setScreen]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      keysRef.current.add(event.code);
      if (["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS", "Escape"].includes(event.code)) event.preventDefault();
      if (event.code === "Escape") leave("aborted", true);
    };
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [leave]);

  useEffect(() => {
    if (game.phase !== "landed" || kojoLength === 0) return;
    const timer = window.setInterval(() => setKojoReveal((value) => {
      if (value >= kojoLength) { window.clearInterval(timer); return value; }
      return Math.min(kojoLength, value + 1);
    }), 24);
    return () => window.clearInterval(timer);
  }, [game.phase, kojoLength]);

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current, gameRef.current, viewSession.catch.sizeCm ?? 18, viewSession.spotName);
    if (settlement) return; // settled — physics already finished; only render the card.
    let raf = 0;
    let previous = performance.now();
    let previousUi = previous;
    const tick = (time: number) => {
      const dt = Math.min(34, time - previous);
      previous = time;
      const keys = keysRef.current;
      const keyActionHeld = keys.has("Space") || keys.has("Enter");
      const keyAction = keyActionHeld && !previousKeyActionRef.current;
      previousKeyActionRef.current = keyActionHeld;
      const pointerDirection = pointerDirectionRef.current;
      const action = actionQueuedRef.current || keyAction;
      actionQueuedRef.current = false;
      const input: FishingGameInput = {
        ...EMPTY_FISHING_INPUT,
        left: keys.has("ArrowLeft") || keys.has("KeyA") || pointerDirection < 0,
        right: keys.has("ArrowRight") || keys.has("KeyD") || pointerDirection > 0,
        up: keys.has("ArrowUp") || keys.has("KeyW"),
        down: keys.has("ArrowDown") || keys.has("KeyS"),
        action,
        ...(gameRef.current.phase === "casting" && pointerAimRef.current ? { aimX: pointerAimRef.current.x, aimY: pointerAimRef.current.y } : {}),
      };
      const next = stepFishingGame(gameRef.current, viewSession, input, dt).state;
      gameRef.current = next;
      if (time - previousUi >= 50 || ["landed", "escaped", "snapped"].includes(next.phase)) {
        previousUi = time;
        setGame(next);
      }
      if (canvasRef.current) draw(canvasRef.current, next, viewSession.catch.sizeCm ?? 18, viewSession.spotName);
      if (!["landed", "escaped", "snapped"].includes(next.phase)) raf = requestAnimationFrame(tick);
    };
    if (canvasRef.current) draw(canvasRef.current, gameRef.current, viewSession.catch.sizeCm ?? 18, viewSession.spotName);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewSession, settlement]);

  // A finished session has no animation loop. Redraw its presentation on resize
  // without stepping physics or submitting another settlement.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      const snapshot = settlement ? { ...gameRef.current, phase: settlement.outcome === "landed" ? "landed" as const : settlement.outcome === "snapped" ? "snapped" as const : "escaped" as const } : gameRef.current;
      draw(canvas, snapshot, viewSession.catch.sizeCm ?? 18, viewSession.spotName);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(redraw);
    observer?.observe(canvas);
    window.addEventListener("resize", redraw);
    return () => { observer?.disconnect(); window.removeEventListener("resize", redraw); };
  }, [viewSession.catch.sizeCm, viewSession.spotName, settlement]);

  // Settlement-only render (fishingGame already cleared): jump the phase to
  // the terminal outcome so the kojo branch shows without a physics loop.
  useEffect(() => {
    if (!settlement || session) return;
    const terminalPhase = settlement.outcome === "landed"
      ? "landed"
      : settlement.outcome === "snapped"
        ? "snapped"
        : "escaped";
    setGame((g) => (g.phase === terminalPhase ? g : { ...g, phase: terminalPhase, phaseMs: 0 }));
  }, [settlement, session]);

  const updatePointer = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerAimRef.current = {
      x: Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)),
      y: Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100)),
    };
  };

  const clearPointerDrag = (pointerId?: number) => {
    if (pointerId !== undefined && pointerDragRef.current?.pointerId !== pointerId) return;
    pointerDragRef.current = null;
    pointerDirectionRef.current = 0;
    if (touchControlRef.current) touchControlRef.current.hidden = true;
    if (touchKnobRef.current) touchKnobRef.current.style.transform = "translate(-50%, -50%)";
  };

  const beginPointerDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (terminal || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePointer(event.clientX, event.clientY);
    const phase = gameRef.current.phase;
    pointerDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, phase };
    if (phase === "hook") actionQueuedRef.current = true;
    if (phase === "fighting" && touchControlRef.current) {
      touchControlRef.current.hidden = false;
      touchControlRef.current.style.left = `${event.clientX}px`;
      touchControlRef.current.style.top = `${event.clientY}px`;
    }
  };

  const movePointerDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (drag.phase === "casting") updatePointer(event.clientX, event.clientY);
    if (drag.phase !== "fighting") return;
    const dx = event.clientX - drag.x;
    pointerDirectionRef.current = dx < -9 ? -1 : dx > 9 ? 1 : 0;
    const knob = clampDragVector(dx, 0, 44);
    if (touchKnobRef.current) touchKnobRef.current.style.transform = `translate(calc(-50% + ${knob.x}px), -50%)`;
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.phase === "casting") {
      updatePointer(event.clientX, event.clientY);
      actionQueuedRef.current = true;
    }
    clearPointerDrag(event.pointerId);
  };

  const terminal = game.phase === "landed" || game.phase === "escaped" || game.phase === "snapped";
  const density = previewDensity(game.shadows, game.aimX, game.aimY);
  const instruction = game.phase === "casting"
    ? "移动指针选择鱼影密集处 · 点击或空格抛线"
    : game.phase === "waiting"
      ? `落点鱼影 ${Math.max(1, Math.round(game.castDensity))} · 等待咬钩`
      : game.phase === "hook"
        ? "点击或空格扬竿"
        : game.phase === "fighting"
          ? "A / D 或 ← / → 跟随鱼的冲刺方向"
          : "点击画面返回";

  const revealedKojo = useMemo(() => {
    let remaining = kojoReveal;
    return authoredKojo.map((entry) => {
      const text = entry.text.slice(0, Math.max(0, remaining));
      remaining -= entry.text.length;
      return { ...entry, visibleText: text };
    }).filter((entry) => entry.visibleText.length > 0);
  }, [authoredKojo, kojoReveal]);

  const handleTerminalClick = () => {
    if (!terminal) return;
    // Step 1 — reveal the kojo text one line at a time (eraTW 一文字一文字).
    if (game.phase === "landed" && kojoReveal < kojoLength) { setKojoReveal(kojoLength); return; }
    if (game.phase !== "landed" && game.phase !== "escaped" && game.phase !== "snapped") return;
    // Step 2 — first click settles the catch (items, progression, source, and time)
    // and captures the per-outcome kojo branch into `fishingSettlement`. The
    // terminal phase card then renders the kojo instead of dumping it to the
    // background eventLog.
    if (!settlement) {
      finishFishing(game.phase, gameRef.current.lineHealth);
      return;
    }
    // Step 3 — the player has read the branch; commit the kojo into the
    // persistent eventLog and return to the scene.
    commitAndLeave();
  };

  return <main className={`era-fishing fishing-screen fishing-screen--${game.phase}`} data-testid="fishing-game" onClick={handleTerminalClick}>
    <header className="fishing-hud fishing-hud--top">
      <div className="fishing-hud__location"><h1>&gt; [垂钓] {viewSession.spotName}</h1></div>
      <div className="fishing-hud__phase"><strong>[ {phaseTitle(game.phase)} ]</strong></div>
      <button className="era-fishing__button" type="button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); leave("aborted", true); }}>[ 中止 <kbd>Esc</kbd> ]</button>
    </header>
    <aside className="fishing-gear-readout">
      <span>鱼竿　{rod.name}</span><span>鱼线　{line.name}</span>
      {game.phase === "casting" && <span className="fishing-gear-readout__density">落点鱼影 <b>{density.toString().padStart(2, "0")}</b></span>}
    </aside>
    <div className="fishing-water">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="俯视钓鱼水域" onPointerDown={beginPointerDrag} onPointerMove={movePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={event => clearPointerDrag(event.pointerId)} onLostPointerCapture={event => clearPointerDrag(event.pointerId)} />
      {game.phase === "hook" && <div className="fishing-bite-banner" aria-live="polite">咬钩了 · 扬竿！</div>}
    </div>
    <div ref={touchControlRef} className="fishing-touch-control" data-testid="fishing-touch-control" hidden><span ref={touchKnobRef} /></div>
    <section className="fishing-hud fishing-hud--bottom">
      {game.phase === "fighting" ? <>
        <Meter label="鱼的体力" value={game.fishStamina} max={game.fishMaxStamina} />
        <Meter label="鱼线耐久" value={game.lineHealth} max={viewSession.lineDurability} danger={game.lineHealth < viewSession.lineDurability * .28} />
        <div className={`fishing-direction ${game.rodDirection === game.fishDirection ? "is-aligned" : "is-missed"}`}><span>鱼在冲刺</span><strong>{game.fishDirection < 0 ? "← 向左" : "向右 →"}</strong></div>
      </> : <div className="fishing-signal"><span>{game.phase === "casting" ? "寻找一处好落点" : game.phase === "hook" ? "现在扬竿！" : terminal ? "本次垂钓结束" : "浮漂轻晃，静候水下的动静"}</span></div>}
      <p>{instruction}</p>
    </section>
    {terminal && <div className={`fishing-result fishing-result--${game.phase}`}>
      {game.phase === "landed" ? <article className="era-fishing__dialog fishing-catch-card">
        <FishingCatchIdentity result={viewSession.catch} />
        {viewSession.catch.sizeCm !== undefined && <strong>{viewSession.catch.sizeCm} <small>厘米</small></strong>}
        {newRecord && <em>* 新纪录</em>}
        {description && <p className="fishing-catch-card__description">{description}</p>}
        {revealedKojo.length > 0 && <div className="fishing-result-kojo">{revealedKojo.map((entry, index) => <p key={`${entry.charaNum}-${index}`} style={{ color: kojoColor(entry.charaNum) }}><b>{state.charas[entry.charaNum]?.callName ?? ""}</b>{entry.visibleText}</p>)}</div>}
        <footer><button className="era-fishing__button" type="button" onClick={event => { event.stopPropagation(); handleTerminalClick(); }}>[ {kojoReveal < kojoLength ? "显示全部" : "收下钓获"} ]</button><span>也可点击画面继续</span></footer>
      </article> : <article className="era-fishing__dialog fishing-failed-card"><small>本次垂钓结束</small><h2>┌ {game.phase === "snapped" ? "鱼线断裂" : "鱼逃走了"} ┐</h2><button className="era-fishing__button" type="button" onClick={event => { event.stopPropagation(); handleTerminalClick(); }}>[ 返回水岸 ]</button></article>}
    </div>}
  </main>;
}
