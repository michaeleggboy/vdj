/** CSS custom properties on `document.documentElement` — hardware default (black / red / white) + classic (neon) preset. */

export const THEME_STORAGE_KEY = "vdj-theme-v1";

export type ThemePresetId = "hardware" | "classic";

/** Flat map: keys are full CSS var names including `--vdj-` prefix. */
export type VdjThemeVars = Record<string, string>;

export const PRESET_HARDWARE: VdjThemeVars = {
  "--vdj-fg": "#f0f0ee",
  "--vdj-app-spot": "rgba(140, 24, 28, 0.14)",
  "--vdj-app-grad-top": "#121212",
  "--vdj-app-grad-mid": "#0a0a0a",
  "--vdj-app-grad-bot": "#050505",
  "--vdj-bar-border": "rgba(255, 255, 255, 0.08)",
  "--vdj-bar-bg": "rgba(0, 0, 0, 0.52)",
  "--vdj-bar-bg-cal": "rgba(12, 6, 6, 0.42)",
  "--vdj-cal-border-top": "rgba(255, 72, 72, 0.12)",
  "--vdj-status-ok-bg": "rgba(22, 101, 52, 0.42)",
  "--vdj-status-ok-fg": "#86efac",
  "--vdj-status-off-bg": "rgba(88, 22, 24, 0.38)",
  "--vdj-status-off-fg": "#ffb4b4",
  "--vdj-err": "#ff6b6b",
  "--vdj-audio-chip-bg": "rgba(10, 6, 6, 0.45)",
  "--vdj-line-soft": "rgba(255, 255, 255, 0.07)",
  "--vdj-btn-border": "rgba(255, 255, 255, 0.12)",
  "--vdj-btn-bg": "rgba(255, 255, 255, 0.05)",
  "--vdj-btn-bg-hover": "rgba(255, 255, 255, 0.1)",
  "--vdj-accent-rgb": "229, 57, 53",
  "--vdj-accent-readable": "#ff8a84",
  "--vdj-deck-a-rgb": "196, 42, 48",
  "--vdj-deck-b-rgb": "210, 208, 212",
  "--vdj-hand-left": "#e84545",
  "--vdj-hand-right": "#f0ece8",
  "--vdj-table-border": "rgba(255, 255, 255, 0.06)",
  "--vdj-table-inset": "rgba(255, 255, 255, 0.04)",
  "--vdj-mixer-wood-a": "rgba(32, 14, 14, 0.88)",
  "--vdj-mixer-wood-b": "rgba(12, 8, 8, 0.96)",
  "--vdj-mixer-wood-c": "rgba(4, 2, 2, 0.98)",
  "--vdj-mixer-stripe": "rgba(0, 0, 0, 0.28)",
  "--vdj-mixer-inset-hi": "rgba(255, 120, 120, 0.06)",
  "--vdj-mixer-shadow-in": "rgba(0, 0, 0, 0.5)",
  "--vdj-mixer-shadow-drop": "rgba(0, 0, 0, 0.55)",
  "--vdj-mixer-border": "rgba(20, 8, 8, 0.65)",
  "--vdj-platter-contact": "rgba(0, 0, 0, 0.55)",
  "--vdj-jog-surround-1": "rgba(42, 36, 36, 0.94)",
  "--vdj-jog-surround-2": "rgba(18, 14, 14, 0.98)",
  "--vdj-jog-surround-3": "rgba(6, 4, 4, 1)",
  "--vdj-jog-surround-inset-hi": "rgba(255, 200, 200, 0.07)",
  "--vdj-jog-surround-inset-lo": "rgba(0, 0, 0, 0.58)",
  "--vdj-jog-surround-drop": "rgba(0, 0, 0, 0.4)",
  "--vdj-vinyl-base-1": "#0e0c0c",
  "--vdj-vinyl-base-2": "#060505",
  "--vdj-vinyl-base-3": "#020202",
  "--vdj-vinyl-rim": "#2a1616",
  "--vdj-vinyl-gloss": "rgba(255, 240, 240, 0.08)",
  "--vdj-groove-fg": "rgba(0, 0, 0, 0.5)",
  "--vdj-groove-mid-1": "#241c1c",
  "--vdj-groove-mid-2": "#120e0e",
  "--vdj-groove-mid-3": "#080606",
  "--vdj-center-cap-1": "#2a2222",
  "--vdj-center-cap-2": "#141010",
  "--vdj-center-cap-3": "#0a0808",
  "--vdj-center-mark": "rgba(255, 252, 250, 0.96)",
  "--vdj-spindle-mid": "#3a3434",
  "--vdj-fader-track-bg": "rgba(6, 4, 4, 0.55)",
  "--vdj-fader-track-border": "rgba(255, 255, 255, 0.08)",
  "--vdj-fader-hi-a": "#c42b2b",
  "--vdj-fader-hi-b": "#8a2424",
  "--vdj-fader-hi-c": "#5c1818",
  "--vdj-fader-v-a": "#d43838",
  "--vdj-fader-v-b": "#6b6b70",
};

