# vdj WebSocket protocol (hand → UI)

Version **1**. All messages are JSON text frames.

## Client → server

Optional ping (not required for MVP):

```json
{ "v": 1, "type": "ping" }
```

## Server → client

### `hello` (sent once on connect)

```json
{
  "v": 1,
  "type": "hello",
  "service": "vdj-hand",
  "jarvis_branch": "gesture-2"
}
```

### `frame` (repeated, throttled ~30 Hz)

```json
{
  "v": 1,
  "type": "frame",
  "t_ms": 1730000000000,
  "img_width": 640,
  "img_height": 480,
  "hands": [
    {
      "side": "left",
      "label": "Left Hand",
      "confidence": 0.92,
      "gesture": "open_palm",
      "landmarks": [[0.51, 0.48, -0.02], ...],
      "pinch_distance": 0.12,
      "curled_fingers": 0,
      "finger_spread": 0.11
    }
  ]
}
```

- **`side`:** `"left"` | `"right"` (from MediaPipe handedness).
- **`landmarks`:** 21 points, each `[x, y, z]` with **x,y normalized** to `[0, 1]` relative to frame width/height; **z** is raw MediaPipe relative depth (approximate).
- **`pinch_distance` (optional):** Euclidean distance between thumb tip (landmark 4) and index tip (8) in normalized **x,y** image space. The web client can recompute this from `landmarks` if omitted.
- **`curled_fingers` (optional):** Count of non-thumb fingers whose tip is below its MCP in **y** (0–4). Fist ≈ 4, open palm ≈ 0.
- **`finger_spread` (optional):** Distance between index tip (8) and pinky tip (20) in normalized **x,y** (wider spread → larger value).

### `error`

```json
{ "v": 1, "type": "error", "message": "camera open failed" }
```

## UI mapping (app-side)

The browser maps normalized wrist position and gestures to DJ controls; smoothing and calibration live in the client (`gestureMapper`).
