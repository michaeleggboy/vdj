import { create } from "zustand";
import {
  applyThemeToDocument,
  mergeTheme,
  readThemeFromStorage,
  writeThemeToStorage,
  type ThemePresetId,
  type VdjThemeVars,
} from "../theme/vdjTheme";

type ThemeState = {
  presetId: ThemePresetId;
  overrides: Partial<VdjThemeVars>;
  handLeftHex: string;
  handRightHex: string;
  hydrated: boolean;
  hydrate: () => void;
  setPreset: (id: ThemePresetId) => void;
  setOverride: (key: string, value: string | undefined) => void;
  clearOverrides: () => void;
};

function pickHandColors(merged: VdjThemeVars): { left: string; right: string } {
  return {
    left: merged["--vdj-hand-left"] ?? "#888888",
    right: merged["--vdj-hand-right"] ?? "#888888",
  };
}

function applyMerged(
  set: (partial: Partial<ThemeState>) => void,
  get: () => ThemeState,
): void {
  const { presetId, overrides } = get();
  const merged = mergeTheme(presetId, overrides);
  applyThemeToDocument(document.documentElement, merged);
  const { left, right } = pickHandColors(merged);
  set({ handLeftHex: left, handRightHex: right });
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  presetId: "hardware",
  overrides: {},
  handLeftHex: "#e84545",
  handRightHex: "#f0ece8",
  hydrated: false,

  hydrate: () => {
    const stored = readThemeFromStorage();
    if (stored) {
      set({ presetId: stored.presetId, overrides: stored.overrides });
    }
    applyMerged(set, get);
    set({ hydrated: true });
  },

  setPreset: (presetId) => {
    set({ presetId });
    writeThemeToStorage(presetId, get().overrides);
    applyMerged(set, get);
  },

  setOverride: (key, value) => {
    const next = { ...get().overrides };
    if (value === undefined || value === "") delete next[key as string];
    else next[key as string] = value;
    set({ overrides: next });
    writeThemeToStorage(get().presetId, next);
    applyMerged(set, get);
  },

  clearOverrides: () => {
    set({ overrides: {} });
    writeThemeToStorage(get().presetId, {});
    applyMerged(set, get);
  },
}));
