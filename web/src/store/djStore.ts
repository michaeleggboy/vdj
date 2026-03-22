import { create } from "zustand";
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

export type DjState = {
  mapper: MapperState;
  connected: boolean;
  lastError: string | null;
  swapHands: boolean;
  lastFrameRaw: FrameMessage | null;
  setConnected: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setMapper: (m: MapperState) => void;
  setSwapHands: (v: boolean) => void;
  setLastFrameRaw: (f: FrameMessage | null) => void;
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
  setConnected: (v) => set({ connected: v }),
  setError: (msg) => set({ lastError: msg }),
  setMapper: (m) => set({ mapper: m }),
  setSwapHands: (v) => set({ swapHands: v }),
  setLastFrameRaw: (f) => set({ lastFrameRaw: f }),
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
