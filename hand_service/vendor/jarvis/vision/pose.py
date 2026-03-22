"""
pose.py - Hand gesture recognition for JARVIS using MediaPipe Tasks API.

Uses GestureRecognizer from mediapipe.tasks.vision which provides
both 21-point hand landmarks AND built-in gesture classification.
When the built-in model returns low confidence, a custom classifier
runs on the landmarks to catch additional gestures.

Built-in gestures (MediaPipe): Closed_Fist, Open_Palm, Pointing_Up,
                                Thumb_Down, Thumb_Up, Victory, ILoveYou
Custom gestures (fallback):     ok, three, four, rock

All recognized gestures:
  fist, open_palm, pointing, thumbs_down, thumbs_up,
  peace, i_love_you, ok, three, four, rock, unknown

MediaPipe hand landmark order (21 points):
  0-wrist
  1-thumb_cmc, 2-thumb_mcp, 3-thumb_ip, 4-thumb_tip
  5-index_mcp, 6-index_pip, 7-index_dip, 8-index_tip
  9-middle_mcp, 10-middle_pip, 11-middle_dip, 12-middle_tip
  13-ring_mcp, 14-ring_pip, 15-ring_dip, 16-ring_tip
  17-pinky_mcp, 18-pinky_pip, 19-pinky_dip, 20-pinky_tip

Usage
-----
from jarvis.vision.pose import estimate_pose, HandDetector

frame = estimate_pose("photo.jpg")
for hand in frame.objects:
    print(hand.label)              # "Left Hand" or "Right Hand"
    print(hand.keypoints.shape)    # (21, 3) -> x, y, z per landmark
    print(hand.gesture)            # "Thumb_Up", "Victory", etc.
"""
from __future__ import annotations

import logging
import math
import urllib.request
from collections import Counter, deque
from pathlib import Path
from typing import Dict, List, Optional, Union

import cv2
import numpy as np
import mediapipe as mp

from jarvis.core.schema import BoundingBox, DetectedObject, VisionFrame

logger = logging.getLogger(__name__)

# -- MediaPipe Tasks setup --
BaseOptions = mp.tasks.BaseOptions
GestureRecognizer = mp.tasks.vision.GestureRecognizer
GestureRecognizerOptions = mp.tasks.vision.GestureRecognizerOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
RunningMode = mp.tasks.vision.RunningMode

# Model URLs
_GESTURE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "gesture_recognizer/gesture_recognizer/float16/latest/"
    "gesture_recognizer.task"
)
_HAND_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/latest/"
    "hand_landmarker.task"
)

# Default model cache directory
_MODEL_DIR = Path.home() / ".jarvis" / "models"

# Landmark names (21 points)
LANDMARK_NAMES: List[str] = [
    "wrist",
    "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip",
    "index_mcp", "index_pip", "index_dip", "index_tip",
    "middle_mcp", "middle_pip", "middle_dip", "middle_tip",
    "ring_mcp", "ring_pip", "ring_dip", "ring_tip",
    "pinky_mcp", "pinky_pip", "pinky_dip", "pinky_tip",
]

# Friendly gesture name mapping
_GESTURE_MAP = {
    "Closed_Fist":  "fist",
    "Open_Palm":    "open_palm",
    "Pointing_Up":  "pointing",
    "Thumb_Down":   "thumbs_down",
    "Thumb_Up":     "thumbs_up",
    "Victory":      "peace",
    "ILoveYou":     "i_love_you",
    "None":         "unknown",
}

ImageSource = Union[str, Path, np.ndarray]


# -- One Euro Filter (Priority 1) --

class OneEuroFilter:
    """
    Adaptive low-pass filter for real-time noisy signals.

    Smooth when slow (low jitter), responsive when fast (low latency).
    Applied per-hand to the (21, 3) landmark array each frame.

    Reference: Casiez et al., CHI 2012 — "1€ Filter"
    MediaPipe's internal pipeline uses this with min_cutoff=0.1,
    but the Tasks API does not expose it.
    """

    def __init__(
        self,
        min_cutoff: float = 1.0,
        beta: float = 0.007,
        d_cutoff: float = 1.0,
    ) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self._x_prev: Optional[np.ndarray] = None
        self._dx_prev: Optional[np.ndarray] = None
        self._t_prev: Optional[float] = None

    def __call__(self, t: float, x: np.ndarray) -> np.ndarray:
        if self._t_prev is None:
            self._x_prev = x.copy()
            self._dx_prev = np.zeros_like(x)
            self._t_prev = t
            return x

        t_e = t - self._t_prev
        if t_e <= 1e-9:
            return self._x_prev

        a_d = self._alpha(t_e, self.d_cutoff)
        dx = (x - self._x_prev) / t_e
        dx_hat = a_d * dx + (1 - a_d) * self._dx_prev

        cutoff = self.min_cutoff + self.beta * np.abs(dx_hat)
        a = self._alpha(t_e, cutoff)
        x_hat = a * x + (1 - a) * self._x_prev

        self._x_prev = x_hat
        self._dx_prev = dx_hat
        self._t_prev = t
        return x_hat

    def reset(self) -> None:
        self._x_prev = None
        self._dx_prev = None
        self._t_prev = None

    @staticmethod
    def _alpha(t_e: float, cutoff) -> np.ndarray:
        r = 2 * np.pi * cutoff * t_e
        return r / (r + 1)


# -- Model download helper (Priority 4: atomic download) --

