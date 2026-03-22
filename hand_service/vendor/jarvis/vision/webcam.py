"""
webcam.py - Webcam capture for JARVIS.

Provides single-frame capture and a streaming context manager for
continuous webcam access (e.g. real-time tracking or pose estimation).

Usage
-----
import cv2
from jarvis.vision.webcam import WebcamStream
from jarvis.vision.detector import detect

with WebcamStream(device=0) as cam:
    for frame in cam:
        vision_frame = detect(frame, source_label="webcam")
        for obj in vision_frame.objects:
            x1, y1 = int(obj.bbox.x1), int(obj.bbox.y1)
            x2, y2 = int(obj.bbox.x2), int(obj.bbox.y2)
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(frame, f"{obj.label} {obj.confidence:.0%}", (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        # Real measured FPS (not the requested value)
        cv2.putText(frame, f"{cam.fps:.0f} FPS", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)

        cv2.imshow("Detection", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
cv2.destroyAllWindows()
"""
from __future__ import annotations

import platform
import threading
import time
from collections import deque
from typing import Iterator, Optional

import cv2
import numpy as np


# ── Backend auto-detection ────────────────────────────────────────────────────

def _preferred_backend() -> int:
    """
    Return the native camera backend for this platform.

    cv2.VideoCapture(device) without a backend tries multiple backends
    sequentially until one works. On macOS this means probing V4L2
    (Linux-only, fails), then FFMPEG, then finally AVFoundation — adding
    200-500ms to camera open time. Specifying the backend directly skips
    the probing.
    """
    system = platform.system()
    if system == "Darwin":
        return cv2.CAP_AVFOUNDATION
    if system == "Windows":
        return cv2.CAP_DSHOW
    if system == "Linux":
        return cv2.CAP_V4L2
    return 0  # auto-detect (fallback)


