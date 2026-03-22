# Vendored JARVIS vision slice

This directory contains a **minimal** copy of the hand-tracking and webcam stack from **JARVIS** (`gesture-2`), sufficient for `hand_service`.

## Upstream

- Repository: [JARVIS-NULabs/JARVIS](https://github.com/JARVIS-NULabs/JARVIS) (private; branch `gesture-2`)
- Use the full repo for **reference**, diffs, and upgrades—not required to run vdj.

## What is included

| Path | Source |
|------|--------|
| `jarvis/core/schema.py` | Trimmed to `BoundingBox`, `DetectedObject`, `VisionFrame` only |
| `jarvis/vision/pose.py` | Copied from upstream `jarvis/vision/pose.py` |
| `jarvis/vision/webcam.py` | Copied from upstream `jarvis/vision/webcam.py` |

## License

Upstream JARVIS is MIT (see `pyproject.toml` in the upstream repo). Retain attribution when syncing changes.

## Syncing from upstream

When `pose.py` or `webcam.py` changes in JARVIS, diff against this vendor and copy selectively; re-run `hand_service` tests manually.
