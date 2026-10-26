import { useEffect, useRef } from "react";
import { useReducedMotion } from "./AsciiEffects.js";
import { CLEAR_SCENE_WEATHER, fitMotionViewport, motionGlyphs, motionProfile, sceneMotionSeed, type SceneWeather } from "./scene-motion.js";
import { authoredSceneMotion } from "./authored-scene-art.js";
import { nativeSceneGlyphs } from "./native-scene-motion.js";

/** Transparent character effects over a static scene; the clock is presentation only. */
export default function AsciiSceneMotion({ sceneId, weather = CLEAR_SCENE_WEATHER, stopped = false, fitArtwork = false, nativeArtwork = false }: {
  sceneId: string; weather?: SceneWeather; stopped?: boolean; fitArtwork?: boolean; nativeArtwork?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  const reduced = useReducedMotion();
  // Primitive dependencies prevent unrelated GameState updates restarting the visual clock.
  const weatherKey = JSON.stringify(weather);
  useEffect(() => { elapsed.current = 0; }, [sceneId]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let ctx: CanvasRenderingContext2D | null | undefined;
    const input = JSON.parse(weatherKey) as SceneWeather;
    const profile = motionProfile(sceneId, input.exposed);
    const native = nativeArtwork && !reduced ? authoredSceneMotion(sceneId) : undefined;
    let frame = 0, last = 0;
    const draw = () => {
      const width = el.clientWidth, height = el.clientHeight;
      if (!width || !height) return;
      if (ctx === undefined) ctx = el.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
      if (el.width !== pixelWidth || el.height !== pixelHeight) { el.width = pixelWidth; el.height = pixelHeight; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const rect = fitMotionViewport(width, height, fitArtwork ? profile.aspect : 0);
      const cw = rect.width / profile.cols, ch = rect.height / profile.rows;
      ctx.font = `${ch * 1.1}px Consolas, monospace`;
      ctx.textBaseline = "top";
      const glyphs = [
        ...(native ? nativeSceneGlyphs(native, elapsed.current) : []),
        ...motionGlyphs(profile, input, sceneMotionSeed(sceneId), elapsed.current, !reduced && !native),
      ];
      for (const glyph of glyphs) {
        ctx.fillStyle = glyph.color; ctx.globalAlpha = glyph.alpha;
        ctx.textBaseline = glyph.native ? "middle" : "top";
        const y = rect.y + glyph.y * ch + (glyph.native ? ch / 2 + ch / (native?.cellHeight ?? 10) * 0.5 : 0);
        ctx.fillText(glyph.text, rect.x + glyph.x * cw, y, cw * glyph.text.length);
      }
      ctx.globalAlpha = 1;
    };
    const tick = (now: number) => {
      if (last === 0 || now - last >= 80) {
        if (last) elapsed.current += Math.min(0.25, (now - last) / 1000);
        last = now; draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame); last = 0;
      if (document.hidden) return;
      draw();
      if (!stopped && !reduced) frame = requestAnimationFrame(tick);
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(draw) : null;
    observer?.observe(el);
    window.addEventListener("resize", draw);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener("resize", draw);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [sceneId, weatherKey, stopped, reduced, fitArtwork, nativeArtwork]);
  return <canvas ref={canvas} className="ascii-scene-motion" aria-hidden="true" data-testid="ascii-scene-motion" data-weather={weather.effects.map((effect) => effect.kind).join(",")} data-motion={stopped ? "paused" : reduced ? "reduced" : "animated"} />;
}
