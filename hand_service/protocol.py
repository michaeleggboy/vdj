"""vdj WebSocket protocol v1 — mirrors docs/protocol.md and web/src/protocol.ts."""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


class HelloMessage(TypedDict):
    v: Literal[1]
    type: Literal["hello"]
    service: str
    jarvis_branch: str


class ErrorMessage(TypedDict):
    v: Literal[1]
    type: Literal["error"]
    message: str


class HandPayload(TypedDict):
    side: Literal["left", "right"]
    label: str
    confidence: float
    gesture: str
    landmarks: list[list[float]]  # 21 x [x,y,z] normalized x,y
    pinch_distance: NotRequired[float]  # thumb tip (4) ↔ index tip (8), normalized image xy
    curled_fingers: NotRequired[int]  # tip below MCP in y, 0–4 (no thumb)
    finger_spread: NotRequired[float]  # index tip (8) ↔ pinky tip (20), normalized xy


class FrameMessage(TypedDict):
    v: Literal[1]
    type: Literal["frame"]
    t_ms: int
    img_width: int
    img_height: int
    hands: list[HandPayload]


ServerMessage = HelloMessage | FrameMessage | ErrorMessage


def hello_message() -> HelloMessage:
    return {
        "v": 1,
        "type": "hello",
        "service": "vdj-hand",
        "jarvis_branch": "gesture-2",
    }


def error_message(message: str) -> ErrorMessage:
    return {"v": 1, "type": "error", "message": message}


def frame_message(
    *,
    t_ms: int,
    img_width: int,
    img_height: int,
    hands: list[HandPayload],
) -> FrameMessage:
    return {
        "v": 1,
        "type": "frame",
        "t_ms": t_ms,
        "img_width": img_width,
        "img_height": img_height,
        "hands": hands,
    }
