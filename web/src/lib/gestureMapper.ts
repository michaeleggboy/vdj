import type { DeskLayoutForMapper, SpatialDeskZone } from "./deskZones";
import { hitSpatialDeskZoneWithHysteresis, isDeskLayoutComplete, laneForSpatialZone, normalizedImageToViewport } from "./deskZones";
import type { FrameMessage, HandPayload } from "../protocol";

const WRIST = 0;
const INDEX_TIP = 8;
/** EMA blend toward new control targets each frame (exported for {@link mapFrame} call sites). */
export const EMA_ALPHA = 0.48;
const SCRATCH_ALPHA = 0.44;
/** Combined drive: vertical dominates (platter swipe); horizontal still nudges. */
const SCRATCH_WY = 1;
const SCRATCH_WX = 0.32;
/** Normalized wrist delta per frame below this → treat as idle (rate → 1). */
const SCRATCH_DRIVE_DEAD = 3.5e-4;
const SCRATCH_SENS = 46;
const SCRUB_FINGER_ALPHA = 0.58;
const INPUT_MARGIN = 0.07;
const EPS = 1e-5;

/**
 * Fallback vertical gain: normalized wrist y (0=top), after Neutral `yCal` is ~0.5 at the calibrated pose.
 * Upper half stays linear (1 → 0.5) so Neutral still feels like “mid”; lower half uses a power curve and a
 * closer silent threshold so ~0 gain is reachable with less wrist travel toward the bottom edge.
 */
const GAIN_Y_FULL = 0.28;
/** After calibration, `yCal` ≥ this ≈ deck off (was 0.72—required too much travel below Neutral). */
const GAIN_Y_SILENT = 0.61;
/** Matches `applyCalibrationFromFrame` centering: wrist at Neutral → yCal ≈ 0.5 → ~0.5 gain (upper segment). */
const GAIN_Y_NEUTRAL = 0.5;
/** >1: from Neutral down, gain falls faster than linear—easier to mute in-frame. */
const GAIN_FALLBACK_SILENCE_CURVE = 1.3;
/** Two-point deck range: slightly more resolution near quiet (does not assume Neutral mid). */
const GAIN_TWO_POINT_CURVE = 1.18;
const LEVEL_DWELL_FRAMES = 4;
const LEVEL_SLEW_MAX = 0.05;
const LEVEL_RELATIVE_SCALE = 1.7;
const CROSS_CENTER_SNAP = 0.04;
const CROSS_RELATIVE_SCALE = 3.2;
const CROSS_SLEW_MAX = 0.2;

export type HandIntent = "idle" | "crossfader" | "levelA" | "levelB" | "scrubA" | "scrubB";

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function expand01(t: number): number {
  const lo = INPUT_MARGIN;
  const hi = 1 - INPUT_MARGIN;
  return clamp01((t - lo) / (hi - lo));
}

export type MapperState = {
  smooth: {
    crossfader: number;
    deckAGain: number;
    deckBGain: number;
    /** Playback rate: ~0.2–3 forward, negative for reverse scratch when supported; 1 = normal. */
    scratchRateA: number;
    scratchRateB: number;
    /** Signed scrub control (-1..1) for transport playhead movement. */
    scrubVelocityA: number;
    scrubVelocityB: number;
    handIntentLeft: HandIntent;
    handIntentRight: HandIntent;
    handStrengthLeft: number;
    handStrengthRight: number;
  };
  calLeft: { x: number; y: number } | null;
  calRight: { y: number } | null;
  lastRaw: { lx?: number; ly?: number; rx?: number; ry?: number };
  /** Two-point crossfader: horizontal control at left vs right of travel (normalized 0–1). */
  crossRange: { min: number; max: number } | null;
  /** Two-point Deck A level: wrist y at quiet vs loud poses (same y axis as tracking). */
  gainLeftRange: { quiet: number; loud: number } | null;
  /** Two-point Deck B level */
  gainRightRange: { quiet: number; loud: number } | null;
  /** Spatial deck-like mode: last zone per tracked hand (for hysteresis). */
  spatialZoneByHand: Record<string, SpatialDeskZone | null>;
  /** Previous normalized wrist [x,y] per hand label (scratch delta). */
  prevWristByHand: Record<string, [number, number]>;
  /** Previous normalized index fingertip [x,y] per hand label (fine scrub delta). */
  prevFingerByHand: Record<string, [number, number]>;
  /** Relative level dwell lock frame counters by tracked hand label. */
  levelDwellByHand: Record<string, number>;
};