def _ensure_model(url: str, filename: str) -> str:
    """Download model if not cached. Returns local file path."""
    _MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = _MODEL_DIR / filename

    if model_path.exists():
        return str(model_path)

    tmp_path = model_path.with_suffix(".tmp")
    logger.info("Downloading %s...", filename)
    try:
        urllib.request.urlretrieve(url, str(tmp_path))
        tmp_path.rename(model_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    logger.info("Saved to %s", model_path)
    return str(model_path)


class HandDetector:
    """
    MediaPipe Tasks hand detector with gesture recognition.

    Uses GestureRecognizer for combined landmark + gesture detection,
    or falls back to HandLandmarker if gesture model fails.

    Parameters
    ----------
    max_num_hands             : maximum hands to detect (default 2).
    min_detection_confidence  : minimum confidence for hand detection.
    min_tracking_confidence   : minimum confidence for hand tracking.
    use_gesture_recognizer    : if True, use GestureRecognizer (landmarks + gestures).
                                if False, use HandLandmarker (landmarks only).
    """

    def __init__(
        self,
        max_num_hands: int = 2,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
        use_gesture_recognizer: bool = True,
        static_image_mode: bool = True,
        smooth_landmarks: bool = True,
    ) -> None:
        self.max_num_hands = max_num_hands
        self.min_detection_confidence = min_detection_confidence
        self.min_tracking_confidence = min_tracking_confidence
        self._use_gestures = use_gesture_recognizer
        self._static = static_image_mode
        self._smooth = smooth_landmarks and not static_image_mode
        self._recognizer = None
        self._landmarker = None
        self._filters: Dict[str, OneEuroFilter] = {}

    def _get_filter(self, label: str) -> OneEuroFilter:
        if label not in self._filters:
            self._filters[label] = OneEuroFilter(
                min_cutoff=1.0, beta=0.007, d_cutoff=1.0,
            )
        return self._filters[label]

    def _smooth_keypoints(
        self, label: str, keypoints: np.ndarray, timestamp_ms: int,
    ) -> np.ndarray:
        """Apply One Euro Filter if smoothing is enabled (VIDEO mode)."""
        if not self._smooth:
            return keypoints
        filt = self._get_filter(label)
        t = timestamp_ms / 1000.0
        return filt(t, keypoints).astype(np.float32)

    def _init_gesture_recognizer(self) -> None:
        """Initialize GestureRecognizer (landmarks + gestures)."""
        model_path = _ensure_model(_GESTURE_MODEL_URL, "gesture_recognizer.task")
        mode = RunningMode.IMAGE if self._static else RunningMode.VIDEO

        options = GestureRecognizerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=mode,
            num_hands=self.max_num_hands,
            min_hand_detection_confidence=self.min_detection_confidence,
            min_tracking_confidence=self.min_tracking_confidence,
        )
        self._recognizer = GestureRecognizer.create_from_options(options)

    def _init_hand_landmarker(self) -> None:
        """Initialize HandLandmarker (landmarks only, no gestures)."""
        model_path = _ensure_model(_HAND_MODEL_URL, "hand_landmarker.task")
        mode = RunningMode.IMAGE if self._static else RunningMode.VIDEO

        options = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=mode,
            num_hands=self.max_num_hands,
            min_hand_detection_confidence=self.min_detection_confidence,
            min_tracking_confidence=self.min_tracking_confidence,
        )
        self._landmarker = HandLandmarker.create_from_options(options)

    def run(
        self,
        source: ImageSource,
        *,
        source_label: str = "image",
        timestamp_ms: int = 0,
    ) -> VisionFrame:
        """
        Detect hands and classify gestures.

        Returns a VisionFrame with one DetectedObject per hand.
        Each object has:
          - label: "Left Hand" or "Right Hand"
          - confidence: detection score
          - bbox: bounding box around the hand
          - keypoints: (21, 3) ndarray of x, y, z landmark coords (pixels)
          - gesture: classified gesture string

        Parameters
        ----------
        source       : file path or BGR numpy array.
        source_label : "image", "screen", "webcam", or "video".
        timestamp_ms : frame timestamp in ms (needed for VIDEO mode).
        """
        # Load image
        if isinstance(source, (str, Path)):
            image_bgr = cv2.imread(str(source))
            if image_bgr is None:
                raise FileNotFoundError(f"Cannot read image: {source}")
            raw_path = str(source)
        else:
            image_bgr = source
            raw_path = None

        h, w, _ = image_bgr.shape
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

        # Wrap in MediaPipe Image
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)

        # Try gesture recognizer first, fall back to hand landmarker
        if self._use_gestures:
            objects = self._run_gesture_recognizer(mp_image, w, h, timestamp_ms)
        else:
            objects = self._run_hand_landmarker(mp_image, w, h, timestamp_ms)

        return VisionFrame(
            source=source_label,
            objects=objects,
            raw_path=raw_path,
        )

    def _run_gesture_recognizer(
        self, mp_image: mp.Image, w: int, h: int, timestamp_ms: int,
    ) -> List[DetectedObject]:
        """Run GestureRecognizer: returns landmarks + gesture labels."""
        if self._recognizer is None:
            try:
                self._init_gesture_recognizer()
            except Exception:
                # Fall back to hand landmarker
                self._use_gestures = False
                return self._run_hand_landmarker(mp_image, w, h, timestamp_ms)

        # Detect
        try:
            if self._static:
                result = self._recognizer.recognize(mp_image)
            else:
                result = self._recognizer.recognize_for_video(mp_image, timestamp_ms)
        except RuntimeError:
            # Known MediaPipe bug in VIDEO mode - recreate recognizer
            try:
                self._recognizer.close()
            except Exception:
                pass
            self._recognizer = None
            self._init_gesture_recognizer()
            return []

        objects: List[DetectedObject] = []

        if not result.hand_landmarks:
            return objects

        for i, hand_landmarks in enumerate(result.hand_landmarks):
            # Handedness
            if result.handedness and i < len(result.handedness):
                hand_info = result.handedness[i][0]
                label = f"{hand_info.category_name} Hand"
                confidence = hand_info.score
                is_right = hand_info.category_name == "Right"
            else:
                label = "Hand"
                confidence = 0.5
                is_right = True

            # Convert landmarks to pixel coordinates FIRST: (21, 3)
            keypoints = np.array([
                [lm.x * w, lm.y * h, lm.z]
                for lm in hand_landmarks
            ], dtype=np.float32)

            # Priority 1: smooth landmarks
            keypoints = self._smooth_keypoints(label, keypoints, timestamp_ms)

            # Bounding box from landmarks
            bbox = _bbox_from_keypoints(keypoints, w, h)

            # Gesture: use built-in first, fallback to custom classifier
            gesture = "unknown"
            used_builtin = False
            if result.gestures and i < len(result.gestures):
                top_gesture = result.gestures[i][0]
                raw_name = top_gesture.category_name
                gesture_score = top_gesture.score
                mapped = _GESTURE_MAP.get(raw_name, raw_name.lower())
                if mapped != "unknown" and gesture_score > 0.5:
                    gesture = mapped
                    used_builtin = True

            # If built-in didn't recognize, use custom classifier
            if not used_builtin:
                gesture = classify_gesture(keypoints, is_right=is_right)

            objects.append(DetectedObject(
                label=label,
                confidence=confidence,
                bbox=bbox,
                keypoints=keypoints,
                gesture=gesture,
            ))

        return objects

    def _run_hand_landmarker(
        self, mp_image: mp.Image, w: int, h: int, timestamp_ms: int,
    ) -> List[DetectedObject]:
        """Run HandLandmarker: returns landmarks only (no gestures)."""
        if self._landmarker is None:
            self._init_hand_landmarker()

        # Detect
        try:
            if self._static:
                result = self._landmarker.detect(mp_image)
            else:
                result = self._landmarker.detect_for_video(mp_image, timestamp_ms)
        except RuntimeError:
            try:
                self._landmarker.close()
            except Exception:
                pass
            self._landmarker = None
            self._init_hand_landmarker()
            return []

        objects: List[DetectedObject] = []

        if not result.hand_landmarks:
            return objects

        for i, hand_landmarks in enumerate(result.hand_landmarks):
            # Handedness
            if result.handedness and i < len(result.handedness):
                hand_info = result.handedness[i][0]
                label = f"{hand_info.category_name} Hand"
                confidence = hand_info.score
                is_right = hand_info.category_name == "Right"
            else:
                label = "Hand"
                confidence = 0.5
                is_right = True

            # Convert landmarks to pixel coordinates
            keypoints = np.array([
                [lm.x * w, lm.y * h, lm.z]
                for lm in hand_landmarks
            ], dtype=np.float32)

            # Priority 1: smooth landmarks
            keypoints = self._smooth_keypoints(label, keypoints, timestamp_ms)

            bbox = _bbox_from_keypoints(keypoints, w, h)

            # Classify gesture from landmarks (fallback logic)
            gesture = classify_gesture(keypoints, is_right=is_right)

            objects.append(DetectedObject(
                label=label,
                confidence=confidence,
                bbox=bbox,
                keypoints=keypoints,
                gesture=gesture,
            ))

        return objects

    def close(self) -> None:
        """Release MediaPipe resources."""
        try:
            if self._recognizer is not None:
                self._recognizer.close()
        except Exception:
            pass
        finally:
            self._recognizer = None

        try:
            if self._landmarker is not None:
                self._landmarker.close()
        except Exception:
            pass
        finally:
            self._landmarker = None

        self._filters.clear()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass


