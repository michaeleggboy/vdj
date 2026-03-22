# vdj — Virtual DJ tabletop

Browser UI for a **virtual DJ surface** driven by **hand tracking** from a local Python service. Video from your webcam is processed on your machine only (not uploaded).

## Architecture

1. **`hand_service/`** — Opens the camera, runs a **minimal vendored** JARVIS hand stack under [`hand_service/vendor/jarvis/`](hand_service/vendor/jarvis/) (see [`hand_service/vendor/README.md`](hand_service/vendor/README.md)), and streams JSON over **WebSocket** (default `ws://127.0.0.1:8765`).
2. **`web/`** — Vite + React + TypeScript UI; maps wrist positions to crossfader and deck levels with smoothing and optional calibration.

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
- **Calibrate neutral** — sets the current pose as “center” for calibrated axes (see `web/src/lib/gestureMapper.ts`).

## Privacy

Camera frames stay on your computer. The WebSocket sends **landmarks and metadata** to the browser on loopback only, not to the cloud, unless you change the code or endpoint.

## Private JARVIS upstream

The full [JARVIS](https://github.com/JARVIS-NULabs/JARVIS) repo (`gesture-2`) is private—use **SSH** or **HTTPS + GitHub auth** when cloning for reference. CI can use deploy keys or a `GITHUB_TOKEN` with repo access—never commit secrets.
