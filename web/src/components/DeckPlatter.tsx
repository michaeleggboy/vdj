import type { CSSProperties } from "react";

type Props = {
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

const LEVEL_RING_R = 46;
/** pathLength=100 so stroke-dasharray is percent of full circle */
const LEVEL_PATH_LEN = 100;

/**
 * Turntable-style platter; spin speed scales with channel level (constant angular velocity).
 * Level is a circular ring around the jog (hands-driven readout).
 */
export function DeckPlatter({ gain, deck, handActive }: Props) {
  const dur = spinDurationSec(gain);
  const sticker = deck === "a" ? "A" : "B";
  const deckName = deck === "a" ? "Deck A" : "Deck B";
  const pct = Math.round(gain * 100);
  const dashFill = Math.min(LEVEL_PATH_LEN, Math.max(0, gain * LEVEL_PATH_LEN));

  return (
    <div className={`deck-platter deck-platter--${deck}`}>
      <div className={`deck-platter__stack${handActive ? " deck-platter__stack--hand" : ""}`}>
        <div
          className="deck-platter__wheel"
          style={{ "--platter-spin-duration": `${dur}s` } as CSSProperties}
          aria-label={`${deckName} jog wheel`}
        >
          <div className="deck-platter__rim" aria-hidden />
          <div className="deck-platter__groove-field" aria-hidden />
          <div className="deck-platter__spindle" aria-hidden />
          <div className="deck-platter__center-label">
            <span className="deck-platter__center-label-mark">{sticker}</span>
            <span className="deck-platter__center-label-ring" aria-hidden />
          </div>
        </div>
        <svg
          className="deck-platter__level-ring"
          viewBox="0 0 100 100"
          aria-hidden="true"
          focusable="false"
        >
          <g transform="rotate(-90 50 50)">
            <circle
              className="deck-platter__level-ring-track"
              cx="50"
              cy="50"
              r={LEVEL_RING_R}
              pathLength={LEVEL_PATH_LEN}
              fill="none"
              strokeDasharray={`${LEVEL_PATH_LEN} ${LEVEL_PATH_LEN}`}
            />
            <circle
              className="deck-platter__level-ring-fill"
              cx="50"
              cy="50"
              r={LEVEL_RING_R}
              pathLength={LEVEL_PATH_LEN}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${dashFill} ${LEVEL_PATH_LEN}`}
            />
          </g>
        </svg>
      </div>
      <p className="deck-platter__level-readout" aria-live="polite">
        <span className="deck-platter__level-readout-value">{pct}%</span>
        <span className="deck-platter__level-readout-hint">from hands</span>
      </p>
    </div>
  );
}