export function createMapperState(): MapperState {
  return {
    smooth: {
      crossfader: 0.5,
      deckAGain: 0.5,
      deckBGain: 0.5,
      scratchRateA: 1,
      scratchRateB: 1,
      scrubVelocityA: 0,
      scrubVelocityB: 0,
      handIntentLeft: "idle",
      handIntentRight: "idle",
      handStrengthLeft: 0,
      handStrengthRight: 0,
    },
    calLeft: null,
    calRight: null,
    lastRaw: {},
    crossRange: null,
    gainLeftRange: null,
    gainRightRange: null,
    spatialZoneByHand: {},
    prevWristByHand: {},
    prevFingerByHand: {},
    levelDwellByHand: {},
  };
}

function wrist(h: HandPayload | undefined): [number, number] | null {
  if (!h?.landmarks?.[WRIST]) return null;
  const [x, y] = h.landmarks[WRIST];
  return [x, y];
}

function indexTip(h: HandPayload | undefined): [number, number] | null {
  if (!h?.landmarks?.[INDEX_TIP]) return null;
  const [x, y] = h.landmarks[INDEX_TIP];
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
    const v = clamp01((rawX - lo) / (hi - lo));
    return Math.abs(v - 0.5) <= CROSS_CENTER_SNAP ? 0.5 : v;
  }
  const xCal = rawX + (prev.calLeft?.x ?? 0);
  const v = clamp01(expand01(xCal));
  return Math.abs(v - 0.5) <= CROSS_CENTER_SNAP ? 0.5 : v;
}

/** Map wrist y from quiet pose → loud pose into 0–1 gain. */
function mapGainFromTwoPoint(ly: number, range: { quiet: number; loud: number } | null): number | undefined {
  if (!range) return undefined;
  const { quiet, loud } = range;
  const d = loud - quiet;
  if (Math.abs(d) < EPS) return undefined;
  const u = clamp01((ly - quiet) / d);
  return clamp01(Math.pow(u, GAIN_TWO_POINT_CURVE));
}

function mapGainFallback(yCal: number): number {
  if (yCal <= GAIN_Y_FULL) return 1;
  if (yCal >= GAIN_Y_SILENT) return 0;

  if (yCal <= GAIN_Y_NEUTRAL) {
    const span = GAIN_Y_NEUTRAL - GAIN_Y_FULL;
    return 1 - 0.5 * clamp01((yCal - GAIN_Y_FULL) / span);
  }

  const span = GAIN_Y_SILENT - GAIN_Y_NEUTRAL;
  const t = clamp01((yCal - GAIN_Y_NEUTRAL) / span);
  return 0.5 * clamp01(Math.pow(1 - t, GAIN_FALLBACK_SILENCE_CURVE));
}

function scratchDrive(dx: number, dy: number): number {
  return SCRATCH_WY * (-dy) + SCRATCH_WX * dx;
}

function scratchRateFromDrive(drive: number): number {
  if (Math.abs(drive) < SCRATCH_DRIVE_DEAD) return 1;
  const v = 1 + SCRATCH_SENS * drive;
  if (v >= 0.2) return Math.min(3, v);
  if (v <= -0.25) return Math.max(-2, v);
  return 1;
}

function scrubVelocityFromDrive(drive: number): number {
  if (Math.abs(drive) < SCRATCH_DRIVE_DEAD) return 0;
  return Math.max(-1, Math.min(1, drive * 11.5));
}

function smoothScratch(prevRate: number, raw: number, alpha: number): number {
  return alpha * raw + (1 - alpha) * prevRate;
}

function updateScratchDeltas(
  zone: SpatialDeskZone | null,
  layout: DeskLayoutForMapper,
  dx: number,
  dy: number,
  bestDriveA: { v: number },
  bestDriveB: { v: number },
  sawA: { v: boolean },
  sawB: { v: boolean },
): void {
  const d = scratchDrive(dx, dy);
  if (zone === "leftDeck") {
    const deck = layout.leftColumnDeck;
    if (deck === "a") {
      sawA.v = true;
      if (Math.abs(d) >= Math.abs(bestDriveA.v)) bestDriveA.v = d;
    } else {
      sawB.v = true;
      if (Math.abs(d) >= Math.abs(bestDriveB.v)) bestDriveB.v = d;
    }
  } else if (zone === "rightDeck") {
    const deck = layout.rightColumnDeck;
    if (deck === "a") {
      sawA.v = true;
      if (Math.abs(d) >= Math.abs(bestDriveA.v)) bestDriveA.v = d;
    } else {
      sawB.v = true;
      if (Math.abs(d) >= Math.abs(bestDriveB.v)) bestDriveB.v = d;
    }
  }
}

