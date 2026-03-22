type Props = {
  label: string;
  gain: number;
  /** 0 = deck A (left), 1 = deck B (right) — for CSS variant */
  deck: "a" | "b";
  /** True when a hand is tracked on this deck — highlights platter + pauses spin */
  handActive?: boolean;
};

/**
 * Turntable-style jog wheel; spin speed scales with channel level.
 */
export function DeckPlatter({ label, gain, deck, handActive }: Props) {
  const dur = Math.max(0.8, 8 - gain * 7);
  return (
    <div className={`deck-platter deck-platter--${deck}`}>
      <span className="deck-platter__label">{label}</span>
      <div className={`deck-platter__stack${handActive ? " deck-platter__stack--hand" : ""}`}>
        <div className="deck-platter__wheel" style={{ animationDuration: `${dur}s` }}>
          <div className="deck-platter__groove" />
          <div className="deck-platter__groove deck-platter__groove--inner" />
          <div className="deck-platter__spindle" />
        </div>
      </div>
    </div>
  );
}
