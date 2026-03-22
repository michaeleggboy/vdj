# vdj — Virtual DJ tabletop

Browser UI for a **virtual DJ surface** driven by **hand tracking** from a local Python service. Video from your webcam is processed on your machine only (not uploaded).

## Architecture

1. **`hand_service/`** — Opens the camera, runs a **minimal vendored** JARVIS hand stack under [`hand_service/vendor/jarvis/`](hand_service/vendor/jarvis/) (see [`hand_service/vendor/README.md`](hand_service/vendor/README.md)), and streams JSON over **WebSocket** (default `ws://127.0.0.1:8765`). The port speaks **WebSocket only**—do not open `http://127.0.0.1:8765` in a browser tab (you’ll get a plain HTTP response, not a page). Use the **vdj web app**, which connects with `ws://`.
2. **`web/`** — Vite + React + TypeScript UI; maps wrist positions to crossfader and deck levels with smoothing and optional calibration. **Web Audio** mixes two local files (Deck A / B) with the same smoothed controls (`web/src/audio/`).

**Full JARVIS** on branch [`gesture-2`](https://github.com/JARVIS-NULabs/JARVIS/tree/gesture-2) is **not required in this repo**—keep it as a **reference** clone or private GitHub repo for upgrades and context. You do not need `third_party/JARVIS-gesture-2/` unless you are comparing or refreshing the vendor slice.

Protocol: [docs/protocol.md](docs/protocol.md).

## Prerequisites

- **Python 3.11+** (upstream JARVIS declares `>=3.11`).
- **Node.js** for the web app.
- Vendored vision code is already under `hand_service/vendor/` (committed). To refresh from upstream, see [`hand_service/vendor/README.md`](hand_service/vendor/README.md).

## Run (two terminals)

### 1. Hand service

```bash
cd /path/to/vdj
python3 -m pip install -r hand_service/requirements.txt
PYTHONPATH=. python3 -m hand_service --host 127.0.0.1 --port 8765
```

On first run, MediaPipe may download model files to `~/.jarvis/models/`.

### 2. Web UI

```bash
cd web
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`). The UI connects to the hand service WebSocket.

If the service runs elsewhere, set:

```bash
VITE_HAND_WS=ws://127.0.0.1:8765 npm run dev
```

### Controls (defaults)

- **Left hand** — wrist **horizontal** position → **crossfader**; wrist **vertical** → **Deck A** level (higher hand = louder).
- **Right hand** — wrist **vertical** → **Deck B** level.
- **Neutral** — starts a **5 second** countdown so you can move both hands off the mouse into position; when it hits zero, the **current** frame is used as the neutral pose for calibrated axes (see `web/src/lib/gestureMapper.ts`). Click again while counting to **cancel**. Press **`N`** anywhere (except inputs) to start or cancel the same countdown.

### Audio output (Web Audio)

1. Click **Enable audio** once (browsers require a user gesture before `AudioContext` can run; Safari may show the context as suspended until then).
2. Use **Deck A** / **Deck B** to pick **local audio files** from disk. Files are decoded in the browser only; nothing is uploaded.
3. Press **Play** to start looping playback through the mixer; **Stop** stops both decks.
4. Mixer behavior matches the on-screen faders: **equal-power crossfader** plus per-deck level, driven by `mapper.smooth` (see `web/src/audio/mixerEngine.ts`). Gain changes are smoothed on the audio thread to reduce zipper noise.
5. **Swap A/B** only swaps on-screen columns and which camera side maps to which deck; **logical Deck A / B** in the mapper always drives the same audio channels.

Loading tracks by **URL** is not implemented in this MVP (would require CORS-friendly hosts or a proxy). Use local files.

## Privacy

Camera frames stay on your computer. The WebSocket sends **landmarks and metadata** to the browser on loopback only, not to the cloud, unless you change the code or endpoint.

## Private JARVIS upstream

The full [JARVIS](https://github.com/JARVIS-NULabs/JARVIS) repo (`gesture-2`) is private—use **SSH** or **HTTPS + GitHub auth** when cloning for reference. CI can use deploy keys or a `GITHUB_TOKEN` with repo access—never commit secrets.
