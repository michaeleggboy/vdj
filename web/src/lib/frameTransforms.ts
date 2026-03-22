import type { FrameMessage, HandPayload } from "../protocol";

function wristX(h: HandPayload): number {
  return h.landmarks[0]?.[0] ?? 0.5;
}

/**
 * Map detected hands to logical "left" / "right" **roles** using **camera image position**
 * (wrist x), not MediaPipe body handedness — so controls match what you see on screen.
 *
 * - Two hands: left side of frame → logical left (Deck A + crossfader), right side → logical right (Deck B).
 * - One hand: uses whether wrist is left or right **half** of the frame (split at 0.5).
 * - When `swap` is true, those two roles are **inverted**.
 */
export function assignHandsByCameraPosition(frame: FrameMessage, swap: boolean): FrameMessage {
  const hands = [...frame.hands];
  if (hands.length === 0) return frame;

  if (hands.length === 1) {
    const h = hands[0];
    const wx = wristX(h);
    let logicalLeft = wx < 0.5;
    if (swap) logicalLeft = !logicalLeft;
    const side: "left" | "right" = logicalLeft ? "left" : "right";
    const label = side === "left" ? "Left (screen)" : "Right (screen)";
    return { ...frame, hands: [{ ...h, side, label }] };
  }

  const sorted = [...hands].sort((a, b) => wristX(a) - wristX(b));
  const leftmost = sorted[0];
  const rightmost = sorted[1];
  const pair: HandPayload[] = swap
    ? [
        { ...rightmost, side: "left", label: "Left (screen)" },
        { ...leftmost, side: "right", label: "Right (screen)" },
      ]
    : [
        { ...leftmost, side: "left", label: "Left (screen)" },
        { ...rightmost, side: "right", label: "Right (screen)" },
      ];
  return { ...frame, hands: pair };
}
