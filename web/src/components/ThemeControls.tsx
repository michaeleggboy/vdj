import { useMemo } from "react";
import { useThemeStore } from "../store/themeStore";
import {
  hexToRgbTuple,
  mergeTheme,
  rgbTupleToHex,
  type ThemePresetId,
} from "../theme/vdjTheme";

const K = {
  deckA: "--vdj-deck-a-rgb",
  deckB: "--vdj-deck-b-rgb",
  accent: "--vdj-accent-rgb",
  accentReadable: "--vdj-accent-readable",
  handL: "--vdj-hand-left",
  handR: "--vdj-hand-right",
  roomTop: "--vdj-app-grad-top",
  roomMid: "--vdj-app-grad-mid",
  roomBot: "--vdj-app-grad-bot",
} as const;

function tupleSwatch(tuple: string | undefined, fallback: string): string {
  return rgbTupleToHex(tuple ?? "") ?? fallback;
}

/**
 * Preset picker + color overrides (persisted). All keys map to --vdj-* CSS variables on :root.
 */
export function ThemeControls() {
  const presetId = useThemeStore((s) => s.presetId);
  const overrides = useThemeStore((s) => s.overrides);
  const setPreset = useThemeStore((s) => s.setPreset);
  const setOverride = useThemeStore((s) => s.setOverride);
  const clearOverrides = useThemeStore((s) => s.clearOverrides);

  const merged = useMemo(() => mergeTheme(presetId, overrides), [presetId, overrides]);

  return (
    <details className="top-bar__theme">
      <summary className="top-bar__disclosure-summary">Theme</summary>
      <div className="top-bar__theme-body">
        <div className="top-bar__theme-field">
          <label htmlFor="vdj-theme-preset">Preset</label>
          <select
            id="vdj-theme-preset"
            value={presetId}
            onChange={(e) => setPreset(e.target.value as ThemePresetId)}
          >
            <option value="hardware">Hardware (default)</option>
            <option value="classic">Classic neon</option>
          </select>
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-deck-a">Deck A</label>
          <input
            id="vdj-deck-a"
            className="top-bar__theme-swatch"
            type="color"
            value={tupleSwatch(merged[K.deckA], "#527c74")}
            onChange={(e) => {
              const t = hexToRgbTuple(e.target.value);
              if (t) setOverride(K.deckA, t);
            }}
            title="Deck A accent (platter glow, cap)"
          />
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-deck-b">Deck B</label>
          <input
            id="vdj-deck-b"
            className="top-bar__theme-swatch"
            type="color"
            value={tupleSwatch(merged[K.deckB], "#8a768c")}
            onChange={(e) => {
              const t = hexToRgbTuple(e.target.value);
              if (t) setOverride(K.deckB, t);
            }}
            title="Deck B accent"
          />
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-accent">Accent</label>
          <input
            id="vdj-accent"
            className="top-bar__theme-swatch"
            type="color"
            value={tupleSwatch(merged[K.accent], "#cc7c3a")}
            onChange={(e) => {
              const t = hexToRgbTuple(e.target.value);
              if (t) setOverride(K.accent, t);
            }}
            title="UI accent (focus ring, neutral banner)"
          />
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-accent-read">Accent text</label>
          <input
            id="vdj-accent-read"
            className="top-bar__theme-swatch"
            type="color"
            value={merged[K.accentReadable] ?? "#e8c090"}
            onChange={(e) => setOverride(K.accentReadable, e.target.value)}
            title="Readable text on accent banner"
          />
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-hand-l">Hand L</label>
          <input
            id="vdj-hand-l"
            className="top-bar__theme-swatch"
            type="color"
            value={merged[K.handL] ?? "#639489"}
            onChange={(e) => setOverride(K.handL, e.target.value)}
            title="Camera left hand overlay"
          />
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-hand-r">Hand R</label>
          <input
            id="vdj-hand-r"
            className="top-bar__theme-swatch"
            type="color"
            value={merged[K.handR] ?? "#a8828e"}
            onChange={(e) => setOverride(K.handR, e.target.value)}
            title="Camera right hand overlay"
          />
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-room-top">Room top</label>
          <input
            id="vdj-room-top"
            className="top-bar__theme-swatch"
            type="color"
            value={merged[K.roomTop] ?? "#1c1814"}
            onChange={(e) => setOverride(K.roomTop, e.target.value)}
            title="Background gradient top stop"
          />
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-room-mid">Room mid</label>
          <input
            id="vdj-room-mid"
            className="top-bar__theme-swatch"
            type="color"
            value={merged[K.roomMid] ?? "#14110e"}
            onChange={(e) => setOverride(K.roomMid, e.target.value)}
          />
        </div>

        <div className="top-bar__theme-field">
          <label htmlFor="vdj-room-bot">Room bottom</label>
          <input
            id="vdj-room-bot"
            className="top-bar__theme-swatch"
            type="color"
            value={merged[K.roomBot] ?? "#0e0c09"}
            onChange={(e) => setOverride(K.roomBot, e.target.value)}
          />
        </div>

        <button type="button" className="top-bar__theme-reset" onClick={() => clearOverrides()}>
          Reset custom colors
        </button>
      </div>
    </details>
  );
}
