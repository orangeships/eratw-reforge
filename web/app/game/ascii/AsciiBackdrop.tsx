import { useState } from "react";
import { useReducedMotion } from "./AsciiEffects.js";
import { authoredSceneArtwork } from "./authored-scene-art.js";
import AsciiSceneMotion from "./AsciiSceneMotion.js";
import type { SceneWeather } from "./scene-motion.js";

// Shared by the portrait dissolve only; scene backgrounds never load/convert photos.
const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadAsciiImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { imageCache.delete(src); reject(new Error("Image unavailable")); };
    img.src = src;
  });
  if (imageCache.size >= 16) imageCache.delete(imageCache.keys().next().value!);
  imageCache.set(src, promise);
  return promise;
}

/** Display the approved glyph artwork immediately. Legacy TXT and photo-to-ASCII
 * backdrops are retired until a new scene presentation is designed. */
export default function AsciiBackdrop({ sceneId, stopped = false, weather }: {
  sceneId: string; stopped?: boolean; weather?: SceneWeather;
}) {
  const reduced = useReducedMotion();
  const sourceArtwork = authoredSceneArtwork(sceneId, !reduced);
  const [failedArtwork, setFailedArtwork] = useState<string>();
  const artwork = sourceArtwork !== failedArtwork ? sourceArtwork : undefined;
  return (
    <div className={`ascii-backdrop${stopped ? " ascii-backdrop--stopped" : ""}`} data-testid="ascii-backdrop" data-scene-id={sceneId} data-resource-state={artwork ? "authored-artwork" : "empty"} aria-hidden="true">
      {artwork && <img className="ascii-backdrop__artwork" src={artwork} alt="" draggable={false} onError={() => setFailedArtwork(artwork)} />}
      {artwork && <AsciiSceneMotion key={sceneId} sceneId={sceneId} weather={weather} stopped={stopped} fitArtwork nativeArtwork={!reduced} />}
    </div>
  );
}
