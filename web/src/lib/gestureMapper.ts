import type { DeskLayoutForMapper, SpatialDeskZone } from "./deskZones";
import { hitSpatialDeskZoneWithHysteresis, isDeskLayoutComplete, laneForSpatialZone, normalizedImageToViewport } from "./deskZones";
import type { FrameMessage, HandPayload } from "../protocol";

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const PINKY_TIP = 20;
/** Pinch engage / release (normalized thumb–index distance) with hysteresis. */
const PINCH_ENGAGE_THRESHOLD = 0.045;
const PINCH_RELEASE_THRESHOLD = 0.065;
/** Fast crossfader chop when wrist delta per frame exceeds this (normalized). */
const CUT_VELOCITY_THRESHOLD = 0.025;
const CUT_SNAP_ALPHA = 0.95;
/** Fist = enough fingers curled (excludes pinch with one finger). */
const FIST_CURL_THRESHOLD = 3;
const FIST_DEBOUNCE_FRAMES = 8;
/** Re-export for UI (intent badges). */
export const SPATIAL_FIST_DEBOUNCE_FRAMES = FIST_DEBOUNCE_FRAMES;
export const SPATIAL_FIST_CURL_MIN = FIST_CURL_THRESHOLD;
/** EMA blend default when caller does not pass alpha (exported). */
export const EMA_ALPHA = 0.48;
const EMA_ALPHA_MIN = 0.25;
const EMA_ALPHA_MAX = 0.55;
const CONFIDENCE_LOW = 0.6;
const CONFIDENCE_HIGH = 0.95;
/** While scratching, blend raw drive into rate. */
const SCRATCH_ALPHA = 0.44;
/** Faster blend when raw is at rest (rate 1 / vel 0) so release settles in ~150ms at ~30Hz. */
const SCRATCH_RELEASE_ALPHA = 0.54;
/** Scale angular Δ (rad) × radial factor into scratch drive units (matches linear finger path magnitude). */
const ANGULAR_DRIVE_SCALE = 9;
const ANGULAR_R_MIN_PX = 8;
/** Combined drive: vertical dominates (platter swipe); horizontal still nudges. */
const SCRATCH_WY = 1;
const SCRATCH_WX = 0.32;
/** Normalized wrist delta per frame below this → treat as idle (rate → 1). */
const SCRATCH_DRIVE_DEAD = 3.5e-4;
const SCRATCH_SENS = 46;
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
/** Index fingertip delta smoothing when using linear scrub fallback. */
const SCRUB_FINGER_ALPHA = 0.58;
const SCRATCH_CURVE_EXPO = 1.4;
const SCRATCH_CURVE_REF = 0.02;
const SPREAD_MIN = 0.04;
const SPREAD_MAX = 0.18;
const SENS_MIN = 16;
const SENS_MAX = 72;

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
    /** Transport toggles from fist gesture this frame; consumed by the WebSocket hook. */
    transportToggles: ("a" | "b")[];
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
  /** Previous platter angle (viewport atan2) per hand while pinch-scrubbing; null when not engaged. */
  prevPlatterAngleByHand: Record<string, number | null>;
  /** Pinch engaged (spatial scrub lane) per hand label — hysteresis state. */
  pinchEngaged: Record<string, boolean>;
  /** Frames held in fist pose per hand (deck zones). */
  fistFramesByHand: Record<string, number>;
  /** Fist toggle already fired until hand opens. */
  fistFiredByHand: Record<string, boolean>;
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
      transportToggles: [],
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
    prevPlatterAngleByHand: {},
    pinchEngaged: {},
    fistFramesByHand: {},
    fistFiredByHand: {},
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

const CURL_PAIRS: [number, number][] = [
  [8, 5],
  [12, 9],
  [16, 13],
  [20, 17],
];

function pinchDistanceNorm(h: HandPayload): number {
  if (typeof h.pinch_distance === "number" && Number.isFinite(h.pinch_distance)) {
    return h.pinch_distance;
  }
  const lm = h.landmarks;
  if (!lm?.[THUMB_TIP] || !lm?.[INDEX_TIP]) return 1;
  const [x4, y4] = lm[THUMB_TIP];
  const [x8, y8] = lm[INDEX_TIP];
  return Math.hypot(x4 - x8, y4 - y8);
}