# -- Gesture classification (fallback when using HandLandmarker) --
# Priority 2: angle-based finger detection (rotation invariant)
# Priority 3: handedness-aware thumb check

# Finger tip and pip indices
_TIPS = [4, 8, 12, 16, 20]
_PIPS = [3, 6, 10, 14, 18]

# Finger joint chains for angle computation
_FINGER_JOINTS = {
    "thumb":  (1, 2, 3, 4),
    "index":  (5, 6, 7, 8),
    "middle": (9, 10, 11, 12),
    "ring":   (13, 14, 15, 16),
    "pinky":  (17, 18, 19, 20),
}

_CURL_THRESHOLD = 140.0       # degrees (180 = fully straight)
_THUMB_CURL_THRESHOLD = 135.0 # lower than other fingers — thumb IP joint has less range
_THUMB_HYST_HIGH = 138.0      # must exceed this to transition curled → extended
_THUMB_HYST_LOW = 132.0       # must drop below this to transition extended → curled

# Per-hand thumb state for hysteresis (survives across frames)
_thumb_extended_state: Dict[str, bool] = {}


def _joint_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """
    Angle at point b formed by vectors b->a and b->c, in degrees.
    Uses all 3 coordinates for rotation invariance.

    Pure math for performance — called 5x per hand per frame.
    """
    v1x, v1y, v1z = float(a[0] - b[0]), float(a[1] - b[1]), float(a[2] - b[2])
    v2x, v2y, v2z = float(c[0] - b[0]), float(c[1] - b[1]), float(c[2] - b[2])
    dot = v1x * v2x + v1y * v2y + v1z * v2z
    m1 = math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z)
    m2 = math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z)
    cross = m1 * m2
    if cross < 1e-8:
        return 180.0
    cos = max(-1.0, min(1.0, dot / cross))
    return math.degrees(math.acos(cos))


def classify_gesture(
    keypoints: np.ndarray, *, is_right: bool = True,
) -> str:
    """
    Classify a hand gesture from 21 landmarks.

    This is the fallback classifier used when GestureRecognizer returns
    "None" or low confidence.  Covers gestures the built-in model misses.

    Supported gestures:
      thumbs_up, thumbs_down, open_palm, fist, peace,
      pointing, rock, three, four, ok, unknown
    """
    if keypoints.shape != (21, 3):
        return "unknown"

    fingers_up = _fingers_extended(keypoints, is_right=is_right)
    thumb, index, middle, ring, pinky = fingers_up
    total = sum(fingers_up)

    # Hand size reference: distance from wrist to middle_mcp
    diff = keypoints[0, :2] - keypoints[9, :2]
    hand_size = math.sqrt(float(diff[0])**2 + float(diff[1])**2)
    if hand_size < 1:
        return "unknown"

    # OK sign: thumb tip and index tip close together, other fingers extended
    thumb_tip = keypoints[4]
    index_tip = keypoints[8]
    td = thumb_tip[:2] - index_tip[:2]
    tip_distance = math.sqrt(float(td[0])**2 + float(td[1])**2)
    if tip_distance < hand_size * 0.3 and middle and ring and pinky:
        return "ok"

    if total == 0:
        return "fist"
    if total == 5:
        return "open_palm"

    # Thumbs up/down: only thumb extended
    if thumb and total == 1:
        wrist_y = keypoints[0, 1]
        thumb_tip_y = keypoints[4, 1]
        return "thumbs_up" if thumb_tip_y < wrist_y else "thumbs_down"

    # Pointing: only index extended
    if index and total == 1:
        return "pointing"

    # Peace / victory: index + middle
    if index and middle and total == 2:
        return "peace"

    # Rock / ILoveYou: index + pinky
    if index and pinky and total == 2:
        return "rock"

    # Three: index + middle + ring (thumb can be ambiguous, so check 3 or 4)
    if index and middle and ring and not pinky:
        return "three"

    # Four: index + middle + ring + pinky (no thumb)
    if index and middle and ring and pinky and not thumb:
        return "four"

    return "unknown"


def _fingers_extended(
    keypoints: np.ndarray, **_kwargs,
) -> List[bool]:
    """
    Determine which fingers are extended: [thumb, index, middle, ring, pinky].

    Uses joint angles (rotation invariant) instead of y-coordinate comparison.
    Thumb uses IP joint angle with hysteresis to prevent flickering
    between four/open_palm at the boundary (~133-138°).
    """
    # Thumb: angle at IP joint with hysteresis
    t = _FINGER_JOINTS["thumb"]
    thumb_angle = _joint_angle(keypoints[t[1]], keypoints[t[2]], keypoints[t[3]])

    # Hysteresis: use wrist position as rough hand key
    wx, wy = int(keypoints[0, 0]) // 50, int(keypoints[0, 1]) // 50
    hand_key = f"{wx},{wy}"
    was_extended = _thumb_extended_state.get(hand_key, False)

    if was_extended:
        # Currently extended — stay extended until drops below low threshold
        thumb_extended = thumb_angle > _THUMB_HYST_LOW
    else:
        # Currently curled — stay curled until rises above high threshold
        thumb_extended = thumb_angle > _THUMB_HYST_HIGH

    _thumb_extended_state[hand_key] = thumb_extended

    # Other fingers: angle at PIP joint
    fingers = [thumb_extended]
    for name in ("index", "middle", "ring", "pinky"):
        joints = _FINGER_JOINTS[name]
        angle = _joint_angle(
            keypoints[joints[0]], keypoints[joints[1]], keypoints[joints[2]],
        )
        fingers.append(angle > _CURL_THRESHOLD)

    return fingers


