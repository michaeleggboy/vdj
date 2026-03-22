import type { FrameMessage, HandPayload } from "../protocol";

const WRIST = 0;
const EMA_ALPHA = 0.48;
const INPUT_MARGIN = 0.07;
const EPS = 1e-5;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function expand01(t: number): number {
  const lo = INPUT_MARGIN;
  const hi = 1 - INPUT_MARGIN;
  return clamp01((t - lo) / (hi - lo));
}

export type MapperState = {
  smooth: { crossfader: number; deckAGain: number; deckBGain: number };
  calLeft: { x: number; y: number } | null;
  calRight: { y: number } | null;
  lastRaw: { lx?: number; ly?: number; rx?: number; ry?: number };
  /** Two-point crossfader: horizontal control at left vs right of travel (normalized 0–1). */
  crossRange: { min: number; max: number } | null;
  /** Two-point Deck A level: wrist y at quiet vs loud poses (same y axis as tracking). */
  gainLeftRange: { quiet: number; loud: number } | null;
  /** Two-point Deck B level */
  gainRightRange: { quiet: number; loud: number } | null;
};

export function createMapperState(): MapperState {
  return {
    smooth: { crossfader: 0.5, deckAGain: 0.5, deckBGain: 0.5 },
    calLeft: null,
    calRight: null,
    lastRaw: {},
    crossRange: null,
    gainLeftRange: null,
    gainRightRange: null,
  };
}

function wrist(h: HandPayload | undefined): [number, number] | null {
  if (!h?.landmarks?.[WRIST]) return null;
  const [x, y] = h.landmarks[WRIST];
  return [x, y];
}

/**
 * Horizontal value for crossfader: with two hands, average of both wrists' x (more tabletop-like).
 * With one hand, uses that hand's x.
 */
export function computeCrossfaderControlX(frame: FrameMessage): number | undefined {
  let left: HandPayload | undefined;
  let right: HandPayload | undefined;
  for (const h of frame.hands) {
    if (h.side === "left") left = h;
    if (h.side === "right") right = h;
  }
  const wl = wrist(left);
  const wr = wrist(right);
  if (frame.hands.length >= 2 && wl && wr) {
    return (wl[0] + wr[0]) / 2;
  }
  if (wl) return wl[0];
  return undefined;
}

function mapCrossfader(rawX: number, prev: MapperState): number {
  const r = prev.crossRange;
  if (r && Math.abs(r.max - r.min) > EPS) {
    const lo = Math.min(r.min, r.max);
    const hi = Math.max(r.min, r.max);
    return clamp01((rawX - lo) / (hi - lo));
  }
  const xCal = rawX + (prev.calLeft?.x ?? 0);
  return clamp01(expand01(xCal));
}

/** Map wrist y from quiet pose → loud pose into 0–1 gain. */
function mapGainFromTwoPoint(ly: number, range: { quiet: number; loud: number } | null): number | undefined {
  if (!range) return undefined;
  const { quiet, loud } = range;
  const d = loud - quiet;
  if (Math.abs(d) < EPS) return undefined;
  return clamp01((ly - quiet) / d);
}

function mapGainFallback(yCal: number): number {
  return clamp01(1 - expand01(yCal));
}

/**
 * Map latest frame to DJ controls with calibration, optional two-point ranges, and dual-hand crossfader.
 */