function mapFrameSpatial(
  frame: FrameMessage,
  prev: MapperState,
  alpha: number,
  layout: DeskLayoutForMapper,
): MapperState {
  const iw = frame.img_width > 0 ? frame.img_width : 16;
  const ih = frame.img_height > 0 ? frame.img_height : 9;

  const crossDelta: number[] = [];
  const levelDeltaA: number[] = [];
  const levelDeltaB: number[] = [];
  const nextZones: Record<string, SpatialDeskZone | null> = {};
  const nextPrevWrist: Record<string, [number, number]> = { ...prev.prevWristByHand };
  const nextPrevFinger: Record<string, [number, number]> = { ...prev.prevFingerByHand };
  const nextDwell: Record<string, number> = { ...prev.levelDwellByHand };
  const intentBySide: { left: HandIntent; right: HandIntent } = { left: "idle", right: "idle" };
  const intentStrength: { left: number; right: number } = { left: 0, right: 0 };

  const bestDriveA = { v: 0 };
  const bestDriveB = { v: 0 };
  const sawScratchA = { v: false };
  const sawScratchB = { v: false };

  for (const h of frame.hands) {
    const w = wrist(h);
    if (!w) continue;
    const [nx, ny] = w;
    const { x, y } = normalizedImageToViewport(nx, ny, layout, iw, ih);
    const prevZ = prev.spatialZoneByHand[h.label] ?? null;
    const zone = hitSpatialDeskZoneWithHysteresis(x, y, layout, prevZ, 14);
    nextZones[h.label] = zone;

    const pw = prev.prevWristByHand[h.label] ?? [nx, ny];
    const dx = nx - pw[0];
    nextPrevWrist[h.label] = [nx, ny];
    const f = indexTip(h) ?? w;
    const [fx, fy] = f;
    const pf = prev.prevFingerByHand[h.label] ?? [fx, fy];
    const fdx = (fx - pf[0]) * SCRUB_FINGER_ALPHA;
    const fdy = (fy - pf[1]) * SCRUB_FINGER_ALPHA;
    nextPrevFinger[h.label] = [fx, fy];

    const lane = zone ? laneForSpatialZone(zone, layout) : null;

    if (lane === "crossfader") {
      crossDelta.push(dx);
      intentBySide[h.side] = "crossfader";
      intentStrength[h.side] = Math.max(intentStrength[h.side], Math.min(1, Math.abs(dx) * 42));
    } else if (lane === "levelA") {
      nextDwell[h.label] = (nextDwell[h.label] ?? 0) + 1;
      if ((nextDwell[h.label] ?? 0) >= LEVEL_DWELL_FRAMES) {
        levelDeltaA.push(dx * LEVEL_RELATIVE_SCALE);
        intentBySide[h.side] = "levelA";
        intentStrength[h.side] = Math.max(intentStrength[h.side], Math.min(1, Math.abs(dx) * 26));
      } else {
        intentBySide[h.side] = "levelA";
      }
    } else if (lane === "levelB") {
      nextDwell[h.label] = (nextDwell[h.label] ?? 0) + 1;
      if ((nextDwell[h.label] ?? 0) >= LEVEL_DWELL_FRAMES) {
        levelDeltaB.push(dx * LEVEL_RELATIVE_SCALE);
        intentBySide[h.side] = "levelB";
        intentStrength[h.side] = Math.max(intentStrength[h.side], Math.min(1, Math.abs(dx) * 26));
      } else {
        intentBySide[h.side] = "levelB";
      }
    } else if (zone != null) {
      updateScratchDeltas(zone, layout, fdx, fdy, bestDriveA, bestDriveB, sawScratchA, sawScratchB);
      intentBySide[h.side] = lane === "scrubA" ? "scrubA" : "scrubB";
      intentStrength[h.side] = Math.max(intentStrength[h.side], Math.min(1, Math.abs(scratchDrive(fdx, fdy)) * 12));
      nextDwell[h.label] = 0;
    } else {
      nextDwell[h.label] = 0;
    }
  }

  let cross = prev.smooth.crossfader;
  if (crossDelta.length > 0) {
    const delta = crossDelta.reduce((a, b) => a + b, 0) / crossDelta.length;
    const applied = Math.max(-CROSS_SLEW_MAX, Math.min(CROSS_SLEW_MAX, delta * CROSS_RELATIVE_SCALE));
    const next = clamp01(prev.smooth.crossfader + applied);
    cross = Math.abs(next - 0.5) <= CROSS_CENTER_SNAP ? 0.5 : next;
  } else {
    const hasLaneOwner = Object.values(nextZones).some((z) => z !== null);
    const fallbackX = hasLaneOwner ? undefined : computeCrossfaderControlX(frame);
    if (fallbackX !== undefined) cross = mapCrossfader(fallbackX, prev);
  }

  const gA =
    levelDeltaA.length > 0
      ? clamp01(
          prev.smooth.deckAGain +
            Math.max(-LEVEL_SLEW_MAX, Math.min(LEVEL_SLEW_MAX, levelDeltaA.reduce((a, b) => a + b, 0) / levelDeltaA.length)),
        )
      : prev.smooth.deckAGain;
  const gB =
    levelDeltaB.length > 0
      ? clamp01(
          prev.smooth.deckBGain +
            Math.max(-LEVEL_SLEW_MAX, Math.min(LEVEL_SLEW_MAX, levelDeltaB.reduce((a, b) => a + b, 0) / levelDeltaB.length)),
        )
      : prev.smooth.deckBGain;

  const rawScratchA = sawScratchA.v ? scratchRateFromDrive(bestDriveA.v) : 1;
  const rawScratchB = sawScratchB.v ? scratchRateFromDrive(bestDriveB.v) : 1;
  const rawScrubVelA = sawScratchA.v ? scrubVelocityFromDrive(bestDriveA.v) : 0;
  const rawScrubVelB = sawScratchB.v ? scrubVelocityFromDrive(bestDriveB.v) : 0;

  const s = prev.smooth;
  const smooth = {
    crossfader: alpha * cross + (1 - alpha) * s.crossfader,
    deckAGain: alpha * gA + (1 - alpha) * s.deckAGain,
    deckBGain: alpha * gB + (1 - alpha) * s.deckBGain,
    scratchRateA: smoothScratch(s.scratchRateA, rawScratchA, SCRATCH_ALPHA),
    scratchRateB: smoothScratch(s.scratchRateB, rawScratchB, SCRATCH_ALPHA),
    scrubVelocityA: smoothScratch(s.scrubVelocityA, rawScrubVelA, SCRATCH_ALPHA),
    scrubVelocityB: smoothScratch(s.scrubVelocityB, rawScrubVelB, SCRATCH_ALPHA),
    handIntentLeft: intentBySide.left,
    handIntentRight: intentBySide.right,
    handStrengthLeft: smoothScratch(s.handStrengthLeft, intentStrength.left, SCRATCH_ALPHA),
    handStrengthRight: smoothScratch(s.handStrengthRight, intentStrength.right, SCRATCH_ALPHA),
  };

  let left: HandPayload | undefined;
  let right: HandPayload | undefined;
  for (const h of frame.hands) {
    if (h.side === "left") left = h;
    if (h.side === "right") right = h;
  }
  const wl = wrist(left);
  const wr = wrist(right);

  return {
    ...prev,
    smooth,
    lastRaw: {
      lx: wl?.[0],
      ly: wl?.[1],
      rx: wr?.[0],
      ry: wr?.[1],
    },
    spatialZoneByHand: nextZones,
    prevWristByHand: nextPrevWrist,
    prevFingerByHand: nextPrevFinger,
    levelDwellByHand: nextDwell,
  };
}

