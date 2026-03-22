# vdj roadmap (living)

No older plan file was found in the repo; this document captures **next directions** discussed for the web UI and deck behavior. Edit as priorities shift.

---

## 1. Top bar — reduce cognitive load

**Done (current UI)**:

- Single **Setup** `<details>` holds **Calibration** and **Appearance** (theme swatches) with section headings—only one chevron when the bar is collapsed.
- Main row stays: brand, status, audio, Swap A/B, Neutral + Reset; visible **`N`** `kbd` next to Neutral for the shortcut.

**Possible later**:

- Collapse audio into Setup (not done—high-friction for the main job).
- Move Swap A/B into Setup if the bar should be even quieter.

---

## 2. Accessibility and contrast

**Done (baseline pass)** — skip link, `main` landmark, status/alert live regions, crossfader `aria-label` group, Swap/Reset/file input names, neutral countdown screen-reader text, decorative `aria-hidden` where redundant, slightly higher-opacity hints. See [`.impeccable.md`](../.impeccable.md) Accessibility section.

**Still worth doing**:

- Run **automated + manual WCAG** checks on `--vdj-fg` vs `--vdj-bar-bg`, mixer chrome, connected pill, and theme swatches.
- Extend **`prefers-reduced-motion`** for any **new** animations.
- Prefer **not color-alone** for state where still cheap (e.g. extra text on status if you add icons).

---

## 3. DJ deck features (backlog ideas)

These are **not specced**; use as a wishlist when you pick the next slice of work.

| Idea | Notes |
|------|--------|
| **Play / pause per deck** | Wire to `DjMixerEngine` / store; optional hand gesture to toggle. |
| **Cue / preview** | Headphone-style cue channel if audio graph supports it. |
| **Tempo / BPM display** | From decoded audio (Web Audio analysis) or file metadata. |
| **Sync / phase meter** | Heavy lift; depends on beat grid or onset detection. |
| **Scratch-friendly platter** | Map hand rotation on jog to scrub rate (beyond constant spin). |
| **VU / peak meters** | Per-deck level meters from analyser node. |
| **Loop in/out** | Needs transport model in engine. |

**Protocol / backend**: New gestures may need `hand_service` or mapper changes; keep `docs/protocol.md` in sync when message shapes change.

---

## 4. Done recently (context)

- Top bar: **Setup** disclosure combines calibration + appearance; **N** shown beside Neutral.
- Hardware preset: **red–white–black** (red A, white B level/accents, silver/light-black center strip + mixer chrome tokens).
- **Classic** preset keeps **dark** center strip and neon decks.
