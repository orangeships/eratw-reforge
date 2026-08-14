import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSceneStore } from "../state/scene-store.js";
import { useGameStateStore } from "../state/game-state-store.js";
import SpriteCrop, { type SpriteCropSource } from "./SpriteCrop.js";
import portraits from "./portraits.bundle.json";
import charas from "./charas.bundle.json";
import { clampDragVector, dragToDirectionalInput } from "./touch-gesture.js";
import {
  EMPTY_BATTLE_INPUT,
  createDanmakuBattleState,
  danmakuBossMeterVisible,
  danmakuPhaseCount,
  danmakuPhaseLabel,
  stepDanmakuBattle,
  type BattleInput,
  type DanmakuBattleState,
  type GameState,
} from "../../../modernization/runtime/state/index.js";

const WIDTH = 480;
const HEIGHT = 640;
const PORTRAITS = portraits as unknown as Record<string, SpriteCropSource>;
const CHARAS = charas as unknown as Record<string, { name?: string; CSTR?: Record<string, string> }>;

function mergeBattleInput(keyboard: BattleInput, touch: BattleInput): BattleInput {
  return {
    up: keyboard.up || touch.up,
    down: keyboard.down || touch.down,
    left: keyboard.left || touch.left,
    right: keyboard.right || touch.right,
    focus: keyboard.focus || touch.focus,
  };
}

function battleIdentity(target: number, fallbackName: string): { fullName: string; title: string } {
  const meta = CHARAS[String(target)];
  const fullName = (meta?.name || fallbackName).replace(/\s+/g, "");
  const profile = meta?.CSTR?.["10"] ?? "";
  const title = profile.match(/～[^～]+～/)?.[0] ?? "";
  return { fullName, title };
}

function replay(state: GameState): DanmakuBattleState {
  const session = state.danmakuBattle!;
  let current = createDanmakuBattleState(session.config);
  for (const input of session.inputFrames) current = stepDanmakuBattle(current, session.config, input).state;
  return current;
}

