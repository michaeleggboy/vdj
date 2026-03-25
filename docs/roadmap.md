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

**Current baseline** — [`web/src/audio/mixerEngine.ts`](../web/src/audio/mixerEngine.ts): per-deck transport now tracks a real **playhead**. In normal playback, decks run forward from that position; in scrub mode, the engine performs short **segment restarts** from the moving playhead so up/down platter gestures audibly move through track position (fast-forward/rewind feel), then resume normal forward playback on release. Reverse-capable browsers still use negative segment rate where available. [`DjAudioEngine`](../web/src/components/DjAudioEngine.tsx) drives mixer levels, scratch input, and per-frame transport ticks, and publishes deck progress for visuals. [`gestureMapper`](../web/src/lib/gestureMapper.ts): scratch outputs both playback-rate flavor and a signed **scrub velocity** from vertical-first wrist motion. [`App.tsx`](../web/src/App.tsx): spatial mode keeps widened fader hit zones and adds optional **relative level mode** (grab-and-slide style) for easier precision. [`DeckPlatter`](../web/src/components/DeckPlatter.tsx): jog visuals now include direction cue + progress ring in addition to spin speed/direction (`prefers-reduced-motion` still respected).

Use the table below as a **wishlist**; nothing here is specced for implementation order.

### Suggested tiers

| Tier | Theme | Rationale |
|------|--------|-----------|
| **A — UI + light audio** | VU meters, BPM estimate (rough), per-deck pause | Mostly Web Audio `AnalyserNode` + small engine API changes; little protocol work. |
| **B — Transport** | Playhead, seek, loop in/out, nudge | Needs explicit **transport state** (position, loop bounds) in the engine and UI; still browser-only. |
| **C — Gesture + sync** | Scratch / jog scrub, beat sync, phase | Needs landmark math ([`gestureMapper`](../web/src/lib/gestureMapper.ts)), possibly new hand features, and/or **beat detection** (heavy, error-prone). |

### Backlog table

| Feature | Effort | Main touchpoints | Notes |
|---------|--------|------------------|--------|
| **VU / peak meters** | Low | `mixerEngine` (tap `gainA`/`gainB` → analyser), `App` / small meter component | Post-fader metering matches what you hear; expose `getByteFrequencyData` or RMS in rAF. |
| **Per-deck play / pause** | Low–med | `mixerEngine` (independent source start/stop or gain mute), `DjAudioEngine`, optional `djStore` flags | Today both sources restart together in `startSources()`; split lifecycle per deck. |
| **BPM display (estimate)** | Med | Analyse decoded buffer or live analyser; optional worker | “Display only” first; no auto-sync. Libraries or simple onset autocorrelation. |
| **Cue / pre-listen** | Med | Second output path: deck → cue gain → separate `MediaStreamDestination` or second graph | True “headphones” needs routing UX (solo/cue mix); MVP might be **solo deck** to main out only. |
| **Seek + playhead** | Med | `AudioBufferSourceNode` is awkward for scrubbing; often switch to **AudioWorklet** or **scheduled** segment playback | Looping today is infinite buffer loop; seek implies **non-looping** mode or restart source at offset. |
| **Loop in/out** | Med–high | Transport state in engine + UI markers on a timeline (if you add one) | Depends on seekable representation of the track. |
| **Scratch-style jog** | High | `DeckPlatter` / mapper: map wrist angle or circular motion to **playbackRate** or micro-seeks | `playbackRate` on `BufferSource` works while playing; polish needs latency tuning. |
| **Sync / phase meter** | High | Beat grid or detected beats for both decks; UI phase widget | Research-grade feature unless you integrate a library or simplify to “tap tempo”. |

### Protocol / backend

- **Hands-only** features (e.g. extra gestures) may need [`hand_service/`](../hand_service/main.py) or richer [`docs/protocol.md`](protocol.md) payloads (e.g. per-finger data if you ever need it).
- **Browser-only** features (meters, BPM from audio, transport) do not require Python changes.

Keep **protocol** and **mapper** docs updated when message shapes or axis meanings change.

---

## 4. Desk layout and phased plan

### Visual desk wireframe (conceptual)

```
+------------------+     +-----------------------------------+     +------------------+
| Deck (jog only)  |     | [CH A]   [ Crossfader ]   [CH B]  |     | Deck (jog only)  |
|  scratch = Δx    |     | Y→gain A   X→xfade    Y→gain B    |     |  scratch = Δx    |
+------------------+     +-----------------------------------+     +------------------+
                         | Output meters row (post-fader)     |
                         +-----------------------------------+
```

Mixer channels **A/B** always show **audio** Deck A/B (not swapped with **Swap A/B**); swapped columns only change which deck sits left/right on screen.

### Implemented phases (living)

| Phase | What | Key files |
|-------|------|-----------|
| **1 — Visual desk MVP** | Vertical channel readouts, wider center strip, post-fader meters on desk | [`App.tsx`](../web/src/App.tsx), [`ChannelLevelReadout.tsx`](../web/src/components/ChannelLevelReadout.tsx), [`DeskOutputMeters.tsx`](../web/src/components/DeskOutputMeters.tsx), [`App.css`](../web/src/App.css) |
| **2 — Deck-like spatial** | **Setup → Spatial zones**: five rects — **left/right deck** = scratch only (Δx); **mixerFaderA / mixerCrossfade / mixerFaderB** = Y→gain A, X→crossfader, Y→gain B; hysteresis + hit priority crossfade→faders→decks; incomplete layout falls back to bodily | [`deskZones.ts`](../web/src/lib/deskZones.ts), [`gestureMapper.ts`](../web/src/lib/gestureMapper.ts), [`djStore.ts`](../web/src/store/djStore.ts), [`useHandWebSocket.ts`](../web/src/hooks/useHandWebSocket.ts), `mixer-strip__fader-hit` / `crossfade-hit` refs in [`App.tsx`](../web/src/App.tsx) |
| **3 — Transport API** | `setMixerLevels` + `setDeckPlaybackRate`; rates persist across source restarts | [`mixerEngine.ts`](../web/src/audio/mixerEngine.ts), [`DjAudioEngine.tsx`](../web/src/components/DjAudioEngine.tsx) |
| **4 — Scratch mapper** | `mapper.smooth.scratchRateA/B` from wrist Δx (bodily or spatial column) | [`gestureMapper.ts`](../web/src/lib/gestureMapper.ts) |
| **5 — Future slots** | “Output” strip reserved for meters; room for BPM/phase widgets later | Desk mixer footer in `App` |

### Data flow (high level)

`Frame` → `assignHandsByCameraPosition` → `mapFrame(..., spatialLayout?)` → `mapper.smooth` → audio (`setMixerLevels`, `setDeckPlaybackRate`) + UI.

---

## 5. Done recently (context)

- Audio bar: **per-deck Play / Pause**, **Stop all**, **peak meters** (AnalyserNode tap on deck gains), **estimated BPM** on file load (`estimateBpm.ts` + `DjAudioEngine`).
- Audio bar: per-deck **pitch buttons** (Slower/Faster/Reset) now apply a manual tempo multiplier combined with gesture scratch each frame (`effectiveRate = manualPitch * scratchRate`).
- Top bar: **Setup** disclosure combines calibration + appearance; **N** shown beside Neutral.
- Hardware preset: **red–white–black** (red A, white B level/accents, silver/light-black center strip + mixer chrome tokens).
- **Classic** preset keeps **dark** center strip and neon decks.
- **Desk MVP**: mixer strip channel faders + deck-like spatial (strip faders + platter scratch) + scratch via `playbackRate` + desk output meters; platters without level ring.