# -- Helpers --

def _bbox_from_keypoints(
    keypoints: np.ndarray, img_w: int, img_h: int, padding: int = 20,
) -> BoundingBox:
    """Compute bounding box from (21, 3) keypoint array."""
    x_coords = keypoints[:, 0]
    y_coords = keypoints[:, 1]
    return BoundingBox(
        x1=max(0, float(x_coords.min()) - padding),
        y1=max(0, float(y_coords.min()) - padding),
        x2=min(img_w, float(x_coords.max()) + padding),
        y2=min(img_h, float(y_coords.max()) + padding),
    )


def keypoints_to_description(keypoints: np.ndarray) -> str:
    """Convert (21, 3) hand landmarks to a human-readable string for the LLM."""
    if keypoints.size == 0:
        return "No hand landmarks detected."
    parts: List[str] = []
    for idx, name in enumerate(LANDMARK_NAMES):
        if idx < len(keypoints):
            x, y = int(keypoints[idx, 0]), int(keypoints[idx, 1])
            parts.append(f"{name}=({x},{y})")
    return ", ".join(parts)


# -- Gesture temporal smoothing (Priority 6) --

class GestureStabilizer:
    """
    Smooth static gesture classification via majority vote over a sliding window.
    Prevents single-frame misclassifications from propagating.

    Usage
    -----
    stabilizer = GestureStabilizer(window=5)
    for frame in stream:
        for hand in frame.objects:
            hand.gesture = stabilizer.smooth(hand.label, hand.gesture)
    """

    def __init__(self, window: int = 5) -> None:
        self._window = window
        self._history: Dict[str, deque] = {}

    def smooth(self, label: str, gesture: str) -> str:
        if label not in self._history:
            self._history[label] = deque(maxlen=self._window)
        self._history[label].append(gesture)
        counts = Counter(self._history[label])
        return counts.most_common(1)[0][0]

    def clear(self, label: Optional[str] = None) -> None:
        if label:
            self._history.pop(label, None)
        else:
            self._history.clear()


# -- Singleton convenience --
_default: Optional[HandDetector] = None


def _get_default() -> HandDetector:
    global _default
    if _default is None:
        _default = HandDetector()
    return _default


def estimate_pose(
    source: ImageSource,
    *,
    source_label: str = "image",
) -> VisionFrame:
    """
    One-shot hand detection + gesture classification.

    Lazily downloads the model and creates the detector on first call.
    """
    return _get_default().run(source, source_label=source_label)


# -- Motion gesture tracking --


class _HandState:
    """All per-hand tracking state bundled into one object.

    Adding a new field here is all you need — cleanup is automatic
    because deleting the _HandState instance deletes everything.
    """
    __slots__ = (
        "positions", "hand_size", "hand_size_stable", "last_centroid",
        "pinch_raw", "pinch_norm", "pinch_state", "pinch_history",
        "finger_history", "orientation_history",
        "grab_cooldown_until", "first_seen_ms", "init_pinch_lock",
        "drag_palm_prev", "drag_index_prev", "drag_state",
        "last_grab_reject", "last_finger_signal",
        "last_orient_flip_ms",
        # Scroll tracking
        "scroll_tip_history",
        "is_scrolling",
        # Tap tracking
        "tap_pinch_close_ms",
    )

    def __init__(self, history_length: int = 30) -> None:
        self.positions: deque = deque(maxlen=history_length)
        self.hand_size: float = 50.0
        self.hand_size_stable: float = 50.0
        self.last_centroid: tuple = (0.0, 0.0)
        self.pinch_raw: float = 0.0
        self.pinch_norm: float = 0.5
        self.pinch_state: str = "neutral"
        self.pinch_history: deque = deque(maxlen=history_length)
        self.finger_history: deque = deque(maxlen=history_length)
        self.orientation_history: deque = deque(maxlen=history_length)
        self.grab_cooldown_until: float = 0.0
        self.first_seen_ms: float = 0.0
        self.init_pinch_lock: bool = True
        self.drag_palm_prev: tuple = (0.0, 0.0)
        self.drag_index_prev: tuple = (0.0, 0.0)
        self.drag_state: Optional["DragState"] = None
        self.last_grab_reject: str = ""
        self.last_finger_signal: tuple = (0.0, 0.0, 0.0, 0.0)
        self.last_orient_flip_ms: float = -1000.0  # long ago
        # Scroll: midpoint of index+middle tips over time
        self.scroll_tip_history: deque = deque(maxlen=history_length)
        self.is_scrolling: bool = False
        # Tap: timestamp when pinch last closed
        self.tap_pinch_close_ms: float = 0.0


