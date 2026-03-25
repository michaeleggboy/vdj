import { create } from "zustand";
import type { DeskLayoutForMapper } from "../lib/deskZones";
import type { FrameMessage } from "../protocol";
import { assignHandsByCameraPosition } from "../lib/frameTransforms";
import {
  applyCalibrationFromFrame,
  clearCrossRange,
  clearGainRanges,
  createMapperState,
  snapCrossfaderMax,
  snapCrossfaderMin,
  snapGainLeftLoud,
  snapGainLeftQuiet,
  snapGainRightLoud,
  snapGainRightQuiet,
  type MapperState,
} from "../lib/gestureMapper";

export type DeskLayoutSnapshot = DeskLayoutForMapper;

export type DjState = {
  mapper: MapperState;
  connected: boolean;
  lastError: string | null;
  swapHands: boolean;
  lastFrameRaw: FrameMessage | null;
  /** When true, deck column under wrist sets gain; mixer zone sets crossfader (with bodily fallback). */
  spatialAssignment: boolean;
  /** Optional spatial level mode: relative grab-and-slide instead of absolute wrist Y mapping. */
  relativeLevelMode: boolean;
  /** Viewport + column rects for spatial hit testing; null until measured. */
  deskLayoutSnapshot: DeskLayoutSnapshot | null;
  /** Post-fader peak meters 0–1 (for desk UI; updated from audio rAF). */
  peakOutputMeter: { a: number; b: number };
  /** Transport progress 0..1 per deck (for platter indicators). */
  deckProgress: { a: number; b: number };
  /** Manual per-deck pitch multipliers (combined with gesture scratch each audio frame). */
  deckPitchA: number;
  deckPitchB: number;
  /** Whether each deck currently has a loaded track. */
  deckLoaded: { a: boolean; b: boolean };
  /** Whether each deck is actively playing. */
  deckPlaying: { a: boolean; b: boolean };
  /** Fire-and-forget transport request from UI surface to audio engine. */
  transportToggleRequest: { deck: "a" | "b" | null; seq: number };
  /** Fire-and-forget deck load request from UI surface to audio engine. */
  deckLoadRequest: { deck: "a" | "b" | null; file: File | null; seq: number };
  /** Until this timestamp, scrub input for each deck is temporarily muted. */
  scrubGuardUntilMs: { a: number; b: number };
  setConnected: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setMapper: (m: MapperState) => void;
  setSwapHands: (v: boolean) => void;
  setLastFrameRaw: (f: FrameMessage | null) => void;
  setSpatialAssignment: (v: boolean) => void;
  setRelativeLevelMode: (v: boolean) => void;
  setDeskLayoutSnapshot: (s: DeskLayoutSnapshot | null) => void;
  setPeakOutputMeter: (m: { a: number; b: number }) => void;
  setDeckProgress: (m: { a: number; b: number }) => void;
  setDeckLoaded: (deck: "a" | "b", loaded: boolean) => void;
  setDeckPlaying: (m: { a: boolean; b: boolean }) => void;
  requestTransportToggle: (deck: "a" | "b") => void;
  /** Fire one transport toggle per deck on staggered ticks (fist gestures on both decks same frame). */
  requestTransportToggles: (decks: ("a" | "b")[]) => void;
  requestDeckLoad: (deck: "a" | "b", file: File) => void;
  armScrubGuard: (deck: "a" | "b", ms: number) => void;
  nudgeDeckPitch: (deck: "a" | "b", delta: number) => void;
  resetDeckPitch: (deck: "a" | "b") => void;
  calibrate: () => void;
  resetMapper: () => void;
  snapCrossLeft: () => void;
  snapCrossRight: () => void;
  clearCrossTwoPoint: () => void;
  snapDeckAQuiet: () => void;
  snapDeckALoud: () => void;
  snapDeckBQuiet: () => void;
  snapDeckBLoud: () => void;
  clearGainTwoPoint: () => void;
};

function assignedFrame(get: () => DjState): FrameMessage | null {
  const raw = get().lastFrameRaw;
  if (!raw) return null;
  return assignHandsByCameraPosition(raw, get().swapHands);
}