class WebcamStream:
    """
    Context-managed webcam capture.

    Keeps the camera open for the lifetime of the `with` block so
    consecutive reads don't pay the device-open latency.

    Parameters
    ----------
    device     : camera index (0 = default) or video file path.
    width      : requested frame width (camera may ignore).
    height     : requested frame height.
    fps        : requested capture FPS.
    max_frames : stop after N frames (None = infinite).
    mirror     : flip frames horizontally. Defaults to True for webcams
                 (int device) and False for video files (str path).
                 Pass explicitly to override.
    backend    : OpenCV backend (e.g. cv2.CAP_AVFOUNDATION). Default
                 auto-detects per platform. Only applies to webcams (int
                 device); video files always use auto-detect.
    threaded   : if True, reads frames in a background thread so
                 cap.read() never blocks the processing loop. The
                 iterator always yields the latest frame, dropping
                 intermediate ones. Best for webcams where processing
                 is slower than camera FPS. Default False.
    """

    def __init__(
        self,
        device: int | str = 0,
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[int] = None,
        max_frames: Optional[int] = None,
        mirror: Optional[bool] = None,
        backend: Optional[int] = None,
        threaded: bool = False,
    ) -> None:
        self.device = device
        self.width = width
        self.height = height
        self._requested_fps = fps
        self.max_frames = max_frames
        self.threaded = threaded
        # Default: mirror webcams (int device), don't mirror video files (str path)
        self.mirror = isinstance(device, int) if mirror is None else mirror
        # Backend: auto-detect per platform for webcams, auto for video files
        if backend is not None:
            self._backend = backend
        elif isinstance(device, int):
            self._backend = _preferred_backend()
        else:
            self._backend = 0  # video files: let OpenCV auto-detect
        self._cap: Optional[cv2.VideoCapture] = None
        self._frame_count = 0
        # FPS tracking: rolling window of frame timestamps
        self._frame_times: deque[float] = deque(maxlen=60)
        # Threading state
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._latest_frame: Optional[np.ndarray] = None
        self._frame_ready = threading.Event()

    # ── Context manager ───────────────────────────────────────────────────────

    def __enter__(self) -> "WebcamStream":
        if self._backend:
            self._cap = cv2.VideoCapture(self.device, self._backend)
        else:
            self._cap = cv2.VideoCapture(self.device)
        if not self._cap.isOpened():
            raise RuntimeError(
                f"Cannot open camera device {self.device}. "
                "Check that a webcam is connected and not in use."
            )
        if self.width:
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        if self.height:
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        if self._requested_fps:
            self._cap.set(cv2.CAP_PROP_FPS, self._requested_fps)
        self._frame_count = 0
        self._frame_times.clear()
        if self.threaded:
            self._stop_event.clear()
            self._frame_ready.clear()
            self._latest_frame = None
            self._thread = threading.Thread(
                target=self._reader_loop, daemon=True,
            )
            self._thread.start()
            # Wait for first frame so the caller doesn't get None
            self._frame_ready.wait(timeout=5.0)
        return self

    def __exit__(self, *exc) -> None:
        if self._thread is not None:
            self._stop_event.set()
            self._thread.join(timeout=2.0)
            self._thread = None
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    # ── Background reader (threaded mode) ─────────────────────────────────────

    def _reader_loop(self) -> None:
        """Continuously read frames in background, keeping only the latest."""
        while not self._stop_event.is_set():
            ret, frame = self._cap.read()
            if not ret:
                break
            if self.mirror:
                frame = cv2.flip(frame, 1)
            with self._lock:
                self._latest_frame = frame
            self._frame_ready.set()

    def _grab_latest(self) -> Optional[np.ndarray]:
        """Get the most recent frame from the background reader."""
        with self._lock:
            frame = self._latest_frame
        return frame

    # ── Iterator ──────────────────────────────────────────────────────────────

    def __iter__(self) -> Iterator[np.ndarray]:
        if self._cap is None:
            raise RuntimeError("Use `with WebcamStream() as cam:` to iterate.")

        if self.threaded:
            yield from self._iter_threaded()
        else:
            yield from self._iter_blocking()

    def _iter_blocking(self) -> Iterator[np.ndarray]:
        """Standard blocking read — one cap.read() per iteration."""
        while True:
            if self.max_frames is not None and self._frame_count >= self.max_frames:
                break
            ret, frame = self._cap.read()
            if not ret:
                break
            if self.mirror:
                frame = cv2.flip(frame, 1)
            self._frame_count += 1
            self._frame_times.append(time.monotonic())
            yield frame

    def _iter_threaded(self) -> Iterator[np.ndarray]:
        """Threaded read — always yields the latest frame, never blocks."""
        last_id = id(None)
        while not self._stop_event.is_set():
            if self.max_frames is not None and self._frame_count >= self.max_frames:
                break
            frame = self._grab_latest()
            if frame is None:
                time.sleep(0.001)
                continue
            # Skip if same frame object (no new frame from camera yet)
            frame_id = id(frame)
            if frame_id == last_id:
                time.sleep(0.001)
                continue
            last_id = frame_id
            self._frame_count += 1
            self._frame_times.append(time.monotonic())
            yield frame

    # ── Single read ───────────────────────────────────────────────────────────

    def read(self) -> np.ndarray:
        """Read a single frame (camera must be open via __enter__)."""
        if self._cap is None or not self._cap.isOpened():
            raise RuntimeError("Camera not open. Use the context manager.")

        if self.threaded:
            frame = self._grab_latest()
            if frame is None:
                raise RuntimeError("No frame available from background reader.")
        else:
            ret, frame = self._cap.read()
            if not ret:
                raise RuntimeError("Failed to read frame from camera.")
            if self.mirror:
                frame = cv2.flip(frame, 1)

        self._frame_count += 1
        self._frame_times.append(time.monotonic())
        return frame

    # ── Properties ────────────────────────────────────────────────────────────

    @property
    def frame_count(self) -> int:
        return self._frame_count

    @property
    def fps(self) -> float:
        """
        Measured frames per second (rolling average over last 60 frames).

        Returns 0.0 before the second frame. This is the actual throughput
        of your processing loop, not the requested or hardware FPS.
        """
        if len(self._frame_times) < 2:
            return 0.0
        elapsed = self._frame_times[-1] - self._frame_times[0]
        if elapsed <= 0:
            return 0.0
        return (len(self._frame_times) - 1) / elapsed

    @property
    def resolution(self) -> tuple[int, int]:
        """Return (width, height) of the capture device."""
        if self._cap is None:
            return (0, 0)
        w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        return (w, h)

    @property
    def backend_name(self) -> str:
        """Return the name of the active capture backend."""
        if self._cap is None:
            return "none"
        return self._cap.getBackendName()


# ── Convenience function ──────────────────────────────────────────────────────

def capture_webcam(
    device: int = 0,
    width: Optional[int] = None,
    height: Optional[int] = None,
    mirror: bool = True,
) -> np.ndarray:
    """
    Grab a single frame from the webcam and return it as a BGR numpy array.

    Opens and immediately releases the camera, so this is only suitable
    for one-off captures.  For continuous use, prefer WebcamStream.
    """
    with WebcamStream(device=device, width=width, height=height, max_frames=1, mirror=mirror) as cam:
        return cam.read()
