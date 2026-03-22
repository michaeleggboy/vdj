"""
Minimal vision schema vendored from JARVIS for vdj hand_service.

Upstream (full file): JARVIS jarvis/core/schema.py on branch gesture-2.
https://github.com/JARVIS-NULabs/JARVIS/tree/gesture-2
"""
from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1


class DetectedObject(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: BoundingBox
    track_id: Optional[int] = None
    mask: Optional[Any] = None
    keypoints: Optional[Any] = None
    gesture: Optional[str] = None

    model_config = {"arbitrary_types_allowed": True}


class VisionFrame(BaseModel):
    source: Literal["screen", "webcam", "image", "video"]
    objects: List[DetectedObject] = Field(default_factory=list)
    scene: str = ""
    raw_path: Optional[str] = None
    img_width: int = 0
    img_height: int = 0

    model_config = {"arbitrary_types_allowed": True}

    def to_llm_prompt(self) -> str:
        lines = [f"[Vision - {self.source}]"]
        if self.scene:
            lines.append(f"Scene: {self.scene}")
        if self.objects:
            parts = []
            for o in self.objects:
                desc = f"{o.label}({o.confidence:.0%})"
                if o.gesture:
                    desc += f"[{o.gesture}]"
                parts.append(desc)
            lines.append(f"Objects: {', '.join(parts)}")
        return "\n".join(lines)
