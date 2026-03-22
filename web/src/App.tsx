import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { DeckPlatter } from "./components/DeckPlatter";
import { DjAudioEngine } from "./components/DjAudioEngine";
import { HandsCanvasLayer } from "./components/HandsCanvasLayer";
import { ThemeControls } from "./components/ThemeControls";
import { useHandWebSocket } from "./hooks/useHandWebSocket";
import { assignHandsByCameraPosition } from "./lib/frameTransforms";
import { HAND_WS_URL } from "./handWsUrl";
import { useDjStore } from "./store/djStore";
import { useThemeStore } from "./store/themeStore";
import "./App.css";

const NEUTRAL_DELAY_SEC = 5;

function MixerFader({
  label,
  value,
  readoutHint,
}: {
  label: string;
  value: number;
  /** If set, fader is styled as a live readout (hands drive values), not a drag control. */
  readoutHint?: string;
}) {
  const pct = Math.round(value * 100);
  const readout = readoutHint != null && readoutHint !== "";
  return (
    <div className={`mixer-fader mixer-fader--horizontal${readout ? " mixer-fader--readout" : ""}`}>
      <span className="mixer-fader__label">{label}</span>
      {readout ? <span className="mixer-fader__hint">{readoutHint}</span> : null}
      <div className="mixer-fader__track" aria-hidden>
        <div className="mixer-fader__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="mixer-fader__value">{pct}%</span>
    </div>
  );
}

