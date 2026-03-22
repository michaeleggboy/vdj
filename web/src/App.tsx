import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { DeckPlatter } from "./components/DeckPlatter";
import { DjAudioEngine } from "./components/DjAudioEngine";
import { HandsCanvasLayer } from "./components/HandsCanvasLayer";
import { ThemeControlsPanel } from "./components/ThemeControls";
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
  const groupLabel = readout ? `${label}, ${pct} percent, ${readoutHint}` : `${label}, ${pct} percent`;
  return (
    <div
      className={`mixer-fader mixer-fader--horizontal${readout ? " mixer-fader--readout" : ""}`}
      role="group"
      aria-label={groupLabel}
    >
      <span className="mixer-fader__label" aria-hidden="true">
        {label}
      </span>
      {readout ? (
        <span className="mixer-fader__hint" aria-hidden="true">
          {readoutHint}
        </span>
      ) : null}
      <div className="mixer-fader__track" aria-hidden="true">
        <div className="mixer-fader__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="mixer-fader__value" aria-hidden="true">
        {pct}%
      </span>
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
            role="status"
            aria-live="polite"
            aria-atomic="true"
            title={
              connected
                ? "Receiving frames from hand_service"
                : `Start hand_service (see README). This app expects ${HAND_WS_URL}`
            }
          >
            {connected ? (
              <>
                <span aria-hidden="true">Connected</span>
                <span className="sr-only">Hand service connected.</span>
              </>
            ) : (
              <>
                <span className="top-bar__status-primary" aria-hidden="true">
                  Hand service offline
                </span>
                <span className="top-bar__status-hint" aria-hidden="true">
                  Run Python service · {HAND_WS_URL}
                </span>
                <span className="sr-only">
                  Hand service offline. Start the Python hand service. Expected WebSocket {HAND_WS_URL}
                </span>
              </>
            )}
          </div>
          <div className="top-bar__actions top-bar__actions--main">
            <DjAudioEngine />
            <label
              className="top-bar__swap"
              title="Swap Deck A and Deck B on screen (left/right columns and hand mapping). Mixer audio channels stay A/B."
            >
              <input
                type="checkbox"
                checked={swapHands}
                onChange={(e) => setSwapHands(e.target.checked)}
                aria-describedby="swap-ab-hint"
              />
              Swap A/B
              <span id="swap-ab-hint" className="sr-only">
                Swaps which deck appears on the left and right. Audio channels A and B do not swap.
              </span>
            </label>
            <div className="top-bar__neutral-with-kbd">
              <button
                type="button"
                className={`btn${neutralCountdown !== null ? " btn--neutral-armed" : ""}`}
                onClick={toggleNeutralCountdown}
                title={
                  neutralCountdown === null
                    ? "Start 5s countdown, then capture neutral pose (or press N)"
                    : "Cancel countdown (or press N)"
                }
              >
                {neutralCountdown === null ? "Neutral" : `Cancel (${neutralCountdown}s)`}
              </button>
              <kbd className="top-bar__kbd" aria-hidden="true" title="Shortcut when not typing in a field">
                N
              </kbd>
            </div>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => resetMapper()}
              aria-label="Reset gesture mapping to defaults"
            >
              Reset
            </button>
          </div>
        </div>
        {neutralCountdown !== null && neutralCountdown > 0 ? (
          <div className="top-bar__neutral-banner" role="status" aria-live="polite" aria-atomic="true">
            <div className="top-bar__neutral-banner-inner">
              <span className="top-bar__neutral-banner-title">Neutral calibration</span>
              <span className="top-bar__neutral-banner-digit-wrap" aria-hidden="true">
                <span key={neutralCountdown} className="top-bar__neutral-banner-digit">
                  {neutralCountdown}
                </span>
              </span>
              <span className="top-bar__neutral-banner-hint">
                Move hands into position — press Neutral or N to cancel.
              </span>
              <span className="sr-only">
                {neutralCountdown} {neutralCountdown === 1 ? "second" : "seconds"} until neutral pose is captured.
              </span>
            </div>
          </div>
        ) : null}
        <details className="top-bar__setup" aria-label="Setup: calibration and appearance">
          <summary className="top-bar__disclosure-summary">Setup</summary>
          <div className="top-bar__setup-body">
            <section className="top-bar__setup-section" aria-labelledby="top-bar-setup-cal">
              <h2 id="top-bar-setup-cal" className="top-bar__setup-section-title">
                Calibration
              </h2>
              <div className="top-bar__cal2" role="group" aria-label="Two-point calibration">
                <p className="top-bar__cal-hint">
                  Snaps target <strong>audio</strong> Deck A/B (mixer channels), not camera left/right. Use{" "}
                  <strong>Swap A/B</strong> if the on-screen columns should follow the other wrist.
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
            </section>
            <section className="top-bar__setup-section top-bar__setup-section--appearance" aria-labelledby="top-bar-setup-theme">
              <h2 id="top-bar-setup-theme" className="top-bar__setup-section-title">
                Appearance
              </h2>
              <ThemeControlsPanel />
            </section>
          </div>
        </details>
        {lastError ? (
          <p className="top-bar__err" role="alert" aria-live="assertive">
            {lastError}
          </p>
        ) : null}
      </header>

      <main id="main-content" className="table-surface" tabIndex={-1}>
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
      </main>
    </div>
  );
}
