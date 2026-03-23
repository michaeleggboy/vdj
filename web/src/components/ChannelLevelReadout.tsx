type Props = {
  /** Mixer channel label, e.g. "A" or "B" */
  channelLabel: string;
  /** 0–1 channel level (same signal as deck gain before crossfader) */
  value: number;
  readoutHint?: string;
  /** Deck accent for fill color */
  deck: "a" | "b";
};

/**
 * Horizontal channel fader readout (hands-driven): right = louder.
 */
export function ChannelLevelReadout({ channelLabel, value, readoutHint = "from hands", deck }: Props) {
  const pct = Math.round(Math.min(100, Math.max(0, value * 100)));
  const groupLabel = `Channel ${channelLabel} level, ${pct} percent, ${readoutHint}`;

  return (
    <div
      className={`channel-level-readout channel-level-readout--${deck}${
        readoutHint ? " channel-level-readout--readout" : ""
      }`}
      role="group"
      aria-label={groupLabel}
    >
      <span className="channel-level-readout__label" aria-hidden="true">
        {channelLabel}
      </span>
      {readoutHint ? (
        <span className="channel-level-readout__hint" aria-hidden="true">
          {readoutHint}
        </span>
      ) : null}
      <div className="channel-level-readout__track" aria-hidden="true">
        <div className="channel-level-readout__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="channel-level-readout__value" aria-hidden="true">
        {pct}%
      </span>
    </div>
  );
}
