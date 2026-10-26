import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSceneStore } from "../state/scene-store.js";
import { useGameStateStore } from "../state/game-state-store.js";
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
import type { SpriteCropSource } from "./SpriteCrop.js";
import portraits from "./portraits.bundle.json";
import { dimensionForKind, portraitForClothing, portraitForState, portraitKind, portraitSourceForState, type PortraitSource } from "./portrait-expression.js";
import { portraitWithOutfit } from "./portrait-special-outfit-runtime.js";
import { checkNude } from "../../../modernization/runtime/state/portrait-outfit-context.js";
import { drawBattle as draw } from "./ascii/danmaku-renderer.js";
import "./ascii/danmaku.css";

const WIDTH = 480;
const HEIGHT = 640;
const PORTRAITS = portraits as unknown as Record<string, PortraitSource>;
const CHARAS = charas as unknown as Record<string, { name?: string; CSTR?: Record<string, string> }>;

function BattlePortrait({ source, name, className }: { source: SpriteCropSource; name: string; className: string }) {
  const clipId = useId();
  const [x, y, width, height] = source.rect;
  // SVG's viewBox crops the manifest rectangle and scales with the viewport,
  // including at 4K. No fixed-size rasterisation of the character art.
  return <svg className={className} viewBox={source.rect.join(" ")} role="img" aria-label={name}>
    <defs><clipPath id={clipId}><rect x={x} y={y} width={width} height={height} /></clipPath></defs>
    <image href={source.src} x="0" y="0" clipPath={`url(#${clipId})`} />
  </svg>;
}

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

