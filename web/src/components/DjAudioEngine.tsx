import { useCallback, useEffect, useRef, useState } from "react";
import { estimateBpmFromBuffer } from "../audio/estimateBpm";
import { DjMixerEngine } from "../audio/mixerEngine";
import { useDjStore } from "../store/djStore";

const PITCH_STEP = 0.05;
const SCRUB_GUARD_MS_ON_LOAD = 700;
const SCRUB_GUARD_MS_ON_PLAY = 450;

function clampRate(v: number): number {
  return Math.min(3, Math.max(0.2, v));
}

function DeckPeakMeter({ level, deckLabel }: { level: number; deckLabel: string }) {
  const pct = Math.round(Math.min(100, Math.max(0, level * 100)));
  const h = Math.max(0.04, level);
  return (
    <div
      className="top-bar__audio-meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${deckLabel} output level`}
    >
      <div
        className="top-bar__audio-meter__fill"
        style={{ transform: `scaleY(${h})`, transformOrigin: "bottom" }}
      />
    </div>
  );
}

/**
 * Web Audio output: loads two local files, plays through mixer driven by mapper.smooth.
 */
export function DjAudioEngine() {
  const engineRef = useRef<DjMixerEngine | null>(null);
  const [ctxState, setCtxState] = useState<AudioContextState | "none">("none");
  const [playingA, setPlayingA] = useState(false);
  const [playingB, setPlayingB] = useState(false);
  const [meterA, setMeterA] = useState(0);
  const [meterB, setMeterB] = useState(0);
  const [deckAName, setDeckAName] = useState<string | null>(null);
  const [deckBName, setDeckBName] = useState<string | null>(null);
  const [bpmA, setBpmA] = useState<number | null | "pending">(null);
  const [bpmB, setBpmB] = useState<number | null | "pending">(null);
  const [loading, setLoading] = useState<"a" | "b" | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const deckPitchA = useDjStore((s) => s.deckPitchA);
  const deckPitchB = useDjStore((s) => s.deckPitchB);
  const nudgeDeckPitch = useDjStore((s) => s.nudgeDeckPitch);
  const resetDeckPitch = useDjStore((s) => s.resetDeckPitch);
  const setDeckLoaded = useDjStore((s) => s.setDeckLoaded);
  const setDeckPlaying = useDjStore((s) => s.setDeckPlaying);
  const armScrubGuard = useDjStore((s) => s.armScrubGuard);
  const transportToggleRequest = useDjStore((s) => s.transportToggleRequest);
  const deckLoadRequest = useDjStore((s) => s.deckLoadRequest);
  const handledTransportSeqRef = useRef(0);
  const handledLoadSeqRef = useRef(0);

  useEffect(() => {
    const eng = new DjMixerEngine();
    engineRef.current = eng;
    return () => {
      eng.dispose();
      engineRef.current = null;
    };
  }, []);

  const syncCtxState = useCallback(() => {
    const ctx = engineRef.current?.getAudioContext();
    setCtxState(ctx?.state ?? "none");
  }, []);

  const syncTransport = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const a = e.isDeckPlaying("a");
    const b = e.isDeckPlaying("b");
    setPlayingA(a);
    setPlayingB(b);
    setDeckPlaying({ a, b });
  }, [setDeckPlaying]);

  const enableAudio = useCallback(async () => {
    setLoadErr(null);
    try {
      await engineRef.current?.ensureContext();
      syncCtxState();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Audio failed");
    }
  }, [syncCtxState]);

  const loadDeck = useCallback(
    async (deck: "a" | "b", file: File | null) => {
      if (!file) return;
      setLoading(deck);
      setLoadErr(null);
      if (deck === "a") setBpmA("pending");
      else setBpmB("pending");
      try {
        await engineRef.current?.ensureContext();
        const buffer = await engineRef.current!.loadDeck(deck, file);
        if (deck === "a") setDeckAName(file.name);
        else setDeckBName(file.name);
        setDeckLoaded(deck, true);
        resetDeckPitch(deck);
        syncCtxState();
        syncTransport();

        const bpm = estimateBpmFromBuffer(buffer);
        if (deck === "a") setBpmA(bpm);
        else setBpmB(bpm);
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "Decode failed");
        if (deck === "a") setBpmA(null);
        else setBpmB(null);
      } finally {
        setLoading(null);
      }
    },
    [resetDeckPitch, setDeckLoaded, syncCtxState, syncTransport],
  );

  const playDeck = useCallback(
    async (deck: "a" | "b") => {
      setLoadErr(null);
      try {
        await engineRef.current?.ensureContext();
        engineRef.current?.playDeck(deck);
        syncTransport();
        syncCtxState();
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "Play failed");
      }
    },
    [syncCtxState, syncTransport],
  );

  const pauseDeck = useCallback(
    (deck: "a" | "b") => {
      engineRef.current?.pauseDeck(deck);
      syncTransport();
    },
    [syncTransport],
  );

  const stopAll = useCallback(() => {
    engineRef.current?.stopAll();
    syncTransport();
  }, [syncTransport]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const eng = engineRef.current;
      const st = useDjStore.getState();
      const { deckAGain, deckBGain, crossfader, scratchRateA, scratchRateB, scrubVelocityA, scrubVelocityB } = st.mapper.smooth;
      const effectiveA = clampRate(st.deckPitchA * scratchRateA);
      const effectiveB = clampRate(st.deckPitchB * scratchRateB);
        const nowMs = Date.now();
        const guardA = st.scrubGuardUntilMs.a > nowMs;
        const guardB = st.scrubGuardUntilMs.b > nowMs;
      if (eng?.getAudioContext()?.state === "running") {
        eng.setMixerLevels(deckAGain, deckBGain, crossfader);
        eng.setDeckPlaybackRate("a", effectiveA);
        eng.setDeckPlaybackRate("b", effectiveB);
          eng.setDeckScrubInput("a", guardA ? 0 : scrubVelocityA);
          eng.setDeckScrubInput("b", guardB ? 0 : scrubVelocityB);
        eng.tickTransport();
        const { a, b } = eng.getMeterLevels();
        setMeterA(a);
        setMeterB(b);
        useDjStore.getState().setPeakOutputMeter({ a, b });
        const da = eng.getDeckDuration("a");
        const db = eng.getDeckDuration("b");
        const pa = da > 0 ? eng.getDeckPlayhead("a") / da : 0;
        const pb = db > 0 ? eng.getDeckPlayhead("b") / db : 0;
        useDjStore.getState().setDeckProgress({ a: pa, b: pb });
      } else {
        setMeterA(0);
        setMeterB(0);
        useDjStore.getState().setPeakOutputMeter({ a: 0, b: 0 });
        useDjStore.getState().setDeckProgress({ a: 0, b: 0 });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, []);

  const audioIdle = ctxState === "none" || ctxState === "suspended";
  const hasA = deckAName !== null;
  const hasB = deckBName !== null;
  const anyPlaying = playingA || playingB;

  useEffect(() => {
    setDeckLoaded("a", hasA);
    setDeckLoaded("b", hasB);
  }, [hasA, hasB, setDeckLoaded]);

  useEffect(() => {
    if (deckLoadRequest.seq <= handledLoadSeqRef.current) return;
    handledLoadSeqRef.current = deckLoadRequest.seq;
    const reqDeck = deckLoadRequest.deck;
    const reqFile = deckLoadRequest.file;
    if (reqDeck == null || reqFile == null) return;
    armScrubGuard(reqDeck, SCRUB_GUARD_MS_ON_LOAD);
    void loadDeck(reqDeck, reqFile);
  }, [armScrubGuard, deckLoadRequest.seq, deckLoadRequest.deck, deckLoadRequest.file, loadDeck]);

  useEffect(() => {
    if (transportToggleRequest.seq <= handledTransportSeqRef.current) return;
    handledTransportSeqRef.current = transportToggleRequest.seq;
    const deck = transportToggleRequest.deck;
    if (deck == null) return;
    const isPlaying = deck === "a" ? playingA : playingB;
    const hasTrack = deck === "a" ? hasA : hasB;
    if (!hasTrack) {
      setLoadErr(`Load a track on deck ${deck.toUpperCase()} first.`);
      return;
    }
    if (isPlaying) {
      pauseDeck(deck);
      return;
    }
    armScrubGuard(deck, SCRUB_GUARD_MS_ON_PLAY);
    void playDeck(deck);
  }, [armScrubGuard, hasA, hasB, pauseDeck, playDeck, playingA, playingB, transportToggleRequest.seq, transportToggleRequest.deck]);

  const bpmLabel = (v: number | null | "pending") => {
    if (v === "pending") return "…";
    if (v === null) return "—";
    return `${v} BPM`;
  };
  const pitchLabel = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="top-bar__audio" aria-label="Audio output">
      {loadErr ? <span className="top-bar__audio-err">{loadErr}</span> : null}
      <button type="button" className="btn btn--mini" onClick={enableAudio} title="Unlock audio (required by browser)">
        {audioIdle ? "Enable audio" : "Audio on"}
      </button>

      <div className="top-bar__audio-deck">
        <label className="top-bar__audio-file">
          <span className="top-bar__audio-file-label">A</span>
          <input
            type="file"
            accept="audio/*"
            aria-label="Choose audio file for deck A"
            disabled={loading !== null}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void loadDeck("a", f);
              e.target.value = "";
            }}
          />
          <span className="top-bar__audio-file-name" title={deckAName ?? undefined}>
            {loading === "a" ? "…" : deckAName ?? "—"}
          </span>
        </label>
        <span
          className="top-bar__audio-bpm"
          title="Estimated tempo (display only)"
          aria-label={
            bpmA === "pending"
              ? "Deck A tempo, analyzing"
              : typeof bpmA === "number"
                ? `Deck A estimated tempo, ${bpmA} BPM`
                : hasA
                  ? "Deck A tempo, unknown"
                  : "Deck A tempo, no file loaded"
          }
        >
          {bpmLabel(bpmA)}
        </span>
        <DeckPeakMeter level={meterA} deckLabel="Deck A" />
        <div className="top-bar__audio-pitch" role="group" aria-label="Deck A pitch controls">
          <button
            type="button"
            className="btn btn--mini btn--ghost"
            onClick={() => nudgeDeckPitch("a", -PITCH_STEP)}
            aria-label="Slow down deck A playback"
            title="Slow down deck A playback"
          >
            Slower
          </button>
          <span className="top-bar__audio-pitch-readout" aria-live="polite" aria-atomic="true">
            {pitchLabel(deckPitchA)}
          </span>
          <button
            type="button"
            className="btn btn--mini btn--ghost"
            onClick={() => nudgeDeckPitch("a", PITCH_STEP)}
            aria-label="Speed up deck A playback"
            title="Speed up deck A playback"
          >
            Faster
          </button>
          <button
            type="button"
            className="btn btn--mini btn--ghost"
            onClick={() => resetDeckPitch("a")}
            aria-label="Reset deck A pitch to normal speed"
            title="Reset deck A pitch"
          >
            Reset
          </button>
        </div>
        {playingA ? (
          <button type="button" className="btn btn--mini btn--ghost" onClick={() => pauseDeck("a")} title="Pause deck A">
            Pause
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--mini"
            onClick={() => void playDeck("a")}
            disabled={!hasA || loading !== null}
            title="Play deck A"
          >
            Play
          </button>
        )}
      </div>

      <div className="top-bar__audio-deck">
        <label className="top-bar__audio-file">
          <span className="top-bar__audio-file-label">B</span>
          <input
            type="file"
            accept="audio/*"
            aria-label="Choose audio file for deck B"
            disabled={loading !== null}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void loadDeck("b", f);
              e.target.value = "";
            }}
          />
          <span className="top-bar__audio-file-name" title={deckBName ?? undefined}>
            {loading === "b" ? "…" : deckBName ?? "—"}
          </span>
        </label>
        <span
          className="top-bar__audio-bpm"
          title="Estimated tempo (display only)"
          aria-label={
            bpmB === "pending"
              ? "Deck B tempo, analyzing"
              : typeof bpmB === "number"
                ? `Deck B estimated tempo, ${bpmB} BPM`
                : hasB
                  ? "Deck B tempo, unknown"
                  : "Deck B tempo, no file loaded"
          }
        >
          {bpmLabel(bpmB)}
        </span>
        <DeckPeakMeter level={meterB} deckLabel="Deck B" />
        <div className="top-bar__audio-pitch" role="group" aria-label="Deck B pitch controls">
          <button
            type="button"
            className="btn btn--mini btn--ghost"
            onClick={() => nudgeDeckPitch("b", -PITCH_STEP)}
            aria-label="Slow down deck B playback"
            title="Slow down deck B playback"
          >
            Slower
          </button>
          <span className="top-bar__audio-pitch-readout" aria-live="polite" aria-atomic="true">
            {pitchLabel(deckPitchB)}
          </span>
          <button
            type="button"
            className="btn btn--mini btn--ghost"
            onClick={() => nudgeDeckPitch("b", PITCH_STEP)}
            aria-label="Speed up deck B playback"
            title="Speed up deck B playback"
          >
            Faster
          </button>
          <button
            type="button"
            className="btn btn--mini btn--ghost"
            onClick={() => resetDeckPitch("b")}
            aria-label="Reset deck B pitch to normal speed"
            title="Reset deck B pitch"
          >
            Reset
          </button>
        </div>
        {playingB ? (
          <button type="button" className="btn btn--mini btn--ghost" onClick={() => pauseDeck("b")} title="Pause deck B">
            Pause
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--mini"
            onClick={() => void playDeck("b")}
            disabled={!hasB || loading !== null}
            title="Play deck B"
          >
            Play
          </button>
        )}
      </div>

      <button type="button" className="btn btn--mini btn--ghost" onClick={stopAll} disabled={!anyPlaying} title="Pause both decks">
        Stop all
      </button>
    </div>
  );
}
