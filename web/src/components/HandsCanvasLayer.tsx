import { useLayoutEffect, useRef, useState } from "react";
import { drawAllHandsStylized } from "../lib/drawStylizedHands";
import type { FrameMessage } from "../protocol";

type Props = {
  frame: FrameMessage | null;
};

/**
 * Full tabletop layer: hands drawn in camera space (letterboxed), free-roaming — not clipped to platters.
 * Sits above the wood texture; mixer/decks stay on top (higher z-index).
 */
export function HandsCanvasLayer({ frame }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layoutGen, setLayoutGen] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLayoutGen((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 2 || h < 2) return;

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!frame?.hands?.length) {
      ctx.clearRect(0, 0, w, h);
      return;
    }

    const iw = frame.img_width > 0 ? frame.img_width : 16;
    const ih = frame.img_height > 0 ? frame.img_height : 9;
    drawAllHandsStylized(ctx, frame.hands, w, h, iw, ih);
  }, [frame, layoutGen]);

  return (
    <div ref={wrapRef} className="hands-canvas-layer" aria-hidden>
      <canvas ref={canvasRef} className="hands-canvas-layer__canvas" />
    </div>
  );
}
