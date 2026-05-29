"""
repurpose_router.py — FastAPI router for the Repurpose Tool.

Two-pass Text-First pipeline:
  POST /api/repurpose/upload        → save file, kick background pipeline
  GET  /api/repurpose/status/{id}  → poll job progress
  POST /api/repurpose/export        → RepurposeExportRequest → render & return URL
  GET  /api/repurpose/download/{f} → serve rendered file
"""

import asyncio
import os
import shutil
import tempfile
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from repurpose_ai import analyze_for_repurpose
from repurpose_models import RepurposeExportRequest, RepurposeExportResponse
from repurpose_render import render_repurpose_export
from transcriber import transcribe_video

router = APIRouter(prefix="/api/repurpose", tags=["repurpose"])

# ── In-memory job store (replace with Redis/DB for production) ────────────────
JOBS: dict[str, dict] = {}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "repurpose_outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Thread pool for CPU-bound transcription (keeps FastAPI event loop free)
_pool = ThreadPoolExecutor(max_workers=2)


# ── Background pipeline ────────────────────────────────────────────────────────

def _update(job_id: str, patch: dict) -> None:
    JOBS[job_id].update(patch)


def _run_pipeline(job_id: str, video_path: str) -> None:
    """
    Runs in a thread-pool worker (blocking IO is fine here).

    Pass 1: Whisper transcription
    Pass 2: Gemini 2.5 Flash-Lite analysis (text-first, no images)
    """
    try:
        # ── Step 1: Transcribe ────────────────────────────────────────────
        _update(job_id, {"status": "transcribing", "progress": 20})
        trans = transcribe_video(video_path)
        if not trans["success"]:
            raise RuntimeError(f"Transcription failed: {trans.get('error')}")

        transcript = trans["transcript"]
        segments = trans["segments"]

        # ── Step 2: AI analysis (local heuristics + Gemini) ──────────────
        _update(job_id, {"status": "analyzing", "progress": 55})

        # Probe duration from transcription result or fallback
        duration = 0.0
        if segments:
            try:
                duration = float(segments[-1]["end"])
            except (KeyError, TypeError, ValueError):
                duration = 0.0

        ai = analyze_for_repurpose(transcript, segments, duration)
        if not ai["success"]:
            raise RuntimeError("AI analysis returned failure")

        data = ai["data"]
        _update(job_id, {
            "status": "decision",
            "progress": 100,
            "transcript": transcript,
            "caption": data["caption"],
            "overlays": data["overlays"],
            "viral_clips": data.get("viral_clips", []),
            "video_path": video_path,
        })

    except Exception as exc:
        _update(job_id, {"status": "failed", "error": str(exc)})
        print(f"[repurpose_router] pipeline error for {job_id}:\n{traceback.format_exc()}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/upload", summary="Upload video and start the two-pass pipeline")
async def upload_for_repurpose(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
):
    job_id = uuid.uuid4().hex[:10]
    work_dir = tempfile.mkdtemp(prefix=f"repurpose_{job_id}_")
    video_path = os.path.join(work_dir, f"input_{job_id}.mp4")

    # Stream upload to disk
    with open(video_path, "wb") as fh:
        shutil.copyfileobj(video.file, fh)

    JOBS[job_id] = {
        "job_id": job_id,
        "status": "uploaded",
        "progress": 5,
        "work_dir": work_dir,
        "video_path": video_path,
    }

    # Offload blocking work to thread pool
    loop = asyncio.get_event_loop()
    background_tasks.add_task(
        loop.run_in_executor, _pool, _run_pipeline, job_id, video_path
    )

    return {"job_id": job_id}


@router.get("/status/{job_id}", summary="Poll pipeline status")
async def get_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    job = JOBS[job_id]
    # Return safe subset — exclude raw file paths
    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job.get("progress", 0),
        "caption": job.get("caption"),
        "overlays": job.get("overlays"),
        "viral_clips": job.get("viral_clips"),
        "error": job.get("error"),
    }


@router.post(
    "/export",
    response_model=RepurposeExportResponse,
    summary="Render final video from RepurposeExportRequest",
)
async def export_video(req: RepurposeExportRequest):
    """
    Accepts the full RepurposeExportRequest from the React frontend.
    Runs render_repurpose_export() in a thread pool (blocking FFmpeg call).
    Returns a RepurposeExportResponse with a download URL.
    """
    job = JOBS.get(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "decision":
        raise HTTPException(
            status_code=400,
            detail=f"Job is not ready for export (status={job['status']})",
        )

    video_path = job.get("video_path")
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=500, detail="Source video file is missing")

    filename = f"repurposed_{req.job_id}.mp4"
    output_path = os.path.join(OUTPUT_DIR, filename)

    # Run FFmpeg in thread pool so we don't block the event loop
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _pool,
        lambda: render_repurpose_export(
            input_path=video_path,
            output_path=output_path,
            background_hex=req.background_hex,
            overlay_text=req.overlay_text,
            overlay_y_position_normalized=req.overlay_y_position_normalized,
        ),
    )

    if not result["success"]:
        raise HTTPException(
            status_code=500,
            detail=f"Rendering failed: {result.get('error', 'unknown')}",
        )

    caption = req.caption or job.get("caption", "")

    return RepurposeExportResponse(
        status="success",
        video_url=f"/api/repurpose/download/{filename}",
        caption=caption,
    )


@router.get("/download/{filename}", summary="Serve rendered output file")
async def download_file(filename: str):
    # Security: prevent path traversal
    safe = os.path.basename(filename)
    file_path = os.path.join(OUTPUT_DIR, safe)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        file_path,
        media_type="video/mp4",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )
