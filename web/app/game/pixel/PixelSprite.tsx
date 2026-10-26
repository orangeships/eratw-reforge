import { PIXEL_ART, type PixelSpriteName } from './sprites.js';

export default function PixelSprite({ name, label, className = '' }: { name: PixelSpriteName; label?: string; className?: string }) {
  const art = PIXEL_ART[name];
  return <svg className={`pixel-sprite ${className}`} viewBox={`0 0 ${Math.max(...art.rows.map(row => row.length))} ${art.rows.length}`}
    shapeRendering="crispEdges" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
    {art.rows.flatMap((row, y) => [...row].flatMap((cell, x) => {
      const color = art.colors[cell as keyof typeof art.colors];
      return color ? [<rect key={`${x}:${y}`} x={x} y={y} width="1" height="1" fill={color} />] : [];
    }))}
  </svg>;
}