/** Hysteresis: stay pinched until fingers open past release threshold. */
function pinchEngagedWithHysteresis(h: HandPayload, wasPinched: boolean): boolean {
  const d = pinchDistanceNorm(h);
  if (wasPinched) return d < PINCH_RELEASE_THRESHOLD;
  return d < PINCH_ENGAGE_THRESHOLD;
}

function curledFingersFromLandmarks(h: HandPayload): number {
  if (typeof h.curled_fingers === "number" && Number.isFinite(h.curled_fingers)) {
    return Math.max(0, Math.min(4, Math.round(h.curled_fingers)));
  }
  const lm = h.landmarks;
  if (!lm || lm.length < 21) return 0;
  let c = 0;
  for (const [tip, mcp] of CURL_PAIRS) {
    if (lm[tip][1] > lm[mcp][1]) c += 1;
  }
  return c;
}

function fingerSpreadNorm(h: HandPayload): number {
  if (typeof h.finger_spread === "number" && Number.isFinite(h.finger_spread)) {
    return h.finger_spread;
  }
  const lm = h.landmarks;
  if (!lm?.[INDEX_TIP] || !lm?.[PINKY_TIP]) return 0.1;
  const [x8, y8] = lm[INDEX_TIP];
  const [x20, y20] = lm[PINKY_TIP];
  return Math.hypot(x8 - x20, y8 - y20);
}

function dynamicScratchSens(fingerSpread: number): number {
  const t = clamp01((fingerSpread - SPREAD_MIN) / (SPREAD_MAX - SPREAD_MIN));
  return SENS_MIN + t * (SENS_MAX - SENS_MIN);
}

/** Blend factor from mean hand tracking confidence (~30Hz frames). */
export function frameAlphaFromConfidence(frame: FrameMessage): number {
  const avg =
    frame.hands.length > 0 ? frame.hands.reduce((s, h) => s + h.confidence, 0) / frame.hands.length : 0.8;
  const t = clamp01((avg - CONFIDENCE_LOW) / (CONFIDENCE_HIGH - CONFIDENCE_LOW));
  return EMA_ALPHA_MIN + t * (EMA_ALPHA_MAX - EMA_ALPHA_MIN);
}

