"""
WebSocket server: webcam → JARVIS HandDetector → vdj protocol frames.

Run from repo root:
  PYTHONPATH=. python -m hand_service --host 127.0.0.1 --port 8765
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import threading
import time
from pathlib import Path

import numpy as np

# Minimal vendored JARVIS: hand_service/vendor/jarvis/ (see hand_service/vendor/README.md)
_SERVICE_ROOT = Path(__file__).resolve().parent
_VENDOR = _SERVICE_ROOT / "vendor"
if _VENDOR.is_dir() and str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

from hand_service.protocol import frame_message, hello_message

try:
    import websockets
except ImportError as e:
    raise SystemExit("Install dependencies: pip install -r hand_service/requirements.txt") from e


def _side_from_label(label: str) -> str:
    if "Left" in label:
        return "left"
    if "Right" in label:
        return "right"
    return "right"


def _build_hands_payload(vf_objects, w: int, h: int) -> list[dict]:
    out: list[dict] = []
    for o in vf_objects:
        kp = o.keypoints
        if kp is None:
            continue
        arr = np.asarray(kp)
        landmarks = [
            [float(arr[i, 0]) / w, float(arr[i, 1]) / h, float(arr[i, 2])]
            for i in range(len(arr))
        ]
        out.append(
            {
                "side": _side_from_label(o.label),
                "label": o.label,
                "confidence": float(o.confidence),
                "gesture": o.gesture or "unknown",
                "landmarks": landmarks,
            }
        )
    return out


def _camera_loop(
    *,
    device: int,
    max_fps: float,
    loop: asyncio.AbstractEventLoop,
    broadcast,
) -> None:
    from jarvis.vision.pose import HandDetector
    from jarvis.vision.webcam import WebcamStream

    try:
        detector = HandDetector(static_image_mode=False)
    except Exception as e:
        print(f"[hand_service] HandDetector init failed: {e}", file=sys.stderr)
        raise

    min_interval = 1.0 / max_fps
    t_start = time.monotonic()
    last_emit = 0.0

    with WebcamStream(device=device, threaded=True, mirror=True) as cam:
        for frame in cam:
            now = time.monotonic()
            if now - last_emit < min_interval:
                continue
            last_emit = now
            t_ms = int((now - t_start) * 1000)
            h, w = frame.shape[:2]
            vf = detector.run(frame, source_label="webcam", timestamp_ms=t_ms)
            hands = _build_hands_payload(vf.objects, w, h)
            msg = frame_message(
                t_ms=t_ms,
                img_width=w,
                img_height=h,
                hands=hands,  # type: ignore[arg-type]
            )
            text = json.dumps(msg)
            asyncio.run_coroutine_threadsafe(broadcast(text), loop)


async def _run_server(host: str, port: int, device: int, max_fps: float) -> None:
    clients: set = set()
    lock = asyncio.Lock()

    async def broadcast(text: str) -> None:
        async with lock:
            snapshot = list(clients)
        for ws in snapshot:
            try:
                await ws.send(text)
            except Exception:
                async with lock:
                    clients.discard(ws)

    loop = asyncio.get_running_loop()

    def start_camera() -> None:
        _camera_loop(
            device=device,
            max_fps=max_fps,
            loop=loop,
            broadcast=broadcast,
        )

    threading.Thread(target=start_camera, daemon=True).start()
    await asyncio.sleep(0.5)

    async def handler(ws):
        await ws.send(json.dumps(hello_message()))
        async with lock:
            clients.add(ws)
        try:
            await ws.wait_closed()
        finally:
            async with lock:
                clients.discard(ws)

    async with websockets.serve(handler, host, port):
        await asyncio.Future()


def main() -> None:
    p = argparse.ArgumentParser(description="vdj hand WebSocket service")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--device", type=int, default=0, help="OpenCV camera index")
    p.add_argument("--max-fps", type=float, default=30.0)
    args = p.parse_args()

    _pose = _VENDOR / "jarvis" / "vision" / "pose.py"
    if not _pose.is_file():
        print(
            f"Missing vendored vision stack: {_pose}. See hand_service/vendor/README.md.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        asyncio.run(_run_server(args.host, args.port, args.device, args.max_fps))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
