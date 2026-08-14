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
    case "casting": return "CAST / 抛线";
    case "waiting": return "WAIT / 等待";
    case "hook": return "BITE / 上钩";
    case "fighting": return "TRACE / 搏鱼";
    case "landed": return "CATCH / 钓获";
    case "snapped": return "LINE LOST / 断线";
    default: return "ESCAPED / 脱钩";
  }
}

function drawFish(ctx: CanvasRenderingContext2D, width: number, height: number, x: number, y: number, direction: 1 | -1, size: number, color: string, eye = false): void {
  const px = (value: number) => value / 100 * width;
  const py = (value: number) => value / 100 * height;
  ctx.save();
  ctx.translate(px(x), py(y));
  ctx.scale(direction, 1);
  const length = 10 + size * 6.5;
  const fishHeight = 3 + size * 2.7;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, length, fishHeight, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-length * .72, 0);
  ctx.lineTo(-length * 1.34, -fishHeight * 1.15);
  ctx.lineTo(-length * 1.34, fishHeight * 1.15);
  ctx.closePath();
  ctx.fill();
  if (eye) {
    ctx.fillStyle = "#ecfffb";
    ctx.beginPath();
    ctx.arc(length * .55, -fishHeight * .2, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function previewDensity(shadows: readonly FishingShadow[], x: number, y: number): number {
  return shadows.reduce((count, shadow) => count + (Math.hypot(shadow.x - x, shadow.y - y) < 12 ? 1 : 0), 0);
}

function draw(canvas: HTMLCanvasElement, game: FishingGameState, catchSize: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || WIDTH));
  const height = Math.max(1, Math.round(rect.height || HEIGHT));
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const bufferWidth = Math.round(width * dpr);
  const bufferHeight = Math.round(height * dpr);
  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth;
    canvas.height = bufferHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const px = (value: number) => value / 100 * width;
  const py = (value: number) => value / 100 * height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#010303";
  ctx.fillRect(0, 0, width, height);

  // Top-down water: restrained contour lines keep the fish shadows readable.
  ctx.strokeStyle = "rgba(101, 224, 205, .065)";
  ctx.lineWidth = 1;
  for (let ring = 0; ring < 8; ring += 1) {
    ctx.beginPath();
    ctx.ellipse(width / 2, height * .66, width * (.14 + ring * .095), height * (.087 + ring * .063), Math.sin(game.elapsedMs * .00012 + ring) * .035, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let y = 60; y < height - 20; y += 64) {
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 18) {
      const waveY = y + Math.sin(x * .018 + game.elapsedMs * .0007 + y) * 3;
      if (x < 0) ctx.moveTo(x, waveY); else ctx.lineTo(x, waveY);
    }
    ctx.stroke();
  }

  // Castable fan and its exact physics boundary share the same origin/radius.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(px(50), py(92));
  for (let i = 0; i <= 40; i += 1) {
    const angle = -Math.PI * 52 / 180 + i / 40 * Math.PI * 104 / 180;
    ctx.lineTo(px(50 + Math.sin(angle) * 62), py(92 - Math.cos(angle) * 62));
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(87, 208, 190, .025)";
  ctx.fill();
  ctx.setLineDash([7, 10]);
  ctx.strokeStyle = "rgba(119, 246, 223, .2)";
  ctx.stroke();
  ctx.restore();

  const fighting = game.phase === "fighting";
  game.shadows.forEach((shadow, index) => {
    if ((game.phase === "waiting" || game.phase === "hook") && index === game.activeShadow) return;
    drawFish(ctx, width, height, shadow.x, shadow.y, shadow.heading, shadow.size, "rgba(71, 130, 123, .25)");
  });

  if (game.phase === "casting") {
    const density = previewDensity(game.shadows, game.aimX, game.aimY);
    const radius = 24 + density * 4;
    ctx.strokeStyle = `rgba(119, 246, 223, ${Math.min(.72, .22 + density * .07)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px(game.aimX), py(game.aimY), radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px(game.aimX) - 12, py(game.aimY));
    ctx.lineTo(px(game.aimX) + 12, py(game.aimY));
    ctx.moveTo(px(game.aimX), py(game.aimY) - 12);
    ctx.lineTo(px(game.aimX), py(game.aimY) + 12);
    ctx.stroke();
  }

  if (game.phase === "waiting" || game.phase === "hook") {
    drawFish(ctx, width, height, game.fishX, game.fishY, game.fishDirection, 2.2, "rgba(94, 181, 168, .46)");
  } else if (fighting) {
    const displaySize = Math.max(2.3, Math.min(6.2, 1.8 + Math.sqrt(Math.max(5, catchSize)) * .18));
    drawFish(ctx, width, height, game.fishX, game.fishY, game.fishDirection, displaySize, "rgba(119, 246, 223, .76)", true);
    ctx.fillStyle = game.fishDirection < 0 ? "rgba(255,255,255,.72)" : "rgba(255,255,255,.72)";
    ctx.font = "700 24px 'Cascadia Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(game.fishDirection < 0 ? "←" : "→", px(game.fishX), py(game.fishY) - 28);
  }

  // Rod geometry and line endpoints remain in scene coordinates from end to end.
  const rodBase = { x: 50, y: 99 };
  const rodTip = fighting
    ? { x: 50 + game.rodDirection * 10, y: 82 }
    : { x: 50 + (game.aimX - 50) * .12, y: 82 };
  ctx.strokeStyle = "#b9f8ec";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(px(rodBase.x), py(rodBase.y));
  ctx.lineTo(px(rodTip.x), py(rodTip.y));
  ctx.stroke();
  ctx.strokeStyle = "rgba(89, 185, 169, .7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px(rodBase.x), py(rodBase.y));
  ctx.lineTo(px(50), py(95));
  ctx.stroke();

  const endpoint = fighting
    ? { x: game.fishX + game.fishDirection * Math.max(1.2, Math.min(4.4, Math.sqrt(Math.max(5, catchSize)) * .16)), y: game.fishY }
    : { x: game.lureX, y: game.lureY };
  ctx.save();
  if (game.phase === "casting") ctx.setLineDash([6, 7]);
  ctx.strokeStyle = game.tension > 78 ? "rgba(255, 100, 120, .9)" : "rgba(218, 255, 249, .82)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px(rodTip.x), py(rodTip.y));
  const controlX = (px(rodTip.x) + px(endpoint.x)) / 2 + game.rodDirection * 12;
  const controlY = (py(rodTip.y) + py(endpoint.y)) / 2 + (fighting ? 8 + game.tension * .09 : 20);
  ctx.quadraticCurveTo(controlX, controlY, px(endpoint.x), py(endpoint.y));
  ctx.stroke();
  ctx.restore();

  if (game.phase !== "casting" && !fighting) {
    ctx.fillStyle = "#e5fffa";
    ctx.beginPath();
    ctx.arc(px(game.lureX), py(game.lureY), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  game.splashes.forEach((splash) => {
    ctx.strokeStyle = `rgba(130,255,235,${Math.max(0, 1 - splash.age / 900) * .55})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(px(splash.x), py(splash.y), splash.size + splash.age * .03, (splash.size + splash.age * .03) * .42, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  if (game.phase === "hook") {
    ctx.fillStyle = `rgba(235,255,250,${.65 + Math.sin(game.elapsedMs * .035) * .35})`;
    ctx.font = "700 64px 'Cascadia Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("!", px(game.lureX), py(game.lureY) - 34);
  }
}

function Meter({ label, value, max, danger = false }: { label: string; value: number; max: number; danger?: boolean }) {
  const pct = Math.max(0, Math.min(100, value / Math.max(1, max) * 100));
  return <div className={`fishing-meter${danger ? " fishing-meter--danger" : ""}`}><span>{label}</span><div><i style={{ width: `${pct}%` }} /></div><b>{Math.ceil(value)}</b></div>;
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
    {presentation.kind === "fish"
      ? <div className="fishing-catch-card__fish" data-testid="fishing-catch-visual" data-catch-kind="fish" aria-label={presentation.visualLabel} role="img"><i /><i /></div>
      : <div
          className={`fishing-catch-card__item fishing-catch-card__item--${presentation.kind}`}
          data-testid="fishing-catch-visual"
          data-catch-kind={presentation.kind}
          aria-label={presentation.visualLabel}
          role="img"
        ><span>{presentation.glyph}</span></div>}
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
      if (canvasRef.current) draw(canvasRef.current, next, viewSession.catch.sizeCm ?? 18);
      if (!["landed", "escaped", "snapped"].includes(next.phase)) raf = requestAnimationFrame(tick);
    };
    if (canvasRef.current) draw(canvasRef.current, gameRef.current, viewSession.catch.sizeCm ?? 18);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewSession, settlement]);

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

  return (
    <main
      className={`fishing-screen fishing-screen--${game.phase}`}
      data-testid="fishing-game"
      onClick={handleTerminalClick}
    >
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="俯视钓鱼水域" onPointerDown={beginPointerDrag} onPointerMove={movePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={(event) => clearPointerDrag(event.pointerId)} onLostPointerCapture={(event) => clearPointerDrag(event.pointerId)} />
      <div ref={touchControlRef} className="fishing-touch-control" data-testid="fishing-touch-control" hidden><span ref={touchKnobRef} /></div>
      <header className="fishing-hud fishing-hud--top">
        <div><small>FISHING AREA</small><h1>{viewSession.spotName}</h1></div>
        <div className="fishing-hud__phase"><small>PHASE</small><strong>{phaseTitle(game.phase)}</strong></div>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); leave("aborted", true); }}>中止</button>
      </header>
      <aside className="fishing-gear-readout">
        <span>ROD // {rod.name}</span>
        <span>LINE // {line.name}</span>
        {game.phase === "casting" && <span>SHADOW // {density.toString().padStart(2, "0")}</span>}
      </aside>
      <section className="fishing-hud fishing-hud--bottom">
        {game.phase === "casting" ? <div className="fishing-signal">CAST FAN // SELECT TARGET</div> : game.phase === "fighting" ? <>
          <Meter label="TARGET" value={game.fishStamina} max={game.fishMaxStamina} />
          <Meter label="LINE" value={game.lineHealth} max={viewSession.lineDurability} danger={game.lineHealth < viewSession.lineDurability * .28} />
          <div className={`fishing-direction ${game.rodDirection === game.fishDirection ? "is-aligned" : "is-missed"}`}>
            <span>RUN</span><strong>{game.fishDirection < 0 ? "← LEFT" : "RIGHT →"}</strong>
          </div>
        </> : <div className="fishing-signal">{game.phase === "hook" ? "STRIKE NOW" : "WATER SIGNAL // LISTENING"}</div>}
        <p>{instruction}</p>
      </section>
      {terminal && <div className={`fishing-result fishing-result--${game.phase}`}>
        {game.phase === "landed" ? <article className="fishing-catch-card">
          <FishingCatchIdentity result={viewSession.catch} />
          {viewSession.catch.sizeCm !== undefined && <strong>{viewSession.catch.sizeCm} cm</strong>}
          {newRecord && <em>NEW RECORD</em>}
          {description && <p className="fishing-catch-card__description">{description}</p>}
          {revealedKojo.length > 0 && <div className="fishing-result-kojo">
            {revealedKojo.map((entry, index) => <p key={`${entry.charaNum}-${index}`} style={{ color: kojoColor(entry.charaNum) }}>
              <b>{state.charas[entry.charaNum]?.callName ?? ""}</b>{entry.visibleText}
            </p>)}
          </div>}
          <footer>{kojoReveal < kojoLength ? "点击显示全部" : "点击画面收下钓获"}</footer>
        </article> : <article className="fishing-failed-card">
          <small>SIGNAL LOST</small>
          <h2>{game.phase === "snapped" ? "鱼线断裂" : "鱼逃走了"}</h2>
          <p>点击画面返回</p>
        </article>}
      </div>}
    </main>
  );
}