function Meter({ label, value, max, className, concealed = false }: { label: string; value: number; max: number; className: string; concealed?: boolean }) {
  const filled = Math.round(Math.max(0, Math.min(1, value / Math.max(1, max))) * 12);
  return <div className={`danmaku-meter ${className}`}><span>{label}</span><span className="danmaku-meter__glyphs" aria-hidden="true">[{concealed ? "????????????" : "=".repeat(filled) + ".".repeat(12 - filled)}]</span><b>{concealed ? "??? / ???" : `${Math.ceil(value)} / ${Math.ceil(max)}`}</b></div>;
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
  const identity = battleIdentity(session.config.target, session.config.targetName);
  const kojo = battleKojo(session, battle);
  const phaseCount = danmakuPhaseCount(session.config);
  const bossMeterVisible = danmakuBossMeterVisible(battle, session.config);
  const settlementText = settlementKojo(session, state, finished);
  const phaseLabel = session.config.mode === "training"
    ? "基础弹幕 · 混合练习"
    : `符卡 ${battle.phase} / ${phaseCount} · ${danmakuPhaseLabel(battle, session.config)}`;
  const bossSource = portraitForState(state, session.config.target, portraitSourceForState(state, session.config.target, PORTRAITS));
  const naked = checkNude(state, session.config.target);
  const kind = portraitKind(state);
  const portrait = portraitWithOutfit(state, session.config.target, bossSource, portraitForClothing(dimensionForKind(bossSource, kind), naked), naked, kind);
  const enemyArt = (className: string, name = identity.fullName) => portrait
    ? <BattlePortrait source={portrait} name={name} className={className} />
    : <span className="era-duel__enemy-fallback" aria-label={name}>{session.config.target > 0 ? "[ 相手 ]" : "[ + ]"}</span>;

  useEffect(() => { const timer = window.setTimeout(() => setIntro(false), 650); return () => window.clearTimeout(timer); }, []);
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
    window.setTimeout(() => { beginBattleReturn(); finishBattle(result, battle.playerLives); setScreen("mainGame"); }, 160);
  };
  const result = finished === "complete" ? "complete" : finished === "victory" ? "victory" : "defeat";
  const resultStreaming = Boolean(finished && settlementText && victoryReveal < settlementText.length);
  const onFinishedClick = finished ? () => {
    if (resultStreaming) { setVictoryReveal(settlementText.length); return; }
    leave(result);
  } : undefined;
  const twinsVisible = session.config.pattern === "aunn" && battle.phase >= 3;
  return <section className={`era-duel danmaku-battle${intro ? " danmaku-battle--intro" : ""}${hitFlash ? " danmaku-battle--hit" : ""}${leaving ? " danmaku-battle--leaving" : ""}${finished ? " danmaku-battle--finished" : ""}${resultStreaming ? " danmaku-battle--streaming" : ""}`} data-testid="danmaku-battle" onClick={onFinishedClick}>
    <header className="danmaku-battle__title">
      <h1><span aria-hidden="true">&gt; </span>[{session.commandNo === 411 ? "战斗训练" : "弹幕胜负"}]</h1>
      <button className="era-duel__button" type="button" aria-label="暂停弹幕战斗" disabled={Boolean(finished || leaving)} onClick={event => { event.stopPropagation(); setPaused(value => !value); }}>[ Esc {paused ? "继续" : "暂停"} ]</button>
    </header>
    <aside className="danmaku-battle__stats danmaku-battle__stats--player">
      <h2>┌ {state.master.callName || "你"} ┐</h2>
      <Meter label="体力" value={battle.playerHp} max={battle.playerMaxHp} className="danmaku-meter--player" />
      <dl className="danmaku-battle__numbers"><div><dt>残机</dt><dd>{session.config.mode === "training" ? "∞" : battle.playerLives}</dd></div><div><dt>自动灵击</dt><dd>{battle.bombs}</dd></div><div><dt>擦弹</dt><dd>{battle.grazes.toString().padStart(3, "0")}</dd></div></dl>
      <p className="danmaku-battle__rule">{session.config.mode === "training" ? "基础练习" : "符卡规则"}<br /><span>{session.config.mode === "training" ? "自由躲避，自动射击" : "躲避弹幕，击破符卡"}</span></p>
    </aside>
    <div className="danmaku-battle__stage" onPointerDown={beginTouchInput} onPointerMove={updateTouchInput} onPointerUp={event => clearTouchInput(event.pointerId)} onPointerCancel={event => clearTouchInput(event.pointerId)} onLostPointerCapture={event => clearTouchInput(event.pointerId)}>
      <canvas ref={canvasRef} className="danmaku-battle__canvas" width={WIDTH} height={HEIGHT} aria-label="弹幕战斗画面" />
      <div ref={bossRef} className="danmaku-battle__boss" style={{ left: `${(battle.bossX + (twinsVisible ? -68 : 0)) / WIDTH * 100}%`, top: `${battle.bossY / HEIGHT * 100}%` }}>{enemyArt("era-duel__actor")}</div>
      <div ref={bossTwinRef} className="danmaku-battle__boss danmaku-battle__boss--twin" style={{ display: twinsVisible ? "block" : "none", left: `${(battle.bossX + 68) / WIDTH * 100}%`, top: `${battle.bossY / HEIGHT * 100}%` }}>{enemyArt("era-duel__actor", `${identity.fullName}分身`)}</div>
      <div ref={touchControlRef} className="danmaku-battle__touch-control" data-testid="danmaku-touch-control" hidden><span ref={touchKnobRef} /></div>
      <p className="danmaku-battle__touch-hint">轻拖慢移 · 拉远快移</p>
    </div>
    <aside className="danmaku-battle__stats danmaku-battle__stats--boss">
      <h2>┌ 相手 ┐</h2>
      <div className="danmaku-battle__portrait">{enemyArt("era-duel__portrait")}<span>{identity.fullName}</span></div>
      {identity.title && <span className="danmaku-battle__identity">{identity.title}</span>}
      <Meter label="符力" value={battle.bossHp} max={battle.bossMaxHp} className="danmaku-meter--boss" concealed={!bossMeterVisible} />
      <span className="danmaku-battle__phase">{phaseLabel}</span>
      {kojo && <div className="danmaku-battle__kojo" data-testid="danmaku-kojo"><b>{kojo.speaker}</b><p>{kojo.text}</p></div>}
    </aside>
    <footer className="danmaku-battle__controls"><span><kbd>WASD</kbd> / <kbd>方向键</kbd> 移动</span><span><kbd>Shift</kbd> 精细移动</span><span>自动射击</span></footer>
    {intro && <div className="danmaku-battle__entry"><div className="era-duel__intro"><span>{session.config.mode === "training" ? "[ 开始演练 ]" : "[ 符卡对决 ]"}</span><h2>{identity.fullName}</h2>{identity.title && <p>{identity.title}</p>}</div></div>}
    {paused && !finished && <div className="danmaku-battle__overlay"><div className="era-duel__dialog" role="dialog" aria-label="战斗暂停"><h2>┌ 暂停 ┐</h2><button className="era-duel__button" type="button" onClick={() => setPaused(false)}>[ 继续对决 ]</button><button className="era-duel__button" type="button" onClick={() => leave(session.config.mode === "training" ? "aborted" : "defeat")}>[ {session.config.mode === "training" ? "结束练习" : "认输"} ]</button></div></div>}
    {finished && <div className="danmaku-battle__overlay"><div className="era-duel__dialog" role="dialog" aria-label="战斗结果"><h2>┌ {finished === "victory" ? "胜利" : finished === "complete" ? "训练结束" : "败北"} ┐</h2><dl className="danmaku-battle__result-numbers"><div><dt>被弹</dt><dd>{battle.hits}</dd></div><div><dt>擦弹</dt><dd>{battle.grazes}</dd></div><div><dt>自动灵击</dt><dd>{battle.autoBombs}</dd></div></dl>{settlementText && <div className="danmaku-battle__victory-kojo"><b>{session.config.targetName}</b><p>{settlementText.slice(0, victoryReveal)}{resultStreaming && <i aria-hidden="true">▌</i>}</p></div>}<button className="era-duel__button" type="button" onClick={event => { event.stopPropagation(); onFinishedClick?.(); }}>[ {resultStreaming ? "显示全部" : "返回"} ]</button></div></div>}
  </section>;
}
