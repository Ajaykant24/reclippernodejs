"""
repurpose_models.py — Strict Pydantic data contracts for the Repurpose pipeline.

Two-pass Text-First architecture:
  Pass 1 (local)  : Whisper transcription → whisper_intelligence heuristics
  Pass 2 (remote) : Gemini 2.5 Flash-Lite structures the transcript into viral assets
"""

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional


# ── Gemini inference output ────────────────────────────────────────────────────

class ViralClip(BaseModel):
    """A time-bounded clip with a virality estimate. Produced by Gemini Pass 2."""
    start_timestamp: float = Field(..., ge=0.0, description="Start time in seconds")
    end_timestamp: float = Field(..., ge=0.0, description="End time in seconds")
    virality_score: int = Field(..., ge=1, le=10, description="Score 1–10")
    title: str = Field(..., min_length=1, max_length=120)

    @field_validator("end_timestamp")
    @classmethod
    def end_after_start(cls, v: float, info) -> float:
        start = info.data.get("start_timestamp", 0.0)
        if v <= start:
            raise ValueError("end_timestamp must be greater than start_timestamp")
        return round(v, 3)


class GeminiAnalysisResult(BaseModel):
    """Full structured output from Gemini Pass 2 — drives both Repurpose and Studio tools."""
    caption: str = Field(
        ...,
        description="Viral social caption: Who/Where/When/Why, US audience, ≤280 chars",
    )
    overlays: List[str] = Field(
        ...,
        min_length=1,
        description="Short meme-style hook texts (max 20 for Repurpose, 10 for Studio)",
    )
    viral_clips: List[ViralClip] = Field(
        default_factory=list,
        description="Timestamp-bounded viral moments identified by Gemini",
    )

    @field_validator("overlays")
    @classmethod
    def strip_overlays(cls, v: List[str]) -> List[str]:
        return [s.strip() for s in v if s and s.strip()]

    @field_validator("caption")
    @classmethod
    def strip_caption(cls, v: str) -> str:
        return v.strip()


# ── Legacy alias kept for backwards compat with whisper_intelligence callers ──

class VideoContextData(BaseModel):
    caption: str
    overlays: List[str]


# ── Job tracking (in-memory state machine) ─────────────────────────────────────

class RepurposeJob(BaseModel):
    job_id: str
    status: str  # uploaded | extracting | transcribing | analyzing | decision | failed
    progress: int = 0
    video_path: Optional[str] = None
    work_dir: Optional[str] = None
    transcript: Optional[str] = None
    caption: Optional[str] = None
    overlays: Optional[List[str]] = None
    viral_clips: Optional[List[ViralClip]] = None
    error: Optional[str] = None


# ── Export request: the React → FFmpeg rendering bridge ───────────────────────

class RepurposeExportRequest(BaseModel):
    """
    Frontend sends this when the user hits Export.
    All pixel-independent — the backend maps normalized coords to actual resolution.
    """
    job_id: str = Field(..., description="Job ID returned by /upload")
    background_hex: str = Field(
        default="#000000",
        description="CSS hex color for the letterbox background, e.g. '#1a1a2e'",
        pattern=r"^#[0-9a-fA-F]{6}$",
    )
    overlay_text: str = Field(
        default="",
        description="The hook text chosen by the user from the AI overlay list",
        max_length=200,
    )
    caption: str = Field(
        default="",
        description="AI caption — returned to the export page, not burned into video",
        max_length=2000,
    )
    overlay_y_position_normalized: float = Field(
        default=0.12,
        ge=0.0,
        le=1.0,
        description="Vertical position as a fraction of video height (0=top, 1=bottom)",
    )


# ── Export response ────────────────────────────────────────────────────────────

class RepurposeExportResponse(BaseModel):
    status: str
    video_url: str
    caption: str
