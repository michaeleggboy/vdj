import type { CSSProperties } from "react";

type Props = {
  label: string;
  gain: number;
  /** 0 = deck A (left), 1 = deck B (right) — for CSS variant */
  deck: "a" | "b";
  /** True when a hand is tracked on this deck — highlights platter + pauses spin */
  handActive?: boolean;
};

/** ~33⅓ RPM baseline (one rev ≈ 1.8s); quieter channel = slower cue-style rotation. */
function spinDurationSec(gain: number): number {
  const minSec = 1.75;
  const maxSec = 6.25;
  return maxSec - gain * (maxSec - minSec);
}

/**
 * Turntable-style platter; spin speed scales with channel level (constant angular velocity).
 */
export function DeckPlatter({ label, gain, deck, handActive }: Props) {
  const dur = spinDurationSec(gain);
  const sticker = deck === "a" ? "A" : "B";
  return (
    <div className={`deck-platter deck-platter--${deck}`}>
      <span className="deck-platter__label">{label}</span>
      <div className={`deck-platter__stack${handActive ? " deck-platter__stack--hand" : ""}`}>
        <div
          className="deck-platter__wheel"
          style={{ "--platter-spin-duration": `${dur}s` } as CSSProperties}
        >
          <div className="deck-platter__rim" aria-hidden />
          <div className="deck-platter__groove-field" aria-hidden />
          <div className="deck-platter__center-label">
            <span className="deck-platter__center-label-mark">{sticker}</span>
            <span className="deck-platter__center-label-ring" aria-hidden />
          </div>
          <div className="deck-platter__spindle" />
        </div>
      </div>
    </div>
  );
}