function mapFrameBodily(frame: FrameMessage, prev: MapperState, alpha: number): MapperState {
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

  const nextPrevWrist: Record<string, [number, number]> = { ...prev.prevWristByHand };
  const nextPrevFinger: Record<string, [number, number]> = { ...prev.prevFingerByHand };
  let rawScratchA = 1;
  let rawScratchB = 1;
  let rawScrubVelA = 0;
  let rawScrubVelB = 0;
  let sawLeft = false;
  let sawRight = false;
  let intentLeft: HandIntent = "idle";
  let intentRight: HandIntent = "idle";
  let strengthLeft = 0;
  let strengthRight = 0;

  for (const h of frame.hands) {
    const w = wrist(h);
    if (!w) continue;
    const [nx, ny] = w;
    const pw = prev.prevWristByHand[h.label] ?? [nx, ny];
    const dx = nx - pw[0];
    const dy = ny - pw[1];
    nextPrevWrist[h.label] = [nx, ny];
    const f = indexTip(h) ?? w;
    nextPrevFinger[h.label] = [f[0], f[1]];
    if (h.side === "left") {
      sawLeft = true;
      const d = scratchDrive(dx, dy);
      rawScratchA = scratchRateFromDrive(d);
      rawScrubVelA = scrubVelocityFromDrive(d);
      intentLeft = "scrubA";
      strengthLeft = Math.max(strengthLeft, Math.min(1, Math.abs(d) * 12));
    }
    if (h.side === "right") {
      sawRight = true;
      const d = scratchDrive(dx, dy);
      rawScratchB = scratchRateFromDrive(d);
      rawScrubVelB = scrubVelocityFromDrive(d);
      intentRight = "scrubB";
      strengthRight = Math.max(strengthRight, Math.min(1, Math.abs(d) * 12));
    }
  }

  if (!sawLeft) rawScratchA = 1;
  if (!sawRight) rawScratchB = 1;
  if (!sawLeft) rawScrubVelA = 0;
  if (!sawRight) rawScrubVelB = 0;
  if (!sawLeft) intentLeft = "idle";
  if (!sawRight) intentRight = "idle";

  if (lx !== undefined || rx !== undefined) {
    const crossMotion = Math.abs((lx ?? 0) - (prev.lastRaw.lx ?? lx ?? 0)) + Math.abs((rx ?? 0) - (prev.lastRaw.rx ?? rx ?? 0));
    if (crossMotion > 0.008) {
      if (intentLeft === "idle") intentLeft = "crossfader";
      if (intentRight === "idle") intentRight = "crossfader";
      strengthLeft = Math.max(strengthLeft, Math.min(1, crossMotion * 18));
      strengthRight = Math.max(strengthRight, Math.min(1, crossMotion * 18));
    }
  }

  if (ly !== undefined && intentLeft === "idle") intentLeft = "levelA";
  if (ry !== undefined && intentRight === "idle") intentRight = "levelB";

  const s = prev.smooth;
  const smooth = {
    crossfader: alpha * cross + (1 - alpha) * s.crossfader,
    deckAGain: alpha * gA + (1 - alpha) * s.deckAGain,
    deckBGain: alpha * gB + (1 - alpha) * s.deckBGain,
    scratchRateA: smoothScratch(s.scratchRateA, rawScratchA, SCRATCH_ALPHA),
    scratchRateB: smoothScratch(s.scratchRateB, rawScratchB, SCRATCH_ALPHA),
    scrubVelocityA: smoothScratch(s.scrubVelocityA, rawScrubVelA, SCRATCH_ALPHA),
    scrubVelocityB: smoothScratch(s.scrubVelocityB, rawScrubVelB, SCRATCH_ALPHA),
    handIntentLeft: intentLeft,
    handIntentRight: intentRight,
    handStrengthLeft: smoothScratch(s.handStrengthLeft, strengthLeft, SCRATCH_ALPHA),
    handStrengthRight: smoothScratch(s.handStrengthRight, strengthRight, SCRATCH_ALPHA),
  };

  return {
    ...prev,
    smooth,
    lastRaw,
    spatialZoneByHand: {},
    prevWristByHand: nextPrevWrist,
    prevFingerByHand: nextPrevFinger,
    levelDwellByHand: {},
  };
}

