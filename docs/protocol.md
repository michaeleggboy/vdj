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
      "landmarks": [[0.51, 0.48, -0.02], ...]
    }
  ]
}
```

- **`side`:** `"left"` | `"right"` (from MediaPipe handedness).
- **`landmarks`:** 21 points, each `[x, y, z]` with **x,y normalized** to `[0, 1]` relative to frame width/height; **z** is raw MediaPipe relative depth (approximate).

### `error`

```json
{ "v": 1, "type": "error", "message": "camera open failed" }
```

## UI mapping (app-side)

The browser maps normalized wrist position and gestures to DJ controls; smoothing and calibration live in the client (`gestureMapper`).
