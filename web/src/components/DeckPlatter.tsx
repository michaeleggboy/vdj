import { useRef, type CSSProperties } from "react";

type Props = {
  /** 0 = deck A (left), 1 = deck B (right) — for CSS variant */
  deck: "a" | "b";
  /** True when a hand is tracked on this deck — highlights platter + pauses spin */
  handActive?: boolean;
  /** Smoothed playback rate from mapper (can be negative when rewinding). Drives spin speed and direction. */
  scratchRate?: number;
  /** Deck transport position 0..1. */
  progress01?: number;
  /** Whether this deck has an audio track loaded. */
  loaded?: boolean;
  /** Whether this deck is currently playing. */
  playing?: boolean;
  /** Called when user taps scrub pad transport button. */
  onTransportToggle?: () => void;
};

/** Pad-style scrub visual with intensity ring and direction cue. */
export function DeckPlatter({ deck, handActive, scratchRate = 1, progress01 = 0, loaded = false, playing = false, onTransportToggle }: Props) {
  const sticker = deck === "a" ? "SCRUB A" : "SCRUB B";
  const deckName = deck === "a" ? "Deck A" : "Deck B";
  const progress = Math.max(0, Math.min(1, progress01));
  const progressPct = Math.round(progress * 100);
  const reverse = scratchRate < 0;
  const scrubIntensity = Math.max(0, Math.min(1, Math.abs(scratchRate - 1) / 1.05));
  const spinBoostRef = useRef(0);
  const spinLastTsRef = useRef(0);
  const nowTs = typeof performance !== "undefined" ? performance.now() : Date.now();
  const dt = spinLastTsRef.current > 0 ? Math.min(0.1, Math.max(0, (nowTs - spinLastTsRef.current) / 1000)) : 0.016;
  spinLastTsRef.current = nowTs;
  const targetBoostTurns = Math.min(0.24, scrubIntensity * 0.16) * (reverse ? -1 : 1);
  const settle = 1 - Math.exp(-dt * 10);
  spinBoostRef.current += (targetBoostTurns - spinBoostRef.current) * settle;
  if (Math.abs(targetBoostTurns) < 0.01) {
    spinBoostRef.current *= Math.exp(-dt * 5.5);
  }
  const progressTurns = progress * 20;
  const transportText = !loaded ? "Load" : playing ? "Pause" : "Play";
  const transportIcon = !loaded ? "⇪" : playing ? "❚❚" : "▶";
  const directionSymbol = reverse ? "⇦⇦" : "⇨⇨";
  const directionLabel = reverse ? "Reverse scrub direction" : "Forward scrub direction";
  const style = {
    "--platter-scrub-intensity": `${scrubIntensity}`,
    "--platter-progress-deg": `${progress * 360}deg`,
    "--platter-spin-turns": `${progressTurns}turn`,
    "--platter-spin-boost-turns": `${spinBoostRef.current}turn`,
  } as CSSProperties;

  return (
    <div className={`deck-platter deck-platter--${deck}${handActive ? " deck-platter--active" : ""}`}>
      <div className="deck-platter__pad" style={style} aria-label={`${deckName} scrub pad, ${progressPct} percent through track`}>
        <div className="deck-platter__pad-ring" aria-hidden />
        <div className="deck-platter__pad-progress-ring" aria-hidden />
        <div className="deck-platter__pad-progress-glow" aria-hidden />
        <div className="deck-platter__pad-motion" aria-hidden>
          <div className="deck-platter__pad-core" />
          <div className="deck-platter__pad-core-mark" />
        </div>
        <div className="deck-platter__pad-meta">
          <span className="deck-platter__pad-label">{sticker}</span>
          <span className="deck-platter__pad-progress">{progressPct}%</span>
        </div>
        <button
          type="button"
          className="deck-platter__transport-btn"
          onClick={onTransportToggle}
          aria-label={
            !loaded
              ? `${deckName} load track`
              : playing
                ? `${deckName} pause`
                : `${deckName} play`
          }
          title={!loaded ? `Load track for ${deckName}` : playing ? `Pause ${deckName}` : `Play ${deckName}`}
        >
          <span className="deck-platter__transport-icon" aria-hidden="true">
            {transportIcon}
          </span>
          <span className="deck-platter__transport-text">{transportText}</span>
        </button>
        <div className="deck-platter__pad-dir" role="status" aria-label={directionLabel}>
          <span className="deck-platter__pad-dir-icon" aria-hidden="true">
            {directionSymbol}
          </span>
          <span className="deck-platter__pad-dir-text" aria-hidden="true">
            Scrub direction
          </span>
        </div>
      </div>
    </div>
  );
}
