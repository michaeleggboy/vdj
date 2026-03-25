import { letterboxRect } from "./drawStylizedHands";

/** Client / viewport rect (same space as `getBoundingClientRect`) */
export type DeskRectPlain = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * Deck-like spatial layout: outer columns = jog only; mixer = channel A fader, crossfader, channel B fader.
 * No monolithic mixer rect — use the three sub-rects for hit testing.
 */
export type DeskLayoutForMapper = {
  left: DeskRectPlain;
  right: DeskRectPlain;
  mixerFaderA: DeskRectPlain;
  mixerCrossfade: DeskRectPlain;
  mixerFaderB: DeskRectPlain;
  viewportW: number;
  viewportH: number;
  /** Which audio deck the left tabletop column shows */
  leftColumnDeck: "a" | "b";
  rightColumnDeck: "a" | "b";
  /** Optional scrub pad center (viewport px); linear scrub fallback when omitted. */
  leftPlatterCenter?: { x: number; y: number };
  rightPlatterCenter?: { x: number; y: number };
};

/** Spatial zone for hit testing (DJM-style: crossfader cap wins over adjacent vertical strips). */
export type SpatialDeskZone = "crossfade" | "faderA" | "faderB" | "leftDeck" | "rightDeck";
export type SpatialLane = "crossfader" | "levelA" | "levelB" | "scrubA" | "scrubB";

function pointInRect(x: number, y: number, r: DeskRectPlain): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function inflate(r: DeskRectPlain, m: number): DeskRectPlain {
  return {
    left: r.left - m,
    top: r.top - m,
    right: r.right + m,
    bottom: r.bottom + m,
  };
}

function rectForSpatialZone(z: SpatialDeskZone, layout: DeskLayoutForMapper): DeskRectPlain {
  switch (z) {
    case "crossfade":
      return layout.mixerCrossfade;
    case "faderA":
      return layout.mixerFaderA;
    case "faderB":
      return layout.mixerFaderB;
    case "leftDeck":
      return layout.left;
    case "rightDeck":
      return layout.right;
  }
}

/**
 * Priority: crossfade → channel faders → deck columns (matches grabbing crossfader vs strip).
 */
export function hitSpatialDeskZoneStrict(x: number, y: number, layout: DeskLayoutForMapper): SpatialDeskZone | null {
  if (pointInRect(x, y, layout.mixerCrossfade)) return "crossfade";
  if (pointInRect(x, y, layout.mixerFaderA)) return "faderA";
  if (pointInRect(x, y, layout.mixerFaderB)) return "faderB";
  if (pointInRect(x, y, layout.left)) return "leftDeck";
  if (pointInRect(x, y, layout.right)) return "rightDeck";
  return null;
}

/** Normalize hit zones into explicit functional lanes used by mapper ownership logic. */
export function laneForSpatialZone(zone: SpatialDeskZone, layout: DeskLayoutForMapper): SpatialLane {
  if (zone === "crossfade") return "crossfader";
  if (zone === "faderA") return "levelA";
  if (zone === "faderB") return "levelB";
  if (zone === "leftDeck") return layout.leftColumnDeck === "a" ? "scrubA" : "scrubB";
  return layout.rightColumnDeck === "a" ? "scrubA" : "scrubB";
}

/**
 * Prefer previous zone until the wrist leaves an inflated rect (reduces flicker at boundaries).
 */
export function hitSpatialDeskZoneWithHysteresis(
  x: number,
  y: number,
  layout: DeskLayoutForMapper,
  prev: SpatialDeskZone | null,
  marginPx: number = 14,
): SpatialDeskZone | null {
  if (prev) {
    const inflated = inflate(rectForSpatialZone(prev, layout), marginPx);
    if (pointInRect(x, y, inflated)) return prev;
  }
  return hitSpatialDeskZoneStrict(x, y, layout);
}

/** True when all rects are usable (refs mounted and non-degenerate). */
export function isDeskLayoutComplete(layout: DeskLayoutForMapper | null): layout is DeskLayoutForMapper {
  if (!layout) return false;
  const ok = (r: DeskRectPlain) =>
    Number.isFinite(r.left) &&
    Number.isFinite(r.right) &&
    r.right - r.left > 4 &&
    r.bottom - r.top > 4;
  return (
    ok(layout.left) &&
    ok(layout.right) &&
    ok(layout.mixerFaderA) &&
    ok(layout.mixerCrossfade) &&
    ok(layout.mixerFaderB) &&
    layout.viewportW > 0 &&
    layout.viewportH > 0
  );
}

/** Extra hit padding for channel level faders (clamped to mixer strip bounds). */
const FADER_INFLATE_Y_PX = 64;
const FADER_INFLATE_X_PX = 16;

/**
 * Expand mixer fader DOM rects for easier spatial level control, without exceeding the mixer section.
 */
export function inflateMixerFaderRects(
  faderA: DeskRectPlain,
  faderB: DeskRectPlain,
  mixerSection: DeskRectPlain,
): { mixerFaderA: DeskRectPlain; mixerFaderB: DeskRectPlain } {
  const clamp = (r: DeskRectPlain): DeskRectPlain => {
    let left = r.left;
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    left = Math.max(mixerSection.left, Math.min(left, mixerSection.right - 6));
    right = Math.min(mixerSection.right, Math.max(right, left + 6));
    top = Math.max(mixerSection.top, Math.min(top, mixerSection.bottom - 6));
    bottom = Math.min(mixerSection.bottom, Math.max(bottom, top + 6));
    return { left, top, right, bottom };
  };

  const inflateOne = (r: DeskRectPlain): DeskRectPlain =>
    clamp({
      left: r.left - FADER_INFLATE_X_PX,
      top: r.top - FADER_INFLATE_Y_PX,
      right: r.right + FADER_INFLATE_X_PX,
      bottom: r.bottom + FADER_INFLATE_Y_PX,
    });

  return {
    mixerFaderA: inflateOne(faderA),
    mixerFaderB: inflateOne(faderB),
  };
}

/** Map normalized landmark (camera image 0–1) to overlay/viewport CSS pixels */
export function normalizedImageToViewport(
  nx: number,
  ny: number,
  layout: Pick<DeskLayoutForMapper, "viewportW" | "viewportH">,
  imgW: number,
  imgH: number,
): { x: number; y: number } {
  const iw = imgW > 0 ? imgW : 16;
  const ih = imgH > 0 ? imgH : 9;
  const lb = letterboxRect(layout.viewportW, layout.viewportH, iw, ih);
  return { x: lb.ox + nx * lb.drawW, y: lb.oy + ny * lb.drawH };
}
