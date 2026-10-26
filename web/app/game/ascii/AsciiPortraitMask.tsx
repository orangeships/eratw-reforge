import { useEffect, useState } from "react";
import type { SpriteCropSource } from "../SpriteCrop.js";
import { loadAsciiImage } from "./AsciiBackdrop.js";
import { asciiHtml, rasterToAscii } from "./raster.js";
import { useReducedMotion } from "./AsciiEffects.js";

/** Dissolve the selected resource rectangle, never the full sprite sheet. */
export default function AsciiPortraitMask({ source }: { source: SpriteCropSource }) {
  const [html, setHtml] = useState("");
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    void loadAsciiImage(source.src).then((image) => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = 24; canvas.height = 24;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      const [x, y, w, h] = source.rect;
      ctx.drawImage(image, x, y, w, h, 0, 0, 24, 24);
      setHtml(asciiHtml(rasterToAscii(ctx.getImageData(0, 0, 24, 24).data, 24, 24)));
    }).catch(() => { /* The existing portrait remains available on failure. */ });
    return () => { cancelled = true; };
  }, [source, reduced]);
  if (!html || reduced) return null;
  return <pre className="ascii-portrait-mask" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}