function wrapAngleDelta(prevTheta: number, theta: number): number {
  let d = theta - prevTheta;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
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

function scratchRateFromDrive(drive: number, sens: number = SCRATCH_SENS): number {
  if (Math.abs(drive) < SCRATCH_DRIVE_DEAD) return 1;
  const sign = Math.sign(drive);
  const magnitude = Math.abs(drive);
  const curved = Math.pow(magnitude / SCRATCH_CURVE_REF, SCRATCH_CURVE_EXPO) * SCRATCH_CURVE_REF;
  const v = 1 + sens * sign * curved;
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

/** Stronger smoothing when `raw` already equals the rest value but `prev` has not settled (pinch release). */
function smoothScratchBlend(prev: number, raw: number, alphaScratch: number, alphaRelease: number, restRaw: number): number {
  const atRest = Math.abs(raw - restRaw) < 1e-6;
  const prevOff = Math.abs(prev - restRaw) > 1e-6;
  const alpha = atRest && prevOff ? alphaRelease : alphaScratch;
  return alpha * raw + (1 - alpha) * prev;
}

type BestScratch = { drive: number; sens: number };

function updateScratchDeltas(
  zone: SpatialDeskZone | null,
  layout: DeskLayoutForMapper,
  drive: number,
  sens: number,
  bestA: BestScratch,
  bestB: BestScratch,
  sawA: { v: boolean },
  sawB: { v: boolean },
): void {
  const pick = (deck: "a" | "b") => {
    if (deck === "a") {
      sawA.v = true;
      if (Math.abs(drive) >= Math.abs(bestA.drive)) {
        bestA.drive = drive;
        bestA.sens = sens;
      }
    } else {
      sawB.v = true;
      if (Math.abs(drive) >= Math.abs(bestB.drive)) {
        bestB.drive = drive;
        bestB.sens = sens;
      }
    }
  };
  if (zone === "leftDeck") pick(layout.leftColumnDeck);
  else if (zone === "rightDeck") pick(layout.rightColumnDeck);
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

  const bestA: BestScratch = { drive: 0, sens: SCRATCH_SENS };
  const bestB: BestScratch = { drive: 0, sens: SCRATCH_SENS };
  const sawScratchA = { v: false };
  const sawScratchB = { v: false };

  const nextPinchByHand = { ...prev.pinchEngaged };
  const nextAngleByHand = { ...prev.prevPlatterAngleByHand };
  const nextFistFrames = { ...prev.fistFramesByHand };
  const nextFistFired = { ...prev.fistFiredByHand };
  const transportSet = new Set<"a" | "b">();
  const labelsSeen = new Set<string>();

  for (const h of frame.hands) {
    labelsSeen.add(h.label);
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

    const lane = zone ? laneForSpatialZone(zone, layout) : null;

    const clearDeckGestureState = () => {
      nextPinchByHand[h.label] = false;
      nextAngleByHand[h.label] = null;
      nextFistFrames[h.label] = 0;
      nextFistFired[h.label] = false;
    };

    if (lane === "crossfader") {
      clearDeckGestureState();
      crossDelta.push(dx);
      intentBySide[h.side] = "crossfader";
      intentStrength[h.side] = Math.max(intentStrength[h.side], Math.min(1, Math.abs(dx) * 42));
    } else if (lane === "levelA") {
      clearDeckGestureState();
      nextDwell[h.label] = (nextDwell[h.label] ?? 0) + 1;
      if ((nextDwell[h.label] ?? 0) >= LEVEL_DWELL_FRAMES) {
        levelDeltaA.push(dx * LEVEL_RELATIVE_SCALE);
        intentBySide[h.side] = "levelA";
        intentStrength[h.side] = Math.max(intentStrength[h.side], Math.min(1, Math.abs(dx) * 26));
      } else {
        intentBySide[h.side] = "levelA";
      }
    } else if (lane === "levelB") {
      clearDeckGestureState();
      nextDwell[h.label] = (nextDwell[h.label] ?? 0) + 1;
      if ((nextDwell[h.label] ?? 0) >= LEVEL_DWELL_FRAMES) {
        levelDeltaB.push(dx * LEVEL_RELATIVE_SCALE);
        intentBySide[h.side] = "levelB";
        intentStrength[h.side] = Math.max(intentStrength[h.side], Math.min(1, Math.abs(dx) * 26));
      } else {
        intentBySide[h.side] = "levelB";
      }
    } else if (zone != null) {
      const wasPinched = prev.pinchEngaged[h.label] ?? false;
      const pinchOn = pinchEngagedWithHysteresis(h, wasPinched);
      nextPinchByHand[h.label] = pinchOn;
      nextDwell[h.label] = 0;

      const curled = curledFingersFromLandmarks(h);
      const isFist = curled >= FIST_CURL_THRESHOLD;
      const prevFf = prev.fistFramesByHand[h.label] ?? 0;
      const prevFired = prev.fistFiredByHand[h.label] ?? false;
      if (isFist) {
        const nf = prevFf + 1;
        nextFistFrames[h.label] = nf;
        if (nf >= FIST_DEBOUNCE_FRAMES && !prevFired) {
          nextFistFired[h.label] = true;
          const deckKey = zone === "leftDeck" ? layout.leftColumnDeck : layout.rightColumnDeck;
          transportSet.add(deckKey);
        } else {
          nextFistFired[h.label] = prevFired;
        }
      } else {
        nextFistFrames[h.label] = 0;
        nextFistFired[h.label] = false;
      }

      const scrubIntent: HandIntent = lane === "scrubA" ? "scrubA" : "scrubB";

      if (pinchOn && !isFist) {
        const sens = dynamicScratchSens(fingerSpreadNorm(h));
        const fingerVp = normalizedImageToViewport(fx, fy, layout, iw, ih);
        const deckRect = zone === "leftDeck" ? layout.left : layout.right;
        const padC = zone === "leftDeck" ? layout.leftPlatterCenter : layout.rightPlatterCenter;
        const hasPadCenter =
          padC != null && Number.isFinite(padC.x) && Number.isFinite(padC.y);
        const cx = hasPadCenter ? padC.x : (deckRect.left + deckRect.right) / 2;
        const cy = hasPadCenter ? padC.y : (deckRect.top + deckRect.bottom) / 2;

        let drive = 0;
        let applyScratch = false;

        if (hasPadCenter) {
          const theta = Math.atan2(fingerVp.y - cy, fingerVp.x - cx);
          if (!wasPinched) {
            nextAngleByHand[h.label] = theta;
          } else {
            const prevTheta = prev.prevPlatterAngleByHand[h.label];
            if (prevTheta == null) {
              nextAngleByHand[h.label] = theta;
            } else {
              const dTheta = wrapAngleDelta(prevTheta, theta);
              const deckW = deckRect.right - deckRect.left;
              const deckH = deckRect.bottom - deckRect.top;
              const rMax = Math.max(ANGULAR_R_MIN_PX, Math.min(deckW, deckH) * 0.5);
              const r = Math.hypot(fingerVp.x - cx, fingerVp.y - cy);
              const radial = Math.max(0.15, Math.min(1, r / rMax));
              const distance = Math.hypot(fingerVp.x - cx, fingerVp.y - cy);
              const distScale = 0.3 + 0.7 * Math.min(1, distance / 150);
              drive = -dTheta * radial * ANGULAR_DRIVE_SCALE * distScale;
              nextAngleByHand[h.label] = theta;
              applyScratch = true;
            }
          }
        } else {
          const pf = prev.prevFingerByHand[h.label] ?? [fx, fy];
          const fdx = (fx - pf[0]) * SCRUB_FINGER_ALPHA;
          const fdy = (fy - pf[1]) * SCRUB_FINGER_ALPHA;
          if (wasPinched) {
            drive = scratchDrive(fdx, fdy);
            applyScratch = true;
          }
          if (!wasPinched) {
            nextAngleByHand[h.label] = null;
          }
        }

        if (applyScratch) {
          updateScratchDeltas(zone, layout, drive, sens, bestA, bestB, sawScratchA, sawScratchB);
        }
        intentBySide[h.side] = scrubIntent;
        intentStrength[h.side] = Math.max(intentStrength[h.side], Math.min(1, Math.abs(drive) * 12));
      } else if (!pinchOn) {
        nextAngleByHand[h.label] = null;
        intentBySide[h.side] = scrubIntent;
        intentStrength[h.side] = Math.max(intentStrength[h.side], 0.15);
      } else {
        nextAngleByHand[h.label] = null;
        intentBySide[h.side] = scrubIntent;
        intentStrength[h.side] = Math.max(intentStrength[h.side], 0.12);
      }
    } else {
      clearDeckGestureState();
      nextDwell[h.label] = 0;
    }

    nextPrevFinger[h.label] = [fx, fy];
  }

  for (const k of Object.keys(nextPinchByHand)) {
    if (!labelsSeen.has(k)) delete nextPinchByHand[k];
  }
  for (const k of Object.keys(nextAngleByHand)) {
    if (!labelsSeen.has(k)) delete nextAngleByHand[k];
  }
  for (const k of Object.keys(nextFistFrames)) {
    if (!labelsSeen.has(k)) delete nextFistFrames[k];
  }
  for (const k of Object.keys(nextFistFired)) {
    if (!labelsSeen.has(k)) delete nextFistFired[k];
  }

  let cross = prev.smooth.crossfader;
  if (crossDelta.length > 0) {
    const delta = crossDelta.reduce((a, b) => a + b, 0) / crossDelta.length;
    const absDelta = Math.abs(delta);
    if (absDelta > CUT_VELOCITY_THRESHOLD) {
      const target = delta > 0 ? 1 : 0;
      cross = CUT_SNAP_ALPHA * target + (1 - CUT_SNAP_ALPHA) * prev.smooth.crossfader;
    } else {
      const applied = Math.max(-CROSS_SLEW_MAX, Math.min(CROSS_SLEW_MAX, delta * CROSS_RELATIVE_SCALE));
      const next = clamp01(prev.smooth.crossfader + applied);
      cross = Math.abs(next - 0.5) <= CROSS_CENTER_SNAP ? 0.5 : next;
    }
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

  const rawScratchA = sawScratchA.v ? scratchRateFromDrive(bestA.drive, bestA.sens) : 1;
  const rawScratchB = sawScratchB.v ? scratchRateFromDrive(bestB.drive, bestB.sens) : 1;
  const rawScrubVelA = sawScratchA.v ? scrubVelocityFromDrive(bestA.drive) : 0;
  const rawScrubVelB = sawScratchB.v ? scrubVelocityFromDrive(bestB.drive) : 0;

  const transportToggles = [...transportSet];
  const s = prev.smooth;
  const smooth = {
    crossfader: alpha * cross + (1 - alpha) * s.crossfader,
    deckAGain: alpha * gA + (1 - alpha) * s.deckAGain,
    deckBGain: alpha * gB + (1 - alpha) * s.deckBGain,
    scratchRateA: smoothScratchBlend(s.scratchRateA, rawScratchA, SCRATCH_ALPHA, SCRATCH_RELEASE_ALPHA, 1),
    scratchRateB: smoothScratchBlend(s.scratchRateB, rawScratchB, SCRATCH_ALPHA, SCRATCH_RELEASE_ALPHA, 1),
    scrubVelocityA: smoothScratchBlend(s.scrubVelocityA, rawScrubVelA, SCRATCH_ALPHA, SCRATCH_RELEASE_ALPHA, 0),
    scrubVelocityB: smoothScratchBlend(s.scrubVelocityB, rawScrubVelB, SCRATCH_ALPHA, SCRATCH_RELEASE_ALPHA, 0),
    handIntentLeft: intentBySide.left,
    handIntentRight: intentBySide.right,
    handStrengthLeft: smoothScratch(s.handStrengthLeft, intentStrength.left, SCRATCH_ALPHA),
    handStrengthRight: smoothScratch(s.handStrengthRight, intentStrength.right, SCRATCH_ALPHA),
    transportToggles,
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
    prevPlatterAngleByHand: nextAngleByHand,
    pinchEngaged: nextPinchByHand,
    fistFramesByHand: nextFistFrames,
    fistFiredByHand: nextFistFired,
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
      const sens = dynamicScratchSens(fingerSpreadNorm(h));
      rawScratchA = scratchRateFromDrive(d, sens);
      rawScrubVelA = scrubVelocityFromDrive(d);
      intentLeft = "scrubA";
      strengthLeft = Math.max(strengthLeft, Math.min(1, Math.abs(d) * 12));
    }
    if (h.side === "right") {
      sawRight = true;
      const d = scratchDrive(dx, dy);
      const sens = dynamicScratchSens(fingerSpreadNorm(h));
      rawScratchB = scratchRateFromDrive(d, sens);
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
    scratchRateA: smoothScratchBlend(s.scratchRateA, rawScratchA, SCRATCH_ALPHA, SCRATCH_RELEASE_ALPHA, 1),
    scratchRateB: smoothScratchBlend(s.scratchRateB, rawScratchB, SCRATCH_ALPHA, SCRATCH_RELEASE_ALPHA, 1),
    scrubVelocityA: smoothScratchBlend(s.scrubVelocityA, rawScrubVelA, SCRATCH_ALPHA, SCRATCH_RELEASE_ALPHA, 0),
    scrubVelocityB: smoothScratchBlend(s.scrubVelocityB, rawScrubVelB, SCRATCH_ALPHA, SCRATCH_RELEASE_ALPHA, 0),
    handIntentLeft: intentLeft,
    handIntentRight: intentRight,
    handStrengthLeft: smoothScratch(s.handStrengthLeft, strengthLeft, SCRATCH_ALPHA),
    handStrengthRight: smoothScratch(s.handStrengthRight, strengthRight, SCRATCH_ALPHA),
    transportToggles: [],
  };

  return {
    ...prev,
    smooth,
    lastRaw,
    spatialZoneByHand: {},
    prevWristByHand: nextPrevWrist,
    prevFingerByHand: nextPrevFinger,
    levelDwellByHand: {},
    pinchEngaged: {},
    prevPlatterAngleByHand: {},
    fistFramesByHand: {},
    fistFiredByHand: {},
  };
}

/**
 * Map latest frame to DJ controls. Pass `spatialLayout` when spatial assignment is enabled and geometry is known.
 */
export function mapFrame(
  frame: FrameMessage,
  prev: MapperState,
  alpha?: number,
  spatialLayout: DeskLayoutForMapper | null = null,
  _relativeLevelMode: boolean = true,
): MapperState {
  const a = alpha === undefined ? frameAlphaFromConfidence(frame) : alpha;
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