export function mapFrame(
  frame: FrameMessage,
  prev: MapperState,
  alpha: number = EMA_ALPHA,
): MapperState {
  let left: HandPayload | undefined;
  let right: HandPayload | undefined;
  for (const h of frame.hands) {
    if (h.side === "left") left = h;
    if (h.side === "right") right = h;
  }

  const wl = wrist(left);
  const wr = wrist(right);

  let lx = wl ? wl[0] : undefined;
  let ly = wl ? wl[1] : undefined;
  let rx = wr ? wr[0] : undefined;
  let ry = wr ? wr[1] : undefined;

  let cross = prev.smooth.crossfader;
  let gA = prev.smooth.deckAGain;
  let gB = prev.smooth.deckBGain;

  const single = frame.hands.length === 1;
  const lone = single ? frame.hands[0] : undefined;
  const loneW = lone ? wrist(lone) : null;

  if (single && loneW && lone) {
    lx = loneW[0];
    ly = loneW[1];
    rx = undefined;

    const rawX = lx;
    cross = mapCrossfader(rawX, prev);

    const gFromTwo = mapGainFromTwoPoint(ly, prev.gainLeftRange);
    if (lone.side === "left") {
      gA = gFromTwo !== undefined ? gFromTwo : mapGainFallback(ly + (prev.calLeft?.y ?? 0));
    } else {
      const g2 = mapGainFromTwoPoint(ly, prev.gainRightRange);
      gB = g2 !== undefined ? g2 : mapGainFallback(ly + (prev.calRight?.y ?? prev.calLeft?.y ?? 0));
    }
  } else {
    const rawX = computeCrossfaderControlX(frame);
    if (rawX !== undefined) {
      cross = mapCrossfader(rawX, prev);
    }

    if (ly !== undefined) {
      const gFromTwo = mapGainFromTwoPoint(ly, prev.gainLeftRange);
      gA = gFromTwo !== undefined ? gFromTwo : mapGainFallback(ly + (prev.calLeft?.y ?? 0));
    }
    if (ry !== undefined) {
      const gFromTwo = mapGainFromTwoPoint(ry, prev.gainRightRange);
      gB = gFromTwo !== undefined ? gFromTwo : mapGainFallback(ry + (prev.calRight?.y ?? 0));
    }
  }

  const lastRaw = { lx, ly, rx, ry };

  const s = prev.smooth;
  const smooth = {
    crossfader: alpha * cross + (1 - alpha) * s.crossfader,
    deckAGain: alpha * gA + (1 - alpha) * s.deckAGain,
    deckBGain: alpha * gB + (1 - alpha) * s.deckBGain,
  };

  return {
    ...prev,
    smooth,
    lastRaw,
  };
}

export function applyCalibrationFromFrame(prev: MapperState, frame: FrameMessage): MapperState {
  const { lx, ly, ry } = prev.lastRaw;
  if (lx === undefined || ly === undefined) return prev;

  const calLeft: NonNullable<MapperState["calLeft"]> = { x: 0.5 - lx, y: 0.5 - ly };

  let calRight = prev.calRight;
  if (frame.hands.length >= 2 && ry !== undefined) {
    calRight = { y: 0.5 - ry };
  } else if (frame.hands.length === 1 && frame.hands[0]?.side === "right") {
    calRight = { y: 0.5 - ly };
  }

  return { ...prev, calLeft, calRight };
}

/** Snap current crossfader control position as the “left” end of two-point range. */
export function snapCrossfaderMin(prev: MapperState, frame: FrameMessage): MapperState {
  const x = computeCrossfaderControlX(frame);
  if (x === undefined) return prev;
  const r = prev.crossRange;
  return { ...prev, crossRange: { min: x, max: r?.max ?? x } };
}

/** Snap current crossfader control position as the “right” end of two-point range. */
export function snapCrossfaderMax(prev: MapperState, frame: FrameMessage): MapperState {
  const x = computeCrossfaderControlX(frame);
  if (x === undefined) return prev;
  const r = prev.crossRange;
  return { ...prev, crossRange: { min: r?.min ?? x, max: x } };
}

export function clearCrossRange(prev: MapperState): MapperState {
  return { ...prev, crossRange: null };
}

export function snapGainLeftQuiet(prev: MapperState, frame: FrameMessage): MapperState {
  const ly = wrist(frame.hands.find((h) => h.side === "left"))?.[1];
  if (ly === undefined) return prev;
  const r = prev.gainLeftRange;
  return { ...prev, gainLeftRange: { quiet: ly, loud: r?.loud ?? ly } };
}

export function snapGainLeftLoud(prev: MapperState, frame: FrameMessage): MapperState {
  const ly = wrist(frame.hands.find((h) => h.side === "left"))?.[1];
  if (ly === undefined) return prev;
  const r = prev.gainLeftRange;
  return { ...prev, gainLeftRange: { quiet: r?.quiet ?? ly, loud: ly } };
}

export function snapGainRightQuiet(prev: MapperState, frame: FrameMessage): MapperState {
  const ry = wrist(frame.hands.find((h) => h.side === "right"))?.[1];
  if (ry === undefined) return prev;
  const r = prev.gainRightRange;
  return { ...prev, gainRightRange: { quiet: ry, loud: r?.loud ?? ry } };
}

export function snapGainRightLoud(prev: MapperState, frame: FrameMessage): MapperState {
  const ry = wrist(frame.hands.find((h) => h.side === "right"))?.[1];
  if (ry === undefined) return prev;
  const r = prev.gainRightRange;
  return { ...prev, gainRightRange: { quiet: r?.quiet ?? ry, loud: ry } };
}

export function clearGainRanges(prev: MapperState): MapperState {
  return { ...prev, gainLeftRange: null, gainRightRange: null };
}