/**
 * Map latest frame to DJ controls. Pass `spatialLayout` when spatial assignment is enabled and geometry is known.
 */
export function mapFrame(
  frame: FrameMessage,
  prev: MapperState,
  alpha: number = EMA_ALPHA,
  spatialLayout: DeskLayoutForMapper | null = null,
  _relativeLevelMode: boolean = true,
): MapperState {
  const a = alpha ?? EMA_ALPHA;
  if (isDeskLayoutComplete(spatialLayout) && frame.img_width > 0 && frame.img_height > 0) {
    return mapFrameSpatial(frame, prev, a, spatialLayout);
  }
  return mapFrameBodily(frame, prev, a);
}

/** Wrist positions from an assigned frame (after `assignHandsByCameraPosition`). */
export function wristsFromAssignedFrame(frame: FrameMessage): {
  lx?: number;
  ly?: number;
  rx?: number;
  ry?: number;
} {
  const left = frame.hands.find((h) => h.side === "left");
  const right = frame.hands.find((h) => h.side === "right");
  const wl = wrist(left);
  const wr = wrist(right);
  return {
    lx: wl?.[0],
    ly: wl?.[1],
    rx: wr?.[0],
    ry: wr?.[1],
  };
}

export function applyCalibrationFromFrame(prev: MapperState, frame: FrameMessage): MapperState {
  const { lx, ly, ry } = wristsFromAssignedFrame(frame);
  if (lx === undefined || ly === undefined) return prev;

  /** Same horizontal signal as `mapCrossfader` (dual-hand average or left wrist). */
  const crossX = computeCrossfaderControlX(frame);
  const calLeft: NonNullable<MapperState["calLeft"]> = {
    x: 0.5 - (crossX !== undefined ? crossX : lx),
    y: 0.5 - ly,
  };

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