class MotionTracker:
    """
    Tracks hand position over time to detect motion gestures.

    Supported gestures:
      - grab / release (all fingers closing/opening)
      - pinch_in / pinch_out (discrete, thumb+index only)
      - drag (continuous position tracking while grabbed)
      - scroll_up / scroll_down (peace sign + vertical movement)
      - tap (quick pinch close→open, held <300ms)

    Interaction model:
      Open hand → idle
      Grab      → fires "grab", enters drag mode
      Drag      → continuous (x, y) + deltas for palm and index tip
      Release   → fires "release", exits drag mode
      Pinch     → independent zoom/scale control
      Peace + move up/down → fires "scroll_up" / "scroll_down"
      Quick pinch→release  → fires "tap" (held <300ms = click)

    Continuous APIs:
      get_pinch_value(label)  → 0.0 (closed) to 1.0 (open)
      get_drag_state(label)   → DragState with positions + deltas, or None
      is_dragging(label)      → bool
      get_scroll_delta(label) → float (negative=up, positive=down), or None

    Design:
      - All thresholds hand-size-relative (camera distance invariant)
      - All temporal checks timestamp-based (framerate invariant)
      - Grab/release: middle/ring/pinky trend, separated from pinch
      - Pinch: hysteresis bands with grab suppression
      - Drag: activated on grab, deactivated on release

    Usage
    -----
    motion = MotionTracker()

    with WebcamStream(device=0) as cam:
        for ts_ms, img in cam:
            frame = detector.run(img, timestamp_ms=ts_ms)
            gestures = motion.update(frame.objects, timestamp_ms=ts_ms)

            # Discrete events
            for label, gesture in gestures.items():
                if gesture == "grab":
                    print(f"{label}: selected!")
                elif gesture == "release":
                    print(f"{label}: deselected!")

            # Continuous drag
            for hand in frame.objects:
                drag = motion.get_drag_state(hand.label)
                if drag is not None:
                    print(f"palm=({drag.palm_x:.0f},{drag.palm_y:.0f}) "
                          f"dx={drag.palm_dx:.1f} dy={drag.palm_dy:.1f}")
                    print(f"index=({drag.index_x:.0f},{drag.index_y:.0f}) "
                          f"dx={drag.index_dx:.1f} dy={drag.index_dy:.1f}")

            # Continuous pinch
            for hand in frame.objects:
                val = motion.get_pinch_value(hand.label)
                if val is not None:
                    print(f"{hand.label} pinch: {val:.2f}")
    """

    # Pinch states (discrete mode)
    _PINCH_NEUTRAL = "neutral"
    _PINCH_CLOSED = "closed"
    _PINCH_OPENED = "opened"

    def __init__(
        self,
        history_length: int = 30,
        # Pinch (already normalized 0-1)
        pinch_close_threshold: float = 0.3,
        pinch_open_threshold: float = 0.7,
        pinch_reset_threshold: float = 0.5,
        # Grab (hand-size-relative + timestamp-based)
        grab_threshold: float = 0.25,
        grab_window_ms: float = 600.0,
        grab_cooldown_ms: float = 400.0,
        # Stillness (hand-size-relative)
        still_threshold: float = 0.3,
        still_window_ms: float = 200.0,
        # Stabilization
        warmup_ms: float = 500.0,
        # Pinch suppression window
        pinch_suppress_ms: float = 130.0,
        # Drag
        drag_deadzone: float = 1.5,
        # Release guard: multiplier on grab_threshold for release during drag
        release_guard_multiplier: float = 1.1,
        # Grace period: keep _dragging alive when hand disappears briefly
        persistence_ms: float = 800.0,
        # Scroll (peace sign + vertical movement)
        scroll_window_ms: float = 400.0,
        scroll_threshold: float = 0.15,
        scroll_min_frames: int = 3,
        # Tap (quick pinch: held less than this = tap, more = real pinch)
        tap_window_ms: float = 300.0,
    ) -> None:
        self.history_length = history_length
        self.pinch_close = pinch_close_threshold
        self.pinch_open = pinch_open_threshold
        self.pinch_reset = pinch_reset_threshold
        self.grab_threshold = grab_threshold
        self.grab_window_ms = grab_window_ms
        self.grab_cooldown_ms = grab_cooldown_ms
        self.still_threshold = still_threshold
        self.still_window_ms = still_window_ms
        self.warmup_ms = warmup_ms
        self.pinch_suppress_ms = pinch_suppress_ms
        self.drag_deadzone = drag_deadzone
        self.release_guard_multiplier = release_guard_multiplier
        self.persistence_ms = persistence_ms
        self.scroll_window_ms = scroll_window_ms
        self.scroll_threshold = scroll_threshold
        self.scroll_min_frames = scroll_min_frames
        self.tap_window_ms = tap_window_ms

        # Auto-timestamp fallback (~30fps)
        self._auto_ts: float = 0.0

        # Per-hand state (all tracking data bundled per hand)
        self._hands: Dict[str, _HandState] = {}

        # These two survive hand disappearance (for drag persistence),
        # so they live outside _HandState.
        self._dragging: Dict[str, bool] = {}
        self._drag_persist_until: Dict[str, float] = {}

    # -- Helper: time-windowed recent entries --

    @staticmethod
    def _recent(history, now_ms: float, window_ms: float) -> list:
        """Get entries where timestamp (last element) is within [now - window, now].

        Scans from the right since deque entries are in chronological order,
        so all recent entries are at the end — stop as soon as we hit an old one.
        """
        cutoff = now_ms - window_ms
        result = []
        for e in reversed(history):
            if e[-1] >= cutoff:
                result.append(e)
            else:
                break
        result.reverse()
        return result

    def _lock_pinch_to_current(self, h: _HandState) -> None:
        """Lock pinch state to current hand position to prevent misfires."""
        pn = h.pinch_norm
        if pn < self.pinch_close:
            h.pinch_state = self._PINCH_CLOSED
        elif pn > self.pinch_open:
            h.pinch_state = self._PINCH_OPENED

    def _reset_hand_state(self, label: str) -> None:
        """Fully clear all tracking and gesture state for a specific hand."""
        self._hands.pop(label, None)

    def update(
        self,
        hands: List[DetectedObject],
        timestamp_ms: float = 0.0,
    ) -> Dict[str, str]:
        """
        Feed detected hands from one frame.

        Parameters
        ----------
        hands        : list of DetectedObject from HandDetector.
        timestamp_ms : frame timestamp in ms. If 0, auto-increments at ~30fps.

        Returns dict of discrete gesture events:
          {"Left Hand": "grab", "Right Hand": "pinch_in", ...}
        Empty if no gesture detected this frame.

        Also updates continuous drag state (access via get_drag_state).
        """
        if timestamp_ms <= 0:
            self._auto_ts += 33.3
            timestamp_ms = self._auto_ts
        else:
            self._auto_ts = timestamp_ms

        now = timestamp_ms
        results: Dict[str, str] = {}
        active_labels = set()

        for hand in hands:
            if hand.keypoints is None:
                continue

            label = hand.label
            active_labels.add(label)
            kps = hand.keypoints

            # Palm center (all 3 coords in one operation)
            palm_indices = [0, 5, 9, 13, 17]
            palm_3d = kps[palm_indices].mean(axis=0)
            px, py, pz = float(palm_3d[0]), float(palm_3d[1]), float(palm_3d[2])

            # IDENTITY VERIFICATION: If the centroid jumped more than 2.5×
            # hand-size since last frame, MediaPipe probably swapped which
            # physical hand owns this label.  Reset so stale state doesn't
            # bleed across hands.
            h = self._hands.get(label)
            if h is not None:
                lx, ly = h.last_centroid
                hs_ref = h.hand_size
                if math.hypot(px - lx, py - ly) > hs_ref * 2.5:
                    self._reset_hand_state(label)
                    h = None

            # Index fingertip
            ix = float(kps[8][0])
            iy = float(kps[8][1])

            # Initialize tracking for new hands
            if h is None:
                persisted_drag = self._dragging.get(label, False)
                h = _HandState(history_length=self.history_length)
                self._hands[label] = h
                h.pinch_state = self._PINCH_NEUTRAL
                h.init_pinch_lock = True
                if not persisted_drag:
                    self._dragging[label] = False
                else:
                    # Hand came back while drag persisted — clear the timer
                    self._drag_persist_until.pop(label, None)
                h.grab_cooldown_until = 0.0
                # If drag persisted, backdate first_seen so warmup is skipped
                # and release detection works immediately
                h.first_seen_ms = (
                    now - self.warmup_ms if persisted_drag else now
                )
                # Snap prev positions to current so first delta is zero
                h.drag_palm_prev = (px, py)
                h.drag_index_prev = (ix, iy)

            h.last_centroid = (px, py)
            h.positions.append((px, py, now))

            # Hand size (wrist to middle_mcp)
            hand_size = math.hypot(
                float(kps[0][0]) - float(kps[9][0]),
                float(kps[0][1]) - float(kps[9][1]),
            )
            h.hand_size = max(hand_size, 1.0)
            hs = h.hand_size

            # Stable hand size: slow EMA that tracks the "normal" size.
            prev_stable = h.hand_size_stable
            if hs >= prev_stable * 0.8:
                h.hand_size_stable = prev_stable * 0.85 + hs * 0.15

            # -- Pinch distance + normalization --
            raw_dist = math.hypot(
                float(kps[4][0]) - float(kps[8][0]),
                float(kps[4][1]) - float(kps[8][1]),
            )
            h.pinch_raw = raw_dist
            h.pinch_history.append((raw_dist, now))
            norm = min(1.0, max(0.0, raw_dist / (hs * 1.2)))
            h.pinch_norm = norm

            # Lock pinch state on first appearance
            if h.init_pinch_lock:
                h.init_pinch_lock = False
                self._lock_pinch_to_current(h)

            # -- Non-pinch finger tracking (middle=12, ring=16, pinky=20) --
            palm_center_3d = palm_3d
            finger_tips = kps[[12, 16, 20]]
            diffs = finger_tips - palm_center_3d
            dists = np.sqrt((diffs * diffs).sum(axis=1))
            mid_dist, ring_dist, pinky_dist = float(dists[0]), float(dists[1]), float(dists[2])
            h.finger_history.append((mid_dist, ring_dist, pinky_dist, now))

            # -- Track palm orientation (front vs back) for flip detection --
            is_backhand = self._is_backhand(kps)
            h.orientation_history.append((is_backhand, now))

            # Record flip timestamp when orientation changes
            if len(h.orientation_history) >= 2:
                prev_orient = h.orientation_history[-2][0]
                if prev_orient != is_backhand:
                    h.last_orient_flip_ms = now

            # Suppress drag deltas for 300ms after any orientation flip.
            # Landmarks settle over 5-15 frames after a front↔back transition.
            orient_unstable = (now - h.last_orient_flip_ms) < 300.0

            # -- Update drag state --
            if self._dragging.get(label, False):
                prev_palm = h.drag_palm_prev
                prev_index = h.drag_index_prev

                palm_dx = px - prev_palm[0]
                palm_dy = py - prev_palm[1]
                index_dx = ix - prev_index[0]
                index_dy = iy - prev_index[1]

                # Orientation flip window: zero deltas while landmarks settle
                if orient_unstable:
                    palm_dx, palm_dy = 0.0, 0.0
                    index_dx, index_dy = 0.0, 0.0

                # Deadzone: zero out tiny deltas (jitter)
                dz = self.drag_deadzone
                if math.hypot(palm_dx, palm_dy) < dz:
                    palm_dx, palm_dy = 0.0, 0.0
                if math.hypot(index_dx, index_dy) < dz:
                    index_dx, index_dy = 0.0, 0.0

                h.drag_state = DragState(
                    palm_x=px, palm_y=py,
                    palm_dx=palm_dx, palm_dy=palm_dy,
                    index_x=ix, index_y=iy,
                    index_dx=index_dx, index_dy=index_dy,
                )
                # When deltas are zeroed (flip suppression), prev stays put
                # so the deficit accumulates and catches up next frame.
                # When deltas pass through, prev advances to raw position.
                h.drag_palm_prev = (
                    prev_palm[0] + palm_dx,
                    prev_palm[1] + palm_dy,
                )
                h.drag_index_prev = (
                    prev_index[0] + index_dx,
                    prev_index[1] + index_dy,
                )
            else:
                h.drag_state = None

            # -- Track scroll tip position (midpoint of index + middle tips) --
            middle_tip_x = float(kps[12][0])
            middle_tip_y = float(kps[12][1])
            scroll_mx = (ix + middle_tip_x) / 2
            scroll_my = (iy + middle_tip_y) / 2
            h.scroll_tip_history.append((scroll_mx, scroll_my, now))

            # -- Check gestures --
            if len(h.positions) < 3:
                continue

            # 0. Scroll check — BEFORE stillness gate (scroll requires movement)
            #    Peace sign (index + middle up, others down) + vertical movement
            if not self._dragging.get(label, False):
                is_right = "Right" in label
                scroll = self._check_scroll(h, now, hs, kps, is_right=is_right)
                h.is_scrolling = scroll is not None
                if scroll:
                    results[label] = scroll
                    continue
            else:
                h.is_scrolling = False

            # 1. Hand must be still for pinch/grab (hand-size-relative)
            recent_pos = self._recent(h.positions, now, self.still_window_ms)
            if len(recent_pos) >= 2:
                palm_move = math.hypot(
                    recent_pos[-1][0] - recent_pos[0][0],
                    recent_pos[-1][1] - recent_pos[0][1],
                )
                if palm_move / hs > self.still_threshold:
                    continue

            # 2. Grab/release (checked before pinch)
            elapsed = now - h.first_seen_ms
            if elapsed < self.warmup_ms:
                pinch = self._update_pinch_discrete(h, norm, now)
                if pinch:
                    results[label] = pinch
                continue

            # Suppress grab when hand is partially off-screen
            stable_hs = h.hand_size_stable
            if stable_hs > 0 and hs / stable_hs < 0.65:
                pinch = self._update_pinch_discrete(h, norm, now)
                if pinch:
                    results[label] = pinch
                continue

            grab = self._check_grab(h, label, now, hs, kps)
            if grab:
                results[label] = grab
                h.finger_history.clear()
                if grab == "grab":
                    h.pinch_state = self._PINCH_CLOSED
                    self._dragging[label] = True
                    h.drag_palm_prev = (px, py)
                    h.drag_index_prev = (ix, iy)
                    h.drag_state = DragState(
                        palm_x=px, palm_y=py, palm_dx=0, palm_dy=0,
                        index_x=ix, index_y=iy, index_dx=0, index_dy=0,
                    )
                else:  # release
                    h.pinch_state = self._PINCH_OPENED
                    self._dragging[label] = False
                    h.drag_state = None
                h.grab_cooldown_until = now + self.grab_cooldown_ms
                continue

            # 3. Pinch discrete (hysteresis)
            pinch = self._update_pinch_discrete(h, norm, now)
            if pinch:
                # Tap detection: pinch_in → pinch_out where hold time < 200ms
                # Quick twitch = tap, deliberate hold = real pinch cycle
                if pinch == "pinch_in":
                    h.tap_pinch_close_ms = now
                elif pinch == "pinch_out" and h.tap_pinch_close_ms > 0:
                    hold_ms = now - h.tap_pinch_close_ms
                    if hold_ms < self.tap_window_ms:
                        pinch = "tap"
                    h.tap_pinch_close_ms = 0.0
                results[label] = pinch

        # Clean up disappeared hands.
        for tracked_label in list(self._hands.keys()):
            if tracked_label not in active_labels:
                was_dragging = self._dragging.get(tracked_label, False)
                self._reset_hand_state(tracked_label)
                if was_dragging:
                    self._dragging[tracked_label] = True
                    self._drag_persist_until[tracked_label] = now + self.persistence_ms

        # Expire stale drag persistence timers
        for label in list(self._drag_persist_until.keys()):
            if now > self._drag_persist_until[label]:
                self._dragging.pop(label, None)
                self._drag_persist_until.pop(label, None)

        return results

    # -- Continuous APIs --

    def get_pinch_value(self, label: str) -> Optional[float]:
        """
        Get normalized pinch distance (0.0 = closed, 1.0 = open).
        Returns None if hand not tracked.
        """
        h = self._hands.get(label)
        return h.pinch_norm if h is not None else None

    def get_all_pinch_values(self) -> Dict[str, float]:
        return {label: h.pinch_norm for label, h in self._hands.items()}

    def is_dragging(self, label: str) -> bool:
        """Check if a hand is currently in drag mode (grabbed)."""
        return self._dragging.get(label, False)

    def get_drag_state(self, label: str) -> Optional["DragState"]:
        """
        Get current drag position and deltas for a hand.

        Returns DragState with:
          palm_x, palm_y     : palm center position (pixels)
          palm_dx, palm_dy   : palm delta since last frame
          index_x, index_y   : index fingertip position (pixels)
          index_dx, index_dy : index fingertip delta since last frame

        Returns None if hand is not dragging.
        """
        h = self._hands.get(label)
        return h.drag_state if h is not None else None

    def get_all_drag_states(self) -> Dict[str, "DragState"]:
        return {
            label: h.drag_state
            for label, h in self._hands.items()
            if h.drag_state is not None
        }

    def get_scroll_delta(self, label: str) -> Optional[float]:
        """
        Get the current scroll velocity for a hand.

        Returns a float representing vertical scroll speed:
          negative = scrolling up (hand moving up)
          positive = scrolling down (hand moving down)

        Returns None if hand is not in scroll pose (peace sign)
        or not tracked.  Value is normalized by hand size.
        """
        h = self._hands.get(label)
        if h is None:
            return None
        if not h.is_scrolling:
            return None
        if not h.scroll_tip_history:
            return None
        recent = self._recent(h.scroll_tip_history, h.scroll_tip_history[-1][-1], self.scroll_window_ms)
        if len(recent) < self.scroll_min_frames:
            return None
        dy = recent[-1][1] - recent[0][1]
        hs = h.hand_size
        if hs < 1:
            return None
        norm_dy = dy / hs
        if abs(norm_dy) < self.scroll_threshold:
            return None
        return norm_dy

    # -- Scroll detection --

    def _check_scroll(
        self, h: _HandState, now: float, hs: float, kps: np.ndarray,
        is_right: bool = True,
    ) -> Optional[str]:
        """
        Detect scroll gesture: peace sign + sustained vertical movement.

        Peace sign = index + middle extended, thumb + ring + pinky curled.
        Scroll direction determined by vertical delta of index+middle
        midpoint over scroll_window_ms.

        Returns "scroll_up" or "scroll_down", or None.
        """
        # Check peace sign pose
        fingers = _fingers_extended(kps, is_right=is_right)
        thumb, index, middle, ring, pinky = fingers

        # Peace sign: index + middle up, ring + pinky down (thumb ignored)
        if not (index and middle and not ring and not pinky):
            return None

        # Need enough history
        recent = self._recent(h.scroll_tip_history, now, self.scroll_window_ms)
        if len(recent) < self.scroll_min_frames:
            return None

        # Vertical delta (positive = moving down in screen coords)
        dy = recent[-1][1] - recent[0][1]
        norm_dy = dy / hs

        if abs(norm_dy) < self.scroll_threshold:
            return None

        return "scroll_down" if norm_dy > 0 else "scroll_up"

    # -- Pinch discrete (hysteresis) --

    def _update_pinch_discrete(
        self, h: _HandState, norm_value: float, now: float,
    ) -> Optional[str]:
        """
        Hysteresis-based pinch detection with grab suppression.
        """
        state = h.pinch_state

        # Suppress during grab cooldown — still track state silently
        if now < h.grab_cooldown_until:
            if state == self._PINCH_NEUTRAL:
                if norm_value < self.pinch_close:
                    h.pinch_state = self._PINCH_CLOSED
                elif norm_value > self.pinch_open:
                    h.pinch_state = self._PINCH_OPENED
            elif state == self._PINCH_CLOSED:
                if norm_value > self.pinch_reset:
                    h.pinch_state = self._PINCH_NEUTRAL
            elif state == self._PINCH_OPENED:
                if norm_value < self.pinch_reset:
                    h.pinch_state = self._PINCH_NEUTRAL
            return None

        if state == self._PINCH_NEUTRAL:
            should_fire = False
            direction = None

            if norm_value < self.pinch_close:
                should_fire = True
                direction = "pinch_in"
            elif norm_value > self.pinch_open:
                should_fire = True
                direction = "pinch_out"

            if should_fire:
                if direction == "pinch_in":
                    h.pinch_state = self._PINCH_CLOSED
                else:
                    h.pinch_state = self._PINCH_OPENED

                # Suppress if non-pinch fingers are also moving (grab, not pinch)
                finger_hist = h.finger_history
                pinch_hist = h.pinch_history
                if finger_hist and pinch_hist:
                    recent_fingers = self._recent(finger_hist, now, self.pinch_suppress_ms)
                    recent_pinch = self._recent(pinch_hist, now, self.pinch_suppress_ms)
                    if len(recent_fingers) >= 2 and len(recent_pinch) >= 2:
                        avg_first = (recent_fingers[0][0] + recent_fingers[0][1] + recent_fingers[0][2]) / 3
                        avg_last = (recent_fingers[-1][0] + recent_fingers[-1][1] + recent_fingers[-1][2]) / 3
                        other_change = abs(avg_last - avg_first)
                        pinch_change = abs(recent_pinch[-1][0] - recent_pinch[0][0])
                        if pinch_change > 0 and other_change / pinch_change > 0.4:
                            return None

                return direction

        elif state == self._PINCH_CLOSED:
            if norm_value > self.pinch_reset:
                h.pinch_state = self._PINCH_NEUTRAL

        elif state == self._PINCH_OPENED:
            if norm_value < self.pinch_reset:
                h.pinch_state = self._PINCH_NEUTRAL

        return None

    # -- Grab/release (hand-size-relative, timestamp-based) --

    def _check_grab(
        self, h: _HandState, label: str, now: float, hs: float, kps: np.ndarray,
    ) -> Optional[str]:
        """
        Detect grab/release from middle/ring/pinky movement.
        """
        if not h.finger_history:
            h.last_grab_reject = "no_history"
            return None

        recent = self._recent(h.finger_history, now, self.grab_window_ms)
        if len(recent) < 4:
            h.last_grab_reject = f"too_few({len(recent)})"
            return None

        # Suppress grab if the hand flipped orientation (front↔back) recently.
        if h.orientation_history:
            orient_window = self.grab_window_ms * 1.5
            recent_orient = self._recent(h.orientation_history, now, orient_window)
            if len(recent_orient) >= 2:
                orientations = {entry[0] for entry in recent_orient}
                if len(orientations) > 1:
                    h.last_grab_reject = "orient_flip"
                    return None

        # Per-finger change: (mid, ring, pinky)
        mid_change = recent[-1][0] - recent[0][0]
        ring_change = recent[-1][1] - recent[0][1]
        pinky_change = recent[-1][2] - recent[0][2]
        changes = [mid_change, ring_change, pinky_change]

        # Store normalized signal for diagnostics
        pf = [abs(c) / hs for c in changes]
        avg = sum(changes) / 3
        h.last_finger_signal = (pf[0], pf[1], pf[2], abs(avg) / hs)

        # Determine if this would be a release (positive = fingers extending)
        is_release_candidate = all(c > 0 for c in changes)
        currently_dragging = self._dragging.get(label, False)

        # Separate thresholds for grab vs release:
        if is_release_candidate and currently_dragging:
            effective_threshold = self.grab_threshold * self.release_guard_multiplier
        else:
            effective_threshold = self.grab_threshold
        
        # Backhand multiplier: only for GRAB, not release.
        # Fists naturally register as backhand, so applying to release
        # would make it impossible to open hand while dragging.
        is_backhand = self._is_backhand(kps)
        if is_backhand and not (is_release_candidate and currently_dragging):
            effective_threshold *= 2.0
        
        bh = ""
        if is_backhand:
            if is_release_candidate and currently_dragging:
                bh = "bh-skip "  # backhand detected but skipped for release
            else:
                bh = "BH "

        # All three must exceed a minimum individual threshold
        per_finger = [abs(c) / hs for c in changes]
        min_per = effective_threshold * 0.5
        if not all(p > min_per for p in per_finger):
            h.last_grab_reject = (
                f"{bh}per_finger(m={per_finger[0]:.3f} r={per_finger[1]:.3f} "
                f"p={per_finger[2]:.3f} need>{min_per:.3f})"
            )
            return None

        # All three must move in the same direction
        if not (all(c < 0 for c in changes) or all(c > 0 for c in changes)):
            h.last_grab_reject = f"{bh}direction({['+' if c>0 else '-' for c in changes]})"
            return None

        # Overall magnitude (average of three)
        avg_change = sum(changes) / 3
        if abs(avg_change) / hs < effective_threshold:
            h.last_grab_reject = f"{bh}magnitude({abs(avg_change)/hs:.3f}<{effective_threshold:.3f})"
            return None

        # Trend consistency
        avg_values = [(e[0] + e[1] + e[2]) / 3 for e in recent]
        direction = 1 if avg_change > 0 else -1
        n_transitions = len(avg_values) - 1
        if n_transitions < 3:
            h.last_grab_reject = f"{bh}n_trans({n_transitions}<3)"
            return None

        min_step = hs * 0.005
        consistent = 0
        meaningful = 0
        for i in range(1, len(avg_values)):
            step = avg_values[i] - avg_values[i-1]
            if abs(step) < min_step:
                continue
            meaningful += 1
            if step * direction > 0:
                consistent += 1

        if meaningful < 3:
            h.last_grab_reject = f"{bh}meaningful({meaningful}<3)"
            return None

        if is_release_candidate and currently_dragging:
            min_ratio = 0.50
        else:
            min_ratio = 0.45
        if consistent / meaningful < min_ratio:
            h.last_grab_reject = f"{bh}consistency({consistent}/{meaningful}={consistent/meaningful:.2f}<{min_ratio})"
            return None

        # Variance gate for release during drag
        if is_release_candidate and currently_dragging:
            diffs = [avg_values[i] - avg_values[i-1] for i in range(1, len(avg_values))]
            mean_diff = sum(diffs) / len(diffs)
            variance = sum((d - mean_diff) ** 2 for d in diffs) / len(diffs)
            if mean_diff != 0 and variance / (mean_diff ** 2) > 6.0:
                h.last_grab_reject = f"{bh}variance({variance/(mean_diff**2):.1f}>6.0)"
                return None

        h.last_grab_reject = ""
        return "release" if avg_change > 0 else "grab"

    def _is_backhand(self, kps: np.ndarray) -> bool:
        # Vectors on the palm plane
        v1 = kps[5] - kps[0]   # Wrist to Index MCP
        v2 = kps[17] - kps[0]  # Wrist to Pinky MCP
        
        # Cross product gives the palm normal
        normal = np.cross(v1, v2)
        
        # If the Z-component of the normal is positive, the palm 
        # is likely facing away (backhand) in MediaPipe's coordinate system.
        return normal[2] > 0

    def reset(self) -> None:
        """Clear all tracking state."""
        self._auto_ts = 0.0
        self._hands.clear()
        self._dragging.clear()
        self._drag_persist_until.clear()


