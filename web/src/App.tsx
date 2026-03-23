import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChannelLevelReadout } from "./components/ChannelLevelReadout";
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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
  useEffect(() => {
    if (!drawerOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [drawerOpen]);
  const snapCrossLeft = useDjStore((s) => s.snapCrossLeft);
  const snapCrossRight = useDjStore((s) => s.snapCrossRight);
  const clearCrossTwoPoint = useDjStore((s) => s.clearCrossTwoPoint);
  const snapDeckAQuiet = useDjStore((s) => s.snapDeckAQuiet);
  const snapDeckALoud = useDjStore((s) => s.snapDeckALoud);
  const snapDeckBQuiet = useDjStore((s) => s.snapDeckBQuiet);
  const snapDeckBLoud = useDjStore((s) => s.snapDeckBLoud);
  const clearGainTwoPoint = useDjStore((s) => s.clearGainTwoPoint);
  const setDeskLayoutSnapshot = useDjStore((s) => s.setDeskLayoutSnapshot);
  const deckProgress = useDjStore((s) => s.deckProgress);
  const deckLoaded = useDjStore((s) => s.deckLoaded);
  const deckPlaying = useDjStore((s) => s.deckPlaying);
  const requestTransportToggle = useDjStore((s) => s.requestTransportToggle);
  const requestDeckLoad = useDjStore((s) => s.requestDeckLoad);
  const { crossfader, deckAGain, deckBGain, scratchRateA, scratchRateB, handIntentLeft, handIntentRight, handStrengthLeft, handStrengthRight } =
    mapper.smooth;

  const leftKitRef = useRef<HTMLDivElement | null>(null);
  const mixerStripRef = useRef<HTMLElement | null>(null);
  const mixerFaderARef = useRef<HTMLDivElement | null>(null);
  const mixerCrossfadeRef = useRef<HTMLDivElement | null>(null);
  const mixerFaderBRef = useRef<HTMLDivElement | null>(null);
  const rightKitRef = useRef<HTMLDivElement | null>(null);
  const deckFileInputARef = useRef<HTMLInputElement | null>(null);
  const deckFileInputBRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    const updateLayout = () => {
      const le = leftKitRef.current;
      const re = rightKitRef.current;
      const fa = mixerFaderARef.current;
      const xc = mixerCrossfadeRef.current;
      const fb = mixerFaderBRef.current;
      const mixerEl = mixerStripRef.current;
      const sw = useDjStore.getState().swapHands;
      if (!le || !re || !fa || !xc || !fb || !mixerEl) {
        setDeskLayoutSnapshot(null);
        return;
      }
      const plain = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      setDeskLayoutSnapshot({
        left: plain(le.getBoundingClientRect()),
        right: plain(re.getBoundingClientRect()),
        mixerFaderA: plain(fa.getBoundingClientRect()),
        mixerCrossfade: plain(xc.getBoundingClientRect()),
        mixerFaderB: plain(fb.getBoundingClientRect()),
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        leftColumnDeck: sw ? "b" : "a",
        rightColumnDeck: sw ? "a" : "b",
      });
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    const ro = new ResizeObserver(updateLayout);
    const mainEl = document.getElementById("main-content");
    if (mainEl) ro.observe(mainEl);
    return () => {
      window.removeEventListener("resize", updateLayout);
      ro.disconnect();
    };
  }, [swapHands, setDeskLayoutSnapshot]);

  /** Left/right tabletop columns follow camera left/right; logical A/B swap is reflected in labels. */
  const leftLabel = swapHands ? "Deck B" : "Deck A";
  const rightLabel = swapHands ? "Deck A" : "Deck B";
  const leftDeck = swapHands ? ("b" as const) : ("a" as const);
  const rightDeck = swapHands ? ("a" as const) : ("b" as const);
  const onPadTransportToggle = useCallback(
    (deck: "a" | "b") => {
      const loaded = deck === "a" ? deckLoaded.a : deckLoaded.b;
      if (!loaded) {
        (deck === "a" ? deckFileInputARef.current : deckFileInputBRef.current)?.click();
        return;
      }
      requestTransportToggle(deck);
    },
    [deckLoaded.a, deckLoaded.b, requestTransportToggle],
  );
  const onDeckFilePicked = useCallback(
    (deck: "a" | "b", file: File | null) => {
      if (!file) return;
      requestDeckLoad(deck, file);
    },
    [requestDeckLoad],
  );

  const leftHand = previewFrame?.hands.find((h) => h.side === "left") ?? null;
  const rightHand = previewFrame?.hands.find((h) => h.side === "right") ?? null;
  const laneAActive = handIntentLeft === "levelA" || handIntentRight === "levelA";
  const laneBActive = handIntentLeft === "levelB" || handIntentRight === "levelB";
  const laneCrossActive = handIntentLeft === "crossfader" || handIntentRight === "crossfader";
  const laneLeftScrubActive =
    (leftDeck === "a" && (handIntentLeft === "scrubA" || handIntentRight === "scrubA")) ||
    (leftDeck === "b" && (handIntentLeft === "scrubB" || handIntentRight === "scrubB"));
  const laneRightScrubActive =
    (rightDeck === "a" && (handIntentLeft === "scrubA" || handIntentRight === "scrubA")) ||
    (rightDeck === "b" && (handIntentLeft === "scrubB" || handIntentRight === "scrubB"));
  const laneLeftStrength = Math.round(Math.max(0, Math.min(1, handStrengthLeft)) * 100);
  const laneRightStrength = Math.round(Math.max(0, Math.min(1, handStrengthRight)) * 100);
  const intentLabel = (i: string) => {
    if (i === "crossfader") return "Crossfader";
    if (i === "levelA") return "Level A";
    if (i === "levelB") return "Level B";
    if (i === "scrubA") return "Scrub A";
    if (i === "scrubB") return "Scrub B";
    return "Idle";
  };

  return (
    <div className="app">
      <HandsCanvasLayer frame={previewFrame} className="hands-canvas-layer--viewport" />
      <header className="top-bar top-bar--minimal">
        <div className="top-bar__row">
          <div className="top-bar__brand">
            <h1>vdj</h1>
            <span className="top-bar__tagline">pads</span>
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
            {connected ? <span aria-hidden="true">Connected</span> : <span aria-hidden="true">Offline</span>}
          </div>
          <div className="top-bar__actions top-bar__actions--main">
            <button
              type="button"
              className="btn btn--mini"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-expanded={drawerOpen}
              aria-controls="control-drawer"
            >
              {drawerOpen ? "Hide controls" : "Show controls"}
            </button>
          </div>
        </div>
        {lastError ? (
          <p className="top-bar__err" role="alert" aria-live="assertive">
            {lastError}
          </p>
        ) : null}
      </header>

      {drawerOpen ? (
        <button
          type="button"
          className="control-drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close controls drawer"
        />
      ) : null}
      <aside id="control-drawer" className={`control-drawer${drawerOpen ? " control-drawer--open" : ""}`} aria-label="Controls drawer">
        <div className="control-drawer__section">
          <h2 className="control-drawer__title">Audio</h2>
          <DjAudioEngine />
        </div>
        <div className="control-drawer__section">
          <h2 className="control-drawer__title">Mapping</h2>
          <label
            className="top-bar__swap"
            title="Swap Deck A and Deck B on screen (left/right pads and hand mapping). Mixer audio channels stay A/B."
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
              className={`btn btn--mini${neutralCountdown !== null ? " btn--neutral-armed" : ""}`}
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
            <button type="button" className="btn btn--mini btn--ghost" onClick={() => resetMapper()}>
              Reset mapper
            </button>
          </div>
          <div className="top-bar__cal2-row">
            <span className="top-bar__cal2-label">Crossfader</span>
            <button type="button" className="btn btn--mini" onClick={() => snapCrossLeft()}>
              Left 0%
            </button>
            <button type="button" className="btn btn--mini" onClick={() => snapCrossRight()}>
              Right 100%
            </button>
            <button type="button" className="btn btn--mini btn--ghost" onClick={() => clearCrossTwoPoint()}>
              Clear
            </button>
          </div>
          <div className="top-bar__cal2-row">
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
        </div>
        <div className="control-drawer__section">
          <h2 className="control-drawer__title">Appearance</h2>
          <ThemeControlsPanel />
        </div>
      </aside>
      <input
        ref={deckFileInputARef}
        type="file"
        accept="audio/*"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(e) => {
          onDeckFilePicked("a", e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <input
        ref={deckFileInputBRef}
        type="file"
        accept="audio/*"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(e) => {
          onDeckFilePicked("b", e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      <main id="main-content" className="table-surface" tabIndex={-1}>
        <div className="intent-rail" aria-live="polite">
          <div className="intent-badge intent-badge--left">
            <span className="intent-badge__title">Left hand</span>
            <span className="intent-badge__value">{intentLabel(handIntentLeft)}</span>
            <span className="intent-badge__meter" aria-hidden>
              <span style={{ width: `${laneLeftStrength}%` }} />
            </span>
          </div>
          <div className="intent-badge intent-badge--right">
            <span className="intent-badge__title">Right hand</span>
            <span className="intent-badge__value">{intentLabel(handIntentRight)}</span>
            <span className="intent-badge__meter" aria-hidden>
              <span style={{ width: `${laneRightStrength}%` }} />
            </span>
          </div>
        </div>
        <div className="table-surface__grid control-canvas table-surface__grid--region-guide table-surface__grid--pads">
          <section
            className={`deck-kit deck-kit--${leftDeck} control-canvas__col control-canvas__col--left${
              laneLeftScrubActive || laneAActive ? " deck-kit--lane-active" : ""
            }`}
            aria-label={leftLabel}
          >
            <div
              ref={leftKitRef}
              className={`deck-column__lane deck-column__lane--scrub${laneLeftScrubActive ? " deck-column__lane--active" : ""}`}
            >
              <DeckPlatter
                deck={leftDeck}
                handActive={!!leftHand}
                scratchRate={leftDeck === "a" ? scratchRateA : scratchRateB}
                progress01={leftDeck === "a" ? deckProgress.a : deckProgress.b}
                loaded={leftDeck === "a" ? deckLoaded.a : deckLoaded.b}
                playing={leftDeck === "a" ? deckPlaying.a : deckPlaying.b}
                onTransportToggle={() => onPadTransportToggle(leftDeck)}
              />
              <span className="spatial-region-hint spatial-region-hint--jog" aria-hidden="true">
                Jog · scrub lane · index finger
              </span>
            </div>
            <div
              ref={mixerFaderARef}
              className={`deck-column__lane deck-column__lane--level${laneAActive ? " deck-column__lane--active" : ""}`}
            >
              <span className="spatial-region-hint spatial-region-hint--fader" aria-hidden="true">
                Level A lane · move left/right
              </span>
              <ChannelLevelReadout channelLabel="A" value={deckAGain} deck="a" readoutHint="channel strip" />
            </div>
          </section>

          <section
            className={`deck-kit deck-kit--${rightDeck} control-canvas__col control-canvas__col--right${
              laneRightScrubActive || laneBActive ? " deck-kit--lane-active" : ""
            }`}
            aria-label={rightLabel}
          >
            <div
              ref={rightKitRef}
              className={`deck-column__lane deck-column__lane--scrub${laneRightScrubActive ? " deck-column__lane--active" : ""}`}
            >
              <DeckPlatter
                deck={rightDeck}
                handActive={!!rightHand}
                scratchRate={rightDeck === "a" ? scratchRateA : scratchRateB}
                progress01={rightDeck === "a" ? deckProgress.a : deckProgress.b}
                loaded={rightDeck === "a" ? deckLoaded.a : deckLoaded.b}
                playing={rightDeck === "a" ? deckPlaying.a : deckPlaying.b}
                onTransportToggle={() => onPadTransportToggle(rightDeck)}
              />
              <span className="spatial-region-hint spatial-region-hint--jog" aria-hidden="true">
                Jog · scrub lane · index finger
              </span>
            </div>
            <div
              ref={mixerFaderBRef}
              className={`deck-column__lane deck-column__lane--level${laneBActive ? " deck-column__lane--active" : ""}`}
            >
              <span className="spatial-region-hint spatial-region-hint--fader" aria-hidden="true">
                Level B lane · move left/right
              </span>
              <ChannelLevelReadout channelLabel="B" value={deckBGain} deck="b" readoutHint="channel strip" />
            </div>
          </section>

          <section
            ref={mixerStripRef}
            className="deck-kit deck-kit--mixer mixer-strip control-canvas__col control-canvas__col--bottom"
            aria-label="Crossfader bottom lane"
          >
            <div className="mixer-strip__channels">
              <div
                ref={mixerCrossfadeRef}
                className={`mixer-strip__crossfade-hit mixer-strip__hit--guided mixer-strip__crossfade-hit--bottom${
                  laneCrossActive ? " mixer-strip__lane-active" : ""
                }`}
              >
                <span className="spatial-region-hint spatial-region-hint--xf" aria-hidden="true">
                  Crossfader lane
                </span>
                <div className="mixer-strip__crossfade-wrap">
                  <MixerFader label="Crossfader" value={crossfader} readoutHint="channel strip" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
