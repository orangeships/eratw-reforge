import type { CSSProperties } from "react";

/** One Emuera still-sprite entry after its XML `param` has been decoded. */
export interface SpriteCropSource {
  sprite: string;
  src: string;
  rect: readonly [x: number, y: number, width: number, height: number];
}

export interface SpriteCropProps {
  source: SpriteCropSource;
  alt: string;
  className?: string;
  /** Maximum rendered footprint. The crop keeps its original aspect ratio. */
  frameWidth?: number;
  frameHeight?: number;
  /** Contain the complete resource crop when the shell has a bounded portrait column. */
  fit?: "cover" | "contain";
  imageTestId?: string;
  cropTestId?: string;
}

/**
 * Browser equivalent of Emuera's `SPRITECREATE name, image, x, y, w, h`.
 *
 * The viewport is the selected XML rectangle. The full sheet keeps its native
 * dimensions, is scaled uniformly, and is shifted by the scaled crop origin.
 * This deliberately does not use `object-fit`: object-fit would fit the whole
 * sprite sheet instead of one registered sprite.
 */
export default function SpriteCrop({
  source,
  alt,
  className,
  frameWidth = 130,
  frameHeight = 200,
  fit = "cover",
  imageTestId,
  cropTestId,
}: SpriteCropProps) {
  const [x, y, width, height] = source.rect;
  // Portrait cells are usually square while the stage slot is tall. `cover`
  // keeps the character visually present instead of leaving a large empty
  // band above a tiny contained square; the outer frame clips only overflow.
  const scale = fit === "contain"
    ? Math.min(frameWidth / width, frameHeight / height)
    : Math.max(frameWidth / width, frameHeight / height);
  const viewportStyle: CSSProperties = {
    width: `${width * scale}px`,
    height: `${height * scale}px`,
  };
  const sheetStyle: CSSProperties = {
    left: `${-x * scale}px`,
    top: `${-y * scale}px`,
    transform: `scale(${scale})`,
  };

  return (
    <span
      className={className}
      role="img"
      aria-label={alt}
      data-sprite={source.sprite}
      data-testid={cropTestId}
    >
      <span
        className="sprite-crop__viewport"
        style={viewportStyle}
        data-crop-x={x}
        data-crop-y={y}
        data-crop-width={width}
        data-crop-height={height}
      >
        <img
          className="sprite-crop__sheet"
          src={source.src}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={sheetStyle}
          data-testid={imageTestId}
        />
      </span>
    </span>
  );
}