class DragState:
    """
    Continuous drag position data for one hand.

    Attributes
    ----------
    palm_x, palm_y     : palm center position in pixels.
    palm_dx, palm_dy   : palm delta since last frame.
    index_x, index_y   : index fingertip position in pixels.
    index_dx, index_dy : index fingertip delta since last frame.
    """
    __slots__ = (
        "palm_x", "palm_y", "palm_dx", "palm_dy",
        "index_x", "index_y", "index_dx", "index_dy",
    )

    def __init__(
        self,
        palm_x: float, palm_y: float,
        palm_dx: float, palm_dy: float,
        index_x: float, index_y: float,
        index_dx: float, index_dy: float,
    ) -> None:
        self.palm_x = palm_x
        self.palm_y = palm_y
        self.palm_dx = palm_dx
        self.palm_dy = palm_dy
        self.index_x = index_x
        self.index_y = index_y
        self.index_dx = index_dx
        self.index_dy = index_dy

    def __repr__(self) -> str:
        return (
            f"DragState(palm=({self.palm_x:.0f},{self.palm_y:.0f}) "
            f"d=({self.palm_dx:.1f},{self.palm_dy:.1f}), "
            f"index=({self.index_x:.0f},{self.index_y:.0f}) "
            f"d=({self.index_dx:.1f},{self.index_dy:.1f}))"
        )
