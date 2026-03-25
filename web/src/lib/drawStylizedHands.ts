import { HAND_OUTLINE_ORDER } from "./handConnections";
import type { HandPayload } from "../protocol";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export type Letterbox = {
  ox: number;
  oy: number;
  drawW: number;
  drawH: number;
};

/** Fit image aspect into canvas; return mapping rect (pixel coords, CSS pixels). */
export function letterboxRect(
  canvasW: number,
  canvasH: number,
  imgW: number,
  imgH: number,
): Letterbox {
  if (canvasW < 2 || canvasH < 2 || imgW <= 0 || imgH <= 0) {
    return { ox: 0, oy: 0, drawW: canvasW, drawH: canvasH };
  }
  const ar = imgW / imgH;
  const cw = canvasW;
  const ch = canvasH;
  const containerAr = cw / ch;
  if (containerAr > ar) {
    const drawH = ch;
    const drawW = ch * ar;
    const ox = (cw - drawW) / 2;
    return { ox, oy: 0, drawW, drawH };
  }
  const drawW = cw;
  const drawH = cw / ar;
  const oy = (ch - drawH) / 2;
  return { ox: 0, oy, drawW, drawH };
}

function mapLm(
  lm: [number, number, number],
  box: Letterbox,
): [number, number] {
  return [box.ox + lm[0] * box.drawW, box.oy + lm[1] * box.drawH];
}

function centroid(pts: [number, number][]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const n = pts.length || 1;
  return [sx / n, sy / n];
}

/**
 * Filled hand silhouette from outer landmark loop — no bone segments.
 */
export function drawStylizedHand(
  ctx: CanvasRenderingContext2D,
  hand: HandPayload,
  box: Letterbox,
  color: string,
  pinchEngaged?: boolean,
): void {
  const lm = hand.landmarks;
  if (!lm?.length) return;

  const pts = lm.map((p) => mapLm(p, box));
  const outline: [number, number][] = [];
  for (const idx of HAND_OUTLINE_ORDER) {
    const p = pts[idx];
    if (p) outline.push(p);
  }
  if (outline.length < 4) return;

  const scale = Math.min(box.drawW, box.drawH);
  const [cx, cy] = centroid(outline);
  const edgeW = Math.max(1.5, scale * 0.004);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i][0], outline[i][1]);
  }
  ctx.closePath();

  const g = ctx.createRadialGradient(
    cx - scale * 0.02,
    cy - scale * 0.02,
    scale * 0.06,
    cx,
    cy,
    scale * 0.42,
  );
  const fillBoost = pinchEngaged ? 1.12 : 1;
  g.addColorStop(0, hexToRgba(color, Math.min(0.99, 0.92 * fillBoost)));
  g.addColorStop(0.55, hexToRgba(color, Math.min(0.95, 0.72 * fillBoost)));
  g.addColorStop(1, hexToRgba(color, Math.min(0.88, 0.45 * fillBoost)));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = hexToRgba(color, 0.55);
  ctx.lineWidth = edgeW * 2;
  ctx.globalAlpha = pinchEngaged ? 0.5 : 0.35;
  ctx.stroke();

  ctx.strokeStyle = hexToRgba(color, 0.85);
  ctx.lineWidth = edgeW;
  ctx.globalAlpha = pinchEngaged ? 0.98 : 0.9;
  ctx.stroke();

  ctx.restore();
}

export function drawAllHandsStylized(
  ctx: CanvasRenderingContext2D,
  hands: HandPayload[],
  canvasW: number,
  canvasH: number,
  imgW: number,
  imgH: number,
  handColors: { left: string; right: string },
  pinchEngagedForLabel?: Record<string, boolean>,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  const box = letterboxRect(canvasW, canvasH, imgW, imgH);
  for (const h of hands) {
    const c = h.side === "left" ? handColors.left : handColors.right;
    const engaged = pinchEngagedForLabel?.[h.label] ?? false;
    drawStylizedHand(ctx, h, box, c, engaged);
  }
}