export default function App() {
  useLayoutEffect(() => {
    useThemeStore.getState().hydrate();
  }, []);
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
  const [neutralCountdown, setNeutralCountdown] = useState<number | null>(null);

  const toggleNeutralCountdown = useCallback(() => {
    setNeutralCountdown((c) => (c === null ? NEUTRAL_DELAY_SEC : null));
  }, []);

  useEffect(() => {
    if (neutralCountdown === null) return;
    if (neutralCountdown === 0) {
      calibrate();
      setNeutralCountdown(null);
      return;
    }
    const id = window.setTimeout(() => {
      setNeutralCountdown((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => clearTimeout(id);
  }, [neutralCountdown, calibrate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      ) {
        return;
      }
      e.preventDefault();
      toggleNeutralCountdown();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleNeutralCountdown]);
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
      <HandsCanvasLayer frame={previewFrame} className="hands-canvas-layer--viewport" />
      <header className="top-bar">
        <div className="top-bar__row">
          <div className="top-bar__brand">
            <h1>vdj</h1>
            <span className="top-bar__tagline">tabletop</span>
          </div>
          <div
            className={`top-bar__status ${connected ? "top-bar__status--ok" : "top-bar__status--off"}`}
            title={
              connected
                ? "Receiving frames from hand_service"
                : `Start hand_service (see README). This app expects ${HAND_WS_URL}`
            }
          >
            {connected ? (
              "Connected"
            ) : (
              <>
                <span className="top-bar__status-primary">Hand service offline</span>
                <span className="top-bar__status-hint">Run Python service · {HAND_WS_URL}</span>
              </>
            )}
          </div>
          <div className="top-bar__actions top-bar__actions--main">
            <DjAudioEngine />
            <label
              className="top-bar__swap"
              title="Swap which camera side (left/right) maps to Deck A vs B on screen and in gesture mapping. Audio channels stay A/B."
            >
              <input
                type="checkbox"
                checked={swapHands}
                onChange={(e) => setSwapHands(e.target.checked)}
              />
              Swap L/R
            </label>
            <button
              type="button"
              className={`btn${neutralCountdown !== null ? " btn--neutral-armed" : ""}`}
              onClick={toggleNeutralCountdown}
              title={
                neutralCountdown === null
                  ? "Start 5s countdown, then capture neutral pose (or press N)"
                  : "Cancel countdown"
              }
            >
              {neutralCountdown === null ? "Neutral" : `Cancel (${neutralCountdown}s)`}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => resetMapper()}>
              Reset
            </button>
          </div>
        </div>
        {neutralCountdown !== null && neutralCountdown > 0 ? (
          <div className="top-bar__neutral-banner" role="status" aria-live="polite">
            <div className="top-bar__neutral-banner-inner">
              <span className="top-bar__neutral-banner-title">Neutral calibration</span>
              <span className="top-bar__neutral-banner-digit-wrap" aria-hidden>
                <span key={neutralCountdown} className="top-bar__neutral-banner-digit">
                  {neutralCountdown}
                </span>
              </span>
              <span className="top-bar__neutral-banner-hint">
                Move hands into position — press Neutral or N to cancel.
              </span>
            </div>
          </div>
        ) : null}
        <details className="top-bar__cal-wrap">
          <summary className="top-bar__disclosure-summary">Calibration · two-point snaps</summary>
          <div className="top-bar__cal2" role="group" aria-label="Two-point calibration">
            <p className="top-bar__cal-hint">
              Snaps target <strong>audio</strong> Deck A/B (mixer channels), not camera left/right. Use{" "}
              <strong>Swap L/R</strong> if the on-screen columns should follow the other wrist.
            </p>
            <div className="top-bar__cal2-row">
              <span className="top-bar__cal2-label">Crossfader</span>
              <button
                type="button"
                className="btn btn--mini"
                onClick={() => snapCrossLeft()}
                title="With hands where you want minimum crossfader, set this as the 0% reference"
              >
                Left 0%
              </button>
              <button
                type="button"
                className="btn btn--mini"
                onClick={() => snapCrossRight()}
                title="With hands where you want maximum crossfader, set this as the 100% reference"
              >
                Right 100%
              </button>
              <button type="button" className="btn btn--mini btn--ghost" onClick={() => clearCrossTwoPoint()}>
                Clear
              </button>
              <span className="top-bar__cal2-label" title="Always mixer channel A">
                Deck A
              </span>
              <button
                type="button"
                className="btn btn--mini"
                onClick={() => snapDeckAQuiet()}
                title="Quiet end of range for audio Deck A"
              >
                Quiet
              </button>
              <button
                type="button"
                className="btn btn--mini"
                onClick={() => snapDeckALoud()}
                title="Loud end of range for audio Deck A"
              >
                Loud
              </button>
              <span className="top-bar__cal2-label" title="Always mixer channel B">
                Deck B
              </span>
              <button
                type="button"
                className="btn btn--mini"
                onClick={() => snapDeckBQuiet()}
                title="Quiet end of range for audio Deck B"
              >
                Quiet
              </button>
              <button
                type="button"
                className="btn btn--mini"
                onClick={() => snapDeckBLoud()}
                title="Loud end of range for audio Deck B"
              >
                Loud
              </button>
              <button type="button" className="btn btn--mini btn--ghost" onClick={() => clearGainTwoPoint()}>
                Clear levels
              </button>
            </div>
          </div>
        </details>
        <ThemeControls />
        {lastError ? <p className="top-bar__err">{lastError}</p> : null}
      </header>

      <div className="table-surface">
        <div className="table-surface__grid">
          <section className={`deck-kit deck-kit--${leftDeck}`} aria-label={leftLabel}>
            <DeckPlatter gain={leftGain} deck={leftDeck} handActive={!!leftHand} />
          </section>

          <section className="deck-kit deck-kit--mixer" aria-label="Crossfader">
            <div className="deck-kit__mixer-spacer" />
            <MixerFader label="Crossfader" value={crossfader} readoutHint="from hands" />
          </section>

          <section className={`deck-kit deck-kit--${rightDeck}`} aria-label={rightLabel}>
            <DeckPlatter gain={rightGain} deck={rightDeck} handActive={!!rightHand} />
          </section>
        </div>
      </div>
    </div>
  );
}
