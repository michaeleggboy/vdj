import { useCallback, useEffect, useRef, useState } from "react";
import { DjMixerEngine } from "../audio/mixerEngine";
import { useDjStore } from "../store/djStore";

/**
 * Web Audio output: loads two local files, plays through mixer driven by mapper.smooth.
 */
export function DjAudioEngine() {
  const engineRef = useRef<DjMixerEngine | null>(null);
  const [ctxState, setCtxState] = useState<AudioContextState | "none">("none");
  const [playing, setPlaying] = useState(false);
  const [deckAName, setDeckAName] = useState<string | null>(null);
  const [deckBName, setDeckBName] = useState<string | null>(null);
  const [loading, setLoading] = useState<"a" | "b" | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

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
      try {
        await engineRef.current?.ensureContext();
        await engineRef.current?.loadDeck(deck, file);
        if (deck === "a") setDeckAName(file.name);
        else setDeckBName(file.name);
        syncCtxState();
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "Decode failed");
      } finally {
        setLoading(null);
      }
    },
    [syncCtxState],
  );

  const play = useCallback(async () => {
    setLoadErr(null);
    try {
      await engineRef.current?.ensureContext();
      engineRef.current?.play();
      setPlaying(engineRef.current?.isPlaying() ?? false);
      syncCtxState();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Play failed");
    }
  }, [syncCtxState]);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setPlaying(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const eng = engineRef.current;
      const { deckAGain, deckBGain, crossfader } = useDjStore.getState().mapper.smooth;
      if (eng?.getAudioContext()?.state === "running") {
        eng.setLevels(deckAGain, deckBGain, crossfader);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, []);

  const audioIdle = ctxState === "none" || ctxState === "suspended";

  return (
    <div className="top-bar__audio" aria-label="Audio output">
      {loadErr ? <span className="top-bar__audio-err">{loadErr}</span> : null}
      <button type="button" className="btn btn--mini" onClick={enableAudio} title="Unlock audio (required by browser)">
        {audioIdle ? "Enable audio" : "Audio on"}
      </button>
      <label className="top-bar__audio-file">
        <span className="top-bar__audio-file-label">Deck A</span>
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
      <label className="top-bar__audio-file">
        <span className="top-bar__audio-file-label">Deck B</span>
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
      <button type="button" className="btn btn--mini" onClick={play} disabled={playing} title="Start playback">
        Play
      </button>
      <button type="button" className="btn btn--mini btn--ghost" onClick={stop} disabled={!playing} title="Stop">
        Stop
      </button>
    </div>
  );
}
