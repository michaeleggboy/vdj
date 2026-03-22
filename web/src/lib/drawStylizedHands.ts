import { HAND_CONNECTIONS } from "./handConnections";
import type { HandPayload } from "../protocol";

const LEFT = "#5eead4";
const RIGHT = "#e879f9";

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

/**
 * Rounded “tube” hand: soft volume stroke + crisp outline + joint blobs — reads more like a hand than wireframe.
 */
export function drawStylizedHand(
  ctx: CanvasRenderingContext2D,
  hand: HandPayload,
  box: Letterbox,
  color: string,
): void {
  const lm = hand.landmarks;
  if (!lm?.length) return;

  const pts = lm.map((p) => mapLm(p, box));
  const scale = Math.min(box.drawW, box.drawH);
  const volW = Math.max(10, scale * 0.048);
  const midW = Math.max(4.5, scale * 0.024);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Soft volume (reads as flesh / mass)
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = volW;
  for (const [i, j] of HAND_CONNECTIONS) {
    const p0 = pts[i];
    const p1 = pts[j];
    if (!p0 || !p1) continue;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
  }

  // Main contour
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = midW;
  for (const [i, j] of HAND_CONNECTIONS) {
    const p0 = pts[i];
    const p1 = pts[j];
    if (!p0 || !p1) continue;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
  }

  // Knuckle / joint highlights
  const jr = Math.max(3.5, scale * 0.019);
  for (let k = 0; k < pts.length; k++) {
    const [px, py] = pts[k];
    const g = ctx.createRadialGradient(px - jr * 0.3, py - jr * 0.3, 0, px, py, jr * 1.2);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.4, color);
    g.addColorStop(1, hexToRgba(color, 0.45));
    ctx.fillStyle = g;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(px, py, jr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function handColorForSide(side: "left" | "right"): string {
  return side === "left" ? LEFT : RIGHT;
}

export function drawAllHandsStylized(
  ctx: CanvasRenderingContext2D,
  hands: HandPayload[],
  canvasW: number,
  canvasH: number,
  imgW: number,
  imgH: number,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  const box = letterboxRect(canvasW, canvasH, imgW, imgH);
  for (const h of hands) {
    const c = handColorForSide(h.side);
    drawStylizedHand(ctx, h, box, c);
  }
}