function drawBullet(ctx: CanvasRenderingContext2D, bullet: DanmakuBattleState["bullets"][number]): void {
  const angle = Math.atan2(bullet.vy, bullet.vx);
  const speed = Math.hypot(bullet.vx, bullet.vy);
  ctx.save();
  ctx.strokeStyle = bullet.color;
  ctx.fillStyle = bullet.color;
  ctx.globalAlpha = .08;
  ctx.lineWidth = Math.max(1, bullet.radius * .45);
  ctx.beginPath();
  ctx.moveTo(bullet.x, bullet.y);
  ctx.lineTo(bullet.x - bullet.vx * Math.min(5, 2 + speed * 1.2), bullet.y - bullet.vy * Math.min(5, 2 + speed * 1.2));
  ctx.stroke();
  ctx.translate(bullet.x, bullet.y);
  ctx.globalAlpha = 1;
  if (bullet.shape === "needle") { ctx.rotate(angle); ctx.fillRect(-bullet.radius * 1.8, -bullet.radius * .42, bullet.radius * 3.6, bullet.radius * .84); }
  else if (bullet.shape === "diamond") { ctx.rotate(Math.PI / 4); ctx.fillRect(-bullet.radius, -bullet.radius, bullet.radius * 2, bullet.radius * 2); }
  else if (bullet.shape === "petal") { ctx.rotate(angle); ctx.beginPath(); ctx.ellipse(0, 0, bullet.radius * 1.5, bullet.radius * .7, 0, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(0, 0, bullet.radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = .55; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-bullet.radius * .27, -bullet.radius * .27, bullet.radius * .36, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function draw(canvas: HTMLCanvasElement, battle: DanmakuBattleState, focus: boolean): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (battle.gravityStrength > 0) {
    ctx.save();
    ctx.translate(battle.bossX, battle.bossY);
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(0, 0, 31, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(134,78,201,.42)";
    ctx.lineWidth = 3;
    for (let ring = 0; ring < 3; ring += 1) {
      ctx.globalAlpha = .5 - ring * .12;
      ctx.beginPath();
      ctx.arc(0, 0, 34 + ring * 9, battle.frame * .018 + ring, battle.frame * .018 + ring + Math.PI * 1.45);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (const shot of battle.shots) {
    ctx.strokeStyle = "#8cf8ff";
    ctx.globalAlpha = .12; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(shot.x, shot.y + 17); ctx.lineTo(shot.x, shot.y - 17); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(shot.x, shot.y + 13); ctx.lineTo(shot.x, shot.y - 13); ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const emitter of battle.emitters) {
    ctx.globalAlpha = .18;
    ctx.fillStyle = emitter.color;
    ctx.beginPath(); ctx.arc(emitter.x, emitter.y, emitter.radius * 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .92;
    ctx.beginPath(); ctx.arc(emitter.x, emitter.y, emitter.radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .7;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(emitter.x - 2, emitter.y - 2, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const bullet of battle.bullets) drawBullet(ctx, bullet);
  ctx.restore();
  ctx.beginPath(); ctx.fillStyle = "rgba(183,230,255,.08)"; ctx.arc(battle.playerX, battle.playerY, 20, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.fillStyle = battle.invulnerableFrames > 0 && battle.frame % 6 < 3 ? "#fff" : "#61e7ff"; ctx.arc(battle.playerX, battle.playerY, 7, 0, Math.PI * 2); ctx.fill();
  if (focus) { ctx.beginPath(); ctx.fillStyle = "#fff"; ctx.arc(battle.playerX, battle.playerY, 2, 0, Math.PI * 2); ctx.fill(); }
}

function Meter({ label, value, max, className, concealed = false }: { label: string; value: number; max: number; className: string; concealed?: boolean }) {
  return <div className={`danmaku-meter ${className}${concealed ? " danmaku-meter--concealed" : ""}`}><span>{label}</span><div className="danmaku-meter__track">{!concealed && <i style={{ width: `${Math.max(0, Math.min(100, value / max * 100))}%` }} />}</div><b>{concealed ? "??? / ???" : `${Math.ceil(value)} / ${Math.ceil(max)}`}</b></div>;
}

function battleKojo(
  session: NonNullable<GameState["danmakuBattle"]>,
  battle: DanmakuBattleState,
): { speaker: string; text: string } | null {
  // Training lines are resolved once through the active authored variant when
  // the battle session starts. Solo practice therefore remains silent.
  if (session.config.mode === "training") {
    const lines = session.kojoLines ?? [];
    if (session.config.target <= 0 || lines.length === 0) return null;
    const index = Math.floor(battle.frame / 180) % lines.length;
    return { speaker: session.config.targetName, text: lines[index]!.text };
  }
  if (session.config.target !== 120) return null;
  const sourceLines: Record<DanmakuBattleState["phase"], string> = {
    1: "「符卡对决！我来当你的对手！」",
    2: "「犬符『野犬的散步』！」",
    3: "「这、这点程度不算什么！下一招绝对解决你！」",
    4: "「陀螺『Curl Up and Die』！」",
  };
  return { speaker: "阿吽", text: sourceLines[battle.phase] };
}

function settlementKojo(
  session: NonNullable<GameState["danmakuBattle"]>,
  state: GameState,
  status: DanmakuBattleState["status"] | null,
): string {
  if (status === "complete") {
    return session.config.target > 0
      ? (session.kojoLines ?? []).map((line) => line.text.trim()).filter(Boolean).join("\n")
      : "";
  }
  if (status !== "victory" || session.config.target !== 120) return "";
  const masterName = state.master.callName || "你";
  // Upstream: K120 lively Aunn, DANMAKU / 勝利後. Suika's selected upstream
  // file has its post-battle authoring switch disabled and therefore remains
  // correctly silent.
  return [
    "「哇，我投降了！！实在是太强了……",
    `${masterName}，你不想也来试着做一做守护神兽吗？」`,
    `${session.config.targetName}向${masterName}投来尊敬的目光。`,
  ].join("\n");
}

export default function DanmakuBattleScreen({ state }: { state: GameState }) {
  const session = state.danmakuBattle!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bossRef = useRef<HTMLDivElement>(null);
  const bossTwinRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const keyboardInputRef = useRef<BattleInput>({ ...EMPTY_BATTLE_INPUT });
  const touchInputRef = useRef<BattleInput>({ ...EMPTY_BATTLE_INPUT });
  const touchDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const touchControlRef = useRef<HTMLDivElement>(null);
  const touchKnobRef = useRef<HTMLSpanElement>(null);
  const configRef = useRef(session.config);
  const bufferedRef = useRef<BattleInput[]>([]);
  // `useRef(replay(state))` evaluated the full deterministic replay before
  // every React render. Late phases therefore replayed the whole battle about
  // ten times per second. Initialise exactly once per mounted session.
  const battleRef = useRef<DanmakuBattleState | null>(null);
  if (battleRef.current === null) battleRef.current = replay(state);
  const lastHudFrameRef = useRef(battleRef.current.frame);
  const [battle, setBattle] = useState<DanmakuBattleState>(() => battleRef.current!);
  const [intro, setIntro] = useState(true);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState<DanmakuBattleState["status"] | null>(null);
  const [hitFlash, setHitFlash] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [victoryReveal, setVictoryReveal] = useState(0);
  const previousHits = useRef(battle.hits);
  const appendInputs = useGameStateStore((s) => s.appendDanmakuInputsAction);
  const finishBattle = useGameStateStore((s) => s.finishDanmakuBattleAction);
  const setScreen = useSceneStore((s) => s.setScreen);
  const beginBattleReturn = useSceneStore((s) => s.beginBattleReturn);
  const portrait = PORTRAITS[String(session.config.target)];
  const identity = battleIdentity(session.config.target, session.config.targetName);
  const kojo = battleKojo(session, battle);
  const phaseCount = danmakuPhaseCount(session.config);
  const bossMeterVisible = danmakuBossMeterVisible(battle, session.config);
  const settlementText = settlementKojo(session, state, finished);
  const phaseLabel = session.config.mode === "training"
    ? "PATTERN 1 + 2 MIX"
    : `PHASE ${battle.phase} / ${phaseCount} · ${danmakuPhaseLabel(battle, session.config)}`;

  useEffect(() => { const timer = window.setTimeout(() => setIntro(false), 1350); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift", "w", "a", "s", "d", "W", "A", "S", "D", "Escape"].includes(event.key)) event.preventDefault();
      if (event.key === "Escape") { setPaused((value) => !value); return; }
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") keyboardInputRef.current.up = true;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") keyboardInputRef.current.down = true;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") keyboardInputRef.current.left = true;
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") keyboardInputRef.current.right = true;
      if (event.key === "Shift") keyboardInputRef.current.focus = true;
    };
    const up = (event: KeyboardEvent) => { if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") keyboardInputRef.current.up = false; if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") keyboardInputRef.current.down = false; if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") keyboardInputRef.current.left = false; if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") keyboardInputRef.current.right = false; if (event.key === "Shift") keyboardInputRef.current.focus = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);
  useEffect(() => { if (canvasRef.current) draw(canvasRef.current, battleRef.current!, false); }, []);
  useEffect(() => {
    if (battle.hits <= previousHits.current) return;
    previousHits.current = battle.hits;
    setHitFlash(true);
    const timer = window.setTimeout(() => setHitFlash(false), 300);
    return () => window.clearTimeout(timer);
  }, [battle.hits]);
  useEffect(() => {
    if (!finished || !settlementText) return;
    setVictoryReveal(0);
    const timer = window.setInterval(() => {
      setVictoryReveal((value) => {
        if (value >= settlementText.length) {
          window.clearInterval(timer);
          return value;
        }
        return value + 1;
      });
    }, 28);
    return () => window.clearInterval(timer);
  }, [finished, settlementText]);
  useEffect(() => {
    if (intro || paused || finished) return;
    let raf = 0; let previous = performance.now(); let accumulator = 0;
    const tick = (now: number) => {
      accumulator += Math.min(100, now - previous); previous = now;
      let refreshHud = false;
      let steps = 0;
      while (accumulator >= 1000 / 60 && steps < 2) {
        const input = mergeBattleInput(keyboardInputRef.current, touchInputRef.current); bufferedRef.current.push(input);
        const stepped = stepDanmakuBattle(battleRef.current!, configRef.current, input); battleRef.current = stepped.state; accumulator -= 1000 / 60; steps += 1;
        if (stepped.events.some((event) => event.kind === "hit" || event.kind === "phase" || event.kind === "auto-bomb")) refreshHud = true;
        if (bufferedRef.current.length >= 600) { appendInputs(bufferedRef.current); bufferedRef.current = []; }
        if (stepped.state.status !== "active") { if (bufferedRef.current.length) appendInputs(bufferedRef.current); bufferedRef.current = []; setBattle(stepped.state); setFinished(stepped.state.status); return; }
      }
      // Do not enter a catch-up death spiral after a slow WebView frame. The
      // simulation remains fixed-step; excess wall-clock debt is discarded.
      if (steps === 2 && accumulator >= 1000 / 60) accumulator = 0;
      const current = battleRef.current!;
      const activeInput = mergeBattleInput(keyboardInputRef.current, touchInputRef.current);
      if (canvasRef.current) draw(canvasRef.current, current, activeInput.focus);
      const twins = configRef.current.pattern === "aunn" && current.phase >= 3;
      if (bossRef.current) { bossRef.current.style.left = `${(current.bossX + (twins ? -68 : 0)) / WIDTH * 100}%`; bossRef.current.style.top = `${current.bossY / HEIGHT * 100}%`; }
      if (bossTwinRef.current) { bossTwinRef.current.style.display = twins ? "block" : "none"; bossTwinRef.current.style.left = `${(current.bossX + 68) / WIDTH * 100}%`; bossTwinRef.current.style.top = `${current.bossY / HEIGHT * 100}%`; }
      if (playerRef.current) { playerRef.current.style.left = `${current.playerX / WIDTH * 100}%`; playerRef.current.style.top = `${current.playerY / HEIGHT * 100}%`; }
      if (refreshHud || current.frame - lastHudFrameRef.current >= 12) {
        lastHudFrameRef.current = current.frame;
        setBattle(current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [appendInputs, finished, intro, paused]);

  const clearTouchInput = (pointerId?: number) => {
    if (pointerId !== undefined && touchDragRef.current?.pointerId !== pointerId) return;
    touchDragRef.current = null;
    touchInputRef.current = { ...EMPTY_BATTLE_INPUT };
    if (touchControlRef.current) touchControlRef.current.hidden = true;
    if (touchKnobRef.current) touchKnobRef.current.style.transform = "translate(-50%, -50%)";
  };
  const updateTouchInput = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    touchInputRef.current = { ...dragToDirectionalInput(dx, dy) };
    const knob = clampDragVector(dx, dy);
    if (touchKnobRef.current) touchKnobRef.current.style.transform = `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`;
  };
  const beginTouchInput = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (intro || paused || finished || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    touchInputRef.current = { ...EMPTY_BATTLE_INPUT };
    const rect = event.currentTarget.getBoundingClientRect();
    if (touchControlRef.current) {
      touchControlRef.current.hidden = false;
      touchControlRef.current.style.left = `${event.clientX - rect.left}px`;
      touchControlRef.current.style.top = `${event.clientY - rect.top}px`;
    }
  };
  const leave = (result: "victory" | "defeat" | "complete" | "aborted") => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => { beginBattleReturn(); finishBattle(result, battle.playerLives); setScreen("mainGame"); }, 520);
  };
  const result = finished === "complete" ? "complete" : finished === "victory" ? "victory" : "defeat";
  const resultStreaming = Boolean(finished && settlementText && victoryReveal < settlementText.length);
  const onFinishedClick = finished ? () => {
    if (resultStreaming) { setVictoryReveal(settlementText.length); return; }
    leave(result);
  } : undefined;
  const twinsVisible = session.config.pattern === "aunn" && battle.phase >= 3;
  return <section className={`danmaku-battle${intro ? " danmaku-battle--intro" : ""}${hitFlash ? " danmaku-battle--hit" : ""}${leaving ? " danmaku-battle--leaving" : ""}${finished ? " danmaku-battle--finished" : ""}${resultStreaming ? " danmaku-battle--streaming" : ""}`} data-testid="danmaku-battle" onClick={onFinishedClick}>
    <header className="danmaku-battle__title"><span>{session.commandNo === 411 ? "战斗训练" : "弹幕胜负"}</span></header>
    <aside className="danmaku-battle__stats danmaku-battle__stats--player"><Meter label="PLAYER HP" value={battle.playerHp} max={battle.playerMaxHp} className="danmaku-meter--player" /><span>残机 {session.config.mode === "training" ? "∞" : battle.playerLives}　自动 B {battle.bombs}　擦弹 {battle.grazes}</span></aside>
    <aside className="danmaku-battle__stats danmaku-battle__stats--boss"><Meter label={`${identity.fullName} HP`} value={battle.bossHp} max={battle.bossMaxHp} className="danmaku-meter--boss" concealed={!bossMeterVisible} />{identity.title && <span className="danmaku-battle__identity">{identity.title}</span>}<span>{phaseLabel}</span>{kojo && <div className="danmaku-battle__kojo" data-testid="danmaku-kojo"><b>{kojo.speaker}</b><p>{kojo.text}</p></div>}</aside>
    <button className="danmaku-battle__mobile-pause" type="button" aria-label="暂停弹幕战斗" onClick={(event) => { event.stopPropagation(); setPaused((value) => !value); }}>Ⅱ</button>
    <div className="danmaku-battle__stage" onPointerDown={beginTouchInput} onPointerMove={updateTouchInput} onPointerUp={(event) => clearTouchInput(event.pointerId)} onPointerCancel={(event) => clearTouchInput(event.pointerId)} onLostPointerCapture={(event) => clearTouchInput(event.pointerId)}>
      <canvas ref={canvasRef} className="danmaku-battle__canvas" width={WIDTH} height={HEIGHT} aria-label="弹幕战斗画面" />
      <div ref={bossRef} className="danmaku-battle__boss" style={{ left: `${(battle.bossX + (twinsVisible ? -68 : 0)) / WIDTH * 100}%`, top: `${battle.bossY / HEIGHT * 100}%` }}>{portrait ? <SpriteCrop source={portrait} alt={identity.fullName} className="danmaku-battle__boss-sprite" frameWidth={104} frameHeight={104} /> : <span className="danmaku-battle__enemy-core">✦</span>}</div>
      <div ref={bossTwinRef} className="danmaku-battle__boss danmaku-battle__boss--twin" style={{ display: twinsVisible ? "block" : "none", left: `${(battle.bossX + 68) / WIDTH * 100}%`, top: `${battle.bossY / HEIGHT * 100}%` }}>{portrait ? <SpriteCrop source={portrait} alt={`${identity.fullName}分身`} className="danmaku-battle__boss-sprite" frameWidth={104} frameHeight={104} /> : <span className="danmaku-battle__enemy-core">✦</span>}</div>
      <div ref={playerRef} className="danmaku-battle__player" style={{ left: `${battle.playerX / WIDTH * 100}%`, top: `${battle.playerY / HEIGHT * 100}%` }}><span>✧</span></div>
      <div ref={touchControlRef} className="danmaku-battle__touch-control" data-testid="danmaku-touch-control" hidden><span ref={touchKnobRef} /></div>
      <p className="danmaku-battle__touch-hint">轻拖精细移动 · 拉远快速移动</p>
    </div>
    {intro && <div className="danmaku-battle__entry"><p>DUEL START</p><h2>{identity.fullName}</h2><span>{identity.title || "SPELL CARD DUEL"}</span></div>}
    {paused && !finished && <div className="danmaku-battle__overlay"><h2>暂停</h2><button type="button" onClick={() => setPaused(false)}>继续</button>{session.config.mode === "training" && <button type="button" onClick={() => leave("aborted")}>结束练习</button>}{session.config.mode === "duel" && <button type="button" onClick={() => leave("defeat")}>认输</button>}</div>}
    {finished && <div className="danmaku-battle__overlay"><h2>{finished === "victory" ? "胜利！" : finished === "complete" ? "训练结束" : "败北"}</h2>{settlementText ? <div className="danmaku-battle__victory-kojo"><b>{session.config.targetName}</b><p>{settlementText.slice(0, victoryReveal)}{victoryReveal < settlementText.length && <i aria-hidden="true">▌</i>}</p></div> : <p>被弹 {battle.hits}　擦弹 {battle.grazes}　自动 Bomb {battle.autoBombs}</p>}</div>}
  </section>;
}