/** Earlier app look: cooler room + teal / magenta decks. */
export const PRESET_CLASSIC: VdjThemeVars = {
  ...PRESET_HARDWARE,
  "--vdj-fg": "#e8ecf0",
  "--vdj-app-spot": "rgba(55, 42, 28, 0.35)",
  "--vdj-app-grad-top": "#2a1f14",
  "--vdj-app-grad-mid": "#1a1410",
  "--vdj-app-grad-bot": "#0f0c0a",
  "--vdj-bar-bg": "rgba(0, 0, 0, 0.2)",
  "--vdj-accent-rgb": "94, 234, 212",
  "--vdj-accent-readable": "#b4f5e8",
  "--vdj-deck-a-rgb": "94, 234, 212",
  "--vdj-deck-b-rgb": "232, 121, 249",
  "--vdj-hand-left": "#5eead4",
  "--vdj-hand-right": "#e879f9",
  "--vdj-fader-hi-a": "#3fb950",
  "--vdj-fader-hi-b": "#58a6ff",
  "--vdj-fader-hi-c": "#a371f7",
  "--vdj-fader-v-a": "#3fb950",
  "--vdj-fader-v-b": "#58a6ff",
};

export const PRESETS: Record<ThemePresetId, VdjThemeVars> = {
  hardware: PRESET_HARDWARE,
  classic: PRESET_CLASSIC,
};

export function mergeTheme(
  presetId: ThemePresetId,
  overrides: Partial<VdjThemeVars>,
): VdjThemeVars {
  const out: VdjThemeVars = { ...PRESETS[presetId] };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function applyThemeToDocument(root: HTMLElement, tokens: VdjThemeVars): void {
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
}

export function hexToRgbTuple(hex: string): string | null {
  const h = hex.trim().replace("#", "");
  if (h.length !== 6) return null;
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return `${r}, ${g}, ${b}`;
}

export function rgbTupleToHex(tuple: string): string | null {
  const parts = tuple.split(",").map((s) => Number.parseInt(s.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  const [r, g, b] = parts;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export type StoredTheme = {
  v: 1;
  presetId: ThemePresetId;
  overrides: Partial<VdjThemeVars>;
};

export function parseStoredTheme(raw: string | null): StoredTheme | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<StoredTheme>;
    if (j.v !== 1) return null;
    if (j.presetId !== "hardware" && j.presetId !== "classic") return null;
    const overrides =
      j.overrides && typeof j.overrides === "object" ? (j.overrides as Partial<VdjThemeVars>) : {};
    return { v: 1, presetId: j.presetId, overrides };
  } catch {
    return null;
  }
}

export function readThemeFromStorage(): StoredTheme | null {
  try {
    return parseStoredTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeThemeToStorage(presetId: ThemePresetId, overrides: Partial<VdjThemeVars>): void {
  try {
    const payload: StoredTheme = { v: 1, presetId, overrides };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}