export const useDjStore = create<DjState>((set, get) => ({
  mapper: createMapperState(),
  connected: false,
  lastError: null,
  swapHands: false,
  lastFrameRaw: null,
  spatialAssignment: true,
  relativeLevelMode: true,
  deskLayoutSnapshot: null,
  peakOutputMeter: { a: 0, b: 0 },
  deckProgress: { a: 0, b: 0 },
  deckPitchA: 1,
  deckPitchB: 1,
  deckLoaded: { a: false, b: false },
  deckPlaying: { a: false, b: false },
  transportToggleRequest: { deck: null, seq: 0 },
  deckLoadRequest: { deck: null, file: null, seq: 0 },
  scrubGuardUntilMs: { a: 0, b: 0 },
  setConnected: (v) => set({ connected: v }),
  setError: (msg) => set({ lastError: msg }),
  setMapper: (m) => set({ mapper: m }),
  setSwapHands: (v) => set({ swapHands: v }),
  setLastFrameRaw: (f) => set({ lastFrameRaw: f }),
  setSpatialAssignment: () => set({ spatialAssignment: true }),
  setRelativeLevelMode: () => set({ relativeLevelMode: true }),
  setDeskLayoutSnapshot: (s) => set({ deskLayoutSnapshot: s }),
  setPeakOutputMeter: (m) => set({ peakOutputMeter: m }),
  setDeckProgress: (m) => set({ deckProgress: m }),
  setDeckLoaded: (deck, loaded) =>
    set((s) => ({ deckLoaded: deck === "a" ? { ...s.deckLoaded, a: loaded } : { ...s.deckLoaded, b: loaded } })),
  setDeckPlaying: (m) => set({ deckPlaying: m }),
  requestTransportToggle: (deck) =>
    set((s) => ({ transportToggleRequest: { deck, seq: s.transportToggleRequest.seq + 1 } })),
  requestTransportToggles: (decks) => {
    decks.forEach((deck, i) => {
      window.setTimeout(() => {
        get().requestTransportToggle(deck);
      }, i * 24);
    });
  },
  requestDeckLoad: (deck, file) =>
    set((s) => ({ deckLoadRequest: { deck, file, seq: s.deckLoadRequest.seq + 1 } })),
  armScrubGuard: (deck, ms) =>
    set((s) => {
      const until = Date.now() + Math.max(0, ms);
      return deck === "a"
        ? { scrubGuardUntilMs: { ...s.scrubGuardUntilMs, a: until } }
        : { scrubGuardUntilMs: { ...s.scrubGuardUntilMs, b: until } };
    }),
  nudgeDeckPitch: (deck, delta) =>
    set((s) => {
      const next = Math.min(3, Math.max(0.2, (deck === "a" ? s.deckPitchA : s.deckPitchB) + delta));
      return deck === "a" ? { deckPitchA: next } : { deckPitchB: next };
    }),
  resetDeckPitch: (deck) => set(deck === "a" ? { deckPitchA: 1 } : { deckPitchB: 1 }),
  calibrate: () => {
    const frame = assignedFrame(get);
    if (!frame) return;
    set({ mapper: applyCalibrationFromFrame(get().mapper, frame) });
  },
  resetMapper: () => set({ mapper: createMapperState() }),
  snapCrossLeft: () => {
    const frame = assignedFrame(get);
    if (!frame) return;
    set({ mapper: snapCrossfaderMin(get().mapper, frame) });
  },
  snapCrossRight: () => {
    const frame = assignedFrame(get);
    if (!frame) return;
    set({ mapper: snapCrossfaderMax(get().mapper, frame) });
  },
  clearCrossTwoPoint: () => set({ mapper: clearCrossRange(get().mapper) }),
  snapDeckAQuiet: () => {
    const frame = assignedFrame(get);
    if (!frame) return;
    set({ mapper: snapGainLeftQuiet(get().mapper, frame) });
  },
  snapDeckALoud: () => {
    const frame = assignedFrame(get);
    if (!frame) return;
    set({ mapper: snapGainLeftLoud(get().mapper, frame) });
  },
  snapDeckBQuiet: () => {
    const frame = assignedFrame(get);
    if (!frame) return;
    set({ mapper: snapGainRightQuiet(get().mapper, frame) });
  },
  snapDeckBLoud: () => {
    const frame = assignedFrame(get);
    if (!frame) return;
    set({ mapper: snapGainRightLoud(get().mapper, frame) });
  },
  clearGainTwoPoint: () => set({ mapper: clearGainRanges(get().mapper) }),
}));
