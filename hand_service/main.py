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
    from websockets.datastructures import Headers
    from websockets.http11 import Response
except ImportError as e:
    raise SystemExit("Install dependencies: pip install -r hand_service/requirements.txt") from e


def _side_from_label(label: str) -> str:
    if "Left" in label:
        return "left"
    if "Right" in label:
        return "right"
    return "right"


def _pinch_distance(landmarks: list) -> float:
    """Normalized Euclidean distance between thumb tip (4) and index tip (8)."""
    if len(landmarks) < 9:
        return 1.0
    t = landmarks[4]
    i = landmarks[8]
    return float(((t[0] - i[0]) ** 2 + (t[1] - i[1]) ** 2) ** 0.5)


def _curled_fingers(landmarks: list) -> int:
    """Count fingers where tip y > MCP y (excludes thumb)."""
    pairs = [(8, 5), (12, 9), (16, 13), (20, 17)]
    if len(landmarks) < 21:
        return 0
    count = 0
    for tip_idx, mcp_idx in pairs:
        if landmarks[tip_idx][1] > landmarks[mcp_idx][1]:
            count += 1
    return count


def _finger_spread(landmarks: list) -> float:
    """Normalized distance between index tip (8) and pinky tip (20)."""
    if len(landmarks) < 21:
        return 0.5
    idx = landmarks[8]
    pnk = landmarks[20]
    return float(((idx[0] - pnk[0]) ** 2 + (idx[1] - pnk[1]) ** 2) ** 0.5)


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
                "pinch_distance": _pinch_distance(landmarks),
                "curled_fingers": _curled_fingers(landmarks),
                "finger_spread": _finger_spread(landmarks),
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

    async def process_request(connection, request):
        """Plain HTTP hits (e.g. browser opened http://host:port) are not WebSocket upgrades."""
        upgrade = (request.headers.get("Upgrade") or "").lower()
        conn_raw = request.headers.get("Connection") or ""
        conn_parts = {p.strip().lower() for p in conn_raw.split(",") if p.strip()}
        if upgrade == "websocket" and "upgrade" in conn_parts:
            return None
        body = (
            b"vdj hand_service: WebSocket only. "
            b"Use ws:// from the web app (do not open this URL as http:// in a browser).\n"
        )
        hdrs = Headers(
            [
                ("Content-Type", "text/plain; charset=utf-8"),
                ("Content-Length", str(len(body))),
            ]
        )
        return Response(400, "Bad Request", hdrs, body)

    async with websockets.serve(handler, host, port, process_request=process_request):
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
