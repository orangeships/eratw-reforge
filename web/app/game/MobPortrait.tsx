import { useEffect, useRef } from "react";
import type { DynamicCharacterPortrait } from "../../../modernization/runtime/state/game-state.js";
import mobPortraits from "./mob-portraits.bundle.json";

interface MobPortraitAsset {
  readonly src: string;
  readonly rect: readonly [number, number, number, number];
  readonly offset: readonly [number, number];
}

const ASSETS = mobPortraits as unknown as Record<string, MobPortraitAsset>;
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

export interface MobPortraitProps {
  portrait: DynamicCharacterPortrait;
  expression?: "normal" | "smile" | "angry";
  alt: string;
  className?: string;
  testId?: string;
}

/**
 * Composes the selected upstream mob layers into a fixed 180x180 canvas. A
 * character's layer names are persisted in GameState, while the crop map and
 * WebP sheets are generated from the upstream resource CSV at build time.
 */
export default function MobPortrait({
  portrait,
  expression = "normal",
  alt,
  className,
  testId,
}: MobPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layers = portrait[expression] ?? portrait.normal;
  const layerKey = layers.join("\u001f");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 180;
    canvas.height = 180;
    // jsdom does not ship a canvas implementation. Keep the fixed canvas
    // footprint in tests and let the browser compose layers when available.
    if (typeof window === "undefined" || typeof window.CanvasRenderingContext2D === "undefined") return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    let cancelled = false;
    const entries = layers
      .map((name) => ({ name, asset: ASSETS[name] }))
      .filter((entry): entry is { name: string; asset: MobPortraitAsset } => entry.asset !== undefined);

    void Promise.all(entries.map(async (entry) => ({
      asset: entry.asset,
      image: await loadImage(entry.asset.src),
    }))).then((loaded) => {
      if (cancelled) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const item of loaded) {
        if (!item.image) continue;
        const [x, y, width, height] = item.asset.rect;
        const [offsetX, offsetY] = item.asset.offset;
        try {
          context.drawImage(item.image, x, y, width, height, offsetX, offsetY, width, height);
        } catch {
          // A broken or partially decoded sheet should not break the scene.
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [layerKey, layers]);

  return (
    <span
      className={className}
      role="img"
      aria-label={alt}
      data-testid={testId}
      data-mob-portrait="upstream-mob"
      data-mob-expression={expression}
    >
      <canvas ref={canvasRef} className="mob-portrait__canvas" width={180} height={180} aria-hidden="true" />
    </span>
  );
}
