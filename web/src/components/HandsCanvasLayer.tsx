import { useLayoutEffect, useRef, useState } from "react";
import { drawAllHandsStylized } from "../lib/drawStylizedHands";
import type { FrameMessage } from "../protocol";
import { useThemeStore } from "../store/themeStore";

type Props = {
  frame: FrameMessage | null;
  /** e.g. `hands-canvas-layer--viewport` for full-window overlay above top chrome */
  className?: string;
};

/**
 * Letterboxed hand silhouettes in camera space. Use the viewport variant so strokes sit above
 * the top bar (calibration / theme); `pointer-events: none` keeps controls clickable underneath.
 */
export function HandsCanvasLayer({ frame, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layoutGen, setLayoutGen] = useState(0);
  const handLeftHex = useThemeStore((s) => s.handLeftHex);
  const handRightHex = useThemeStore((s) => s.handRightHex);

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
    drawAllHandsStylized(ctx, frame.hands, w, h, iw, ih, {
      left: handLeftHex,
      right: handRightHex,
    });
  }, [frame, layoutGen, handLeftHex, handRightHex]);

  const rootClass = ["hands-canvas-layer", className].filter(Boolean).join(" ");

  return (
    <div ref={wrapRef} className={rootClass} aria-hidden>
      <canvas ref={canvasRef} className="hands-canvas-layer__canvas" />
    </div>
  );
}
