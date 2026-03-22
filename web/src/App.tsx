import { useMemo } from "react";
import { DeckPlatter } from "./components/DeckPlatter";
import { HandsCanvasLayer } from "./components/HandsCanvasLayer";
import { useHandWebSocket } from "./hooks/useHandWebSocket";
import { assignHandsByCameraPosition } from "./lib/frameTransforms";
import { useDjStore } from "./store/djStore";
import "./App.css";

function MixerFader({
  label,
  value,
  vertical,
}: {
  label: string;
  value: number;
  vertical?: boolean;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className={`mixer-fader ${vertical ? "mixer-fader--vertical" : "mixer-fader--horizontal"}`}>
      <span className="mixer-fader__label">{label}</span>
      <div className="mixer-fader__track" aria-hidden>
        <div
          className="mixer-fader__fill"
          style={vertical ? { height: `${pct}%` } : { width: `${pct}%` }}
        />
      </div>
      <span className="mixer-fader__value">{pct}%</span>
    </div>
  );
}

export default function App() {
  useHandWebSocket();
  const connected = useDjStore((s) => s.connected);
  const lastError = useDjStore((s) => s.lastError);
  const lastFrameRaw = useDjStore((s) => s.lastFrameRaw);
  const swapHands = useDjStore((s) => s.swapHands);
  const previewFrame = useMemo(
    () => (lastFrameRaw ? assignHandsByCameraPosition(lastFrameRaw, swapHands) : null),
    [lastFrameRaw, swapHands],
  );
  const setSwapHands = useDjStore((s) => s.setSwapHands);
  const mapper = useDjStore((s) => s.mapper);
  const calibrate = useDjStore((s) => s.calibrate);
  const resetMapper = useDjStore((s) => s.resetMapper);
  const snapCrossLeft = useDjStore((s) => s.snapCrossLeft);
  const snapCrossRight = useDjStore((s) => s.snapCrossRight);
  const clearCrossTwoPoint = useDjStore((s) => s.clearCrossTwoPoint);
  const snapDeckAQuiet = useDjStore((s) => s.snapDeckAQuiet);
  const snapDeckALoud = useDjStore((s) => s.snapDeckALoud);
  const snapDeckBQuiet = useDjStore((s) => s.snapDeckBQuiet);
  const snapDeckBLoud = useDjStore((s) => s.snapDeckBLoud);
  const clearGainTwoPoint = useDjStore((s) => s.clearGainTwoPoint);
  const { crossfader, deckAGain, deckBGain } = mapper.smooth;

  /** Left/right tabletop columns follow camera left/right; logical A/B swap is reflected in labels + gains. */
  const leftGain = swapHands ? deckBGain : deckAGain;
  const rightGain = swapHands ? deckAGain : deckBGain;
  const leftLabel = swapHands ? "Deck B" : "Deck A";
  const rightLabel = swapHands ? "Deck A" : "Deck B";
  const leftDeck = swapHands ? ("b" as const) : ("a" as const);
  const rightDeck = swapHands ? ("a" as const) : ("b" as const);

  const leftHand = previewFrame?.hands.find((h) => h.side === "left") ?? null;
  const rightHand = previewFrame?.hands.find((h) => h.side === "right") ?? null;

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar__row">
          <div className="top-bar__brand">
            <h1>vdj</h1>
            <span className="top-bar__tagline">tabletop</span>
          </div>
          <div className={`top-bar__status ${connected ? "top-bar__status--ok" : "top-bar__status--off"}`}>
            {connected ? "Connected" : "Waiting…"}
          </div>
          <div className="top-bar__actions">
            <label className="top-bar__swap">
              <input
                type="checkbox"
                checked={swapHands}
                onChange={(e) => setSwapHands(e.target.checked)}
              />
              Swap L/R
            </label>
            <button type="button" className="btn" onClick={() => calibrate()} title="Neutral pose for faders">
              Neutral
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => resetMapper()}>
              Reset
            </button>
          </div>
        </div>
        <div className="top-bar__cal2" aria-label="Two-point calibration">
          <span className="top-bar__cal2-label">Crossfader</span>
          <button type="button" className="btn btn--mini" onClick={() => snapCrossLeft()} title="Hands where you want 0% crossfader">
            Left 0%
          </button>
          <button type="button" className="btn btn--mini" onClick={() => snapCrossRight()} title="Hands where you want 100% crossfader">
            Right 100%
          </button>
          <button type="button" className="btn btn--mini btn--ghost" onClick={() => clearCrossTwoPoint()}>
            Clear
          </button>
          <span className="top-bar__cal2-label">Deck A</span>
          <button type="button" className="btn btn--mini" onClick={() => snapDeckAQuiet()}>
            Quiet
          </button>
          <button type="button" className="btn btn--mini" onClick={() => snapDeckALoud()}>
            Loud
          </button>
          <span className="top-bar__cal2-label">Deck B</span>
          <button type="button" className="btn btn--mini" onClick={() => snapDeckBQuiet()}>
            Quiet
          </button>
          <button type="button" className="btn btn--mini" onClick={() => snapDeckBLoud()}>
            Loud
          </button>
          <button type="button" className="btn btn--mini btn--ghost" onClick={() => clearGainTwoPoint()}>
            Clear levels
          </button>
        </div>
        {lastError ? <p className="top-bar__err">{lastError}</p> : null}
      </header>

      <div className="table-surface">
        <HandsCanvasLayer frame={previewFrame} />
        <div className="table-surface__grid">
          <section className={`deck-kit deck-kit--${leftDeck}`} aria-label={leftLabel}>
            <DeckPlatter label={leftLabel} gain={leftGain} deck={leftDeck} handActive={!!leftHand} />
            <MixerFader label="Level" value={leftGain} vertical />
          </section>

          <section className="deck-kit deck-kit--mixer" aria-label="Crossfader">
            <div className="deck-kit__mixer-spacer" />
            <MixerFader label="Crossfader" value={crossfader} />
          </section>

          <section className={`deck-kit deck-kit--${rightDeck}`} aria-label={rightLabel}>
            <DeckPlatter label={rightLabel} gain={rightGain} deck={rightDeck} handActive={!!rightHand} />
            <MixerFader label="Level" value={rightGain} vertical />
          </section>
        </div>
      </div>
    </div>
  );
}
