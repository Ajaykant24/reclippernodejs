# ── VERSION 2 AI VIDEO REPURPOSING ROUTER: repurpose_v2_router.py ──
# - Purpose: Manages all V2 automated video formatting features.
# - Key Roles:
#   1. Orchestrates the full AI workflow: Upload -> Auto Smart-Cropping -> Canvas Stitching -> Gemini Multi-Stage Text Hook Generation -> Project Entry Saving.
#   2. Runs heavy CPU/GPU processing inside background thread pools, keeping the website fluid and responsive.
#   3. Exposes an endpoint to swap overlay title texts on the fly and re-render the clip in seconds without needing to run AI analysis again.
# - Editing Tip: If you want to modify AI prompt behaviors or model parameters, check the `run_gemini_pipeline` function imports.

import asyncio
import logging
import os
import shutil
import tempfile
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Import core image analysis pipelines, smart crop, and metadata utilities
from repurpose_v2_ai import run_gemini_pipeline
from repurpose_v2_pipeline import (
    RATIO_DIMS,
    compose_canvas,
    probe_video,
    detect_and_crop,
    extract_analysis_frame,
)
from video_processor import generate_thumbnail
from datetime import datetime

log = logging.getLogger(__name__)

# Instantiates sub-router. Mounted on FastAPI app under /api/v2/repurpose URLs in main.py.
router = APIRouter(prefix="/api/v2/repurpose", tags=["repurpose-v2"])


# ── IN-MEMORY JOBS REGISTRY ──
# - Tracks active job details (progress %, state) while the CPU processes FFmpeg commands.
JOBS: dict[str, dict] = {}

# Setups folder destination for final compiled video clips
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "repurpose_outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# THREAD POOL WORKERS:
# - Spawns 2 concurrent background threads for heavy jobs (like running FFmpeg).
# - Keeps your primary API responsive so other users can browse projects without lagging.
_pool = ThreadPoolExecutor(max_workers=2)


# ── REQUEST SCHEMA MODELS (VALIDATION) ──

class RerenderRequest(BaseModel):
    """
    Form parameters sent by the frontend editor when updating overlay texts.
    - Specifies the ID of the job and the new text string to write.
    """
    job_id: str
    overlay_text: str


class RerenderResponse(BaseModel):
    """Returns the streaming download URL of the re-rendered video file."""
    video_url: str


# ── STATUS DATA UPDATER ──

def _update(job_id: str, patch: dict) -> None:
    """
    Pushes status updates (e.g. progress = 55%, status = "generating_ai")
    both to the in-memory array and persists them to jobs.json.
    """
    from main import _update_job
    if job_id in JOBS:
        JOBS[job_id].update(patch)
    _update_job(job_id, patch)


# ── BACKGROUND EXECUTION WORKER PIPELINE (THE CORE ENGINE) ──

def _run_pipeline(
    job_id: str,
    video_path: str,
    work_dir: str,
    background_type: str,
    blur_opacity: float,
    background_color: str,
    output_ratio: str,
    intensity: str,
    logo_path: Optional[str],
    user_id: Optional[str],
) -> None:
    """
    Executes in a background thread. Walks through every step of video formatting:
    1. Probe: Reads width, height, and length of the uploaded video file.
    2. Smart Crop: Automatically detects the subject in the center of widescreen clips and crops them.
    3. Canvas Composing: Combines the cropped clip onto a 9:16 vertical workspace (applies blurred borders or solid background colors).
    4. AI Analysis: Calls Gemini to watch key frames and generate 20 punchy visual hook titles and a copy/paste post caption.
    5. Saves outputs: Adds clip data and thumbnails to projects.json.
    """
    try:
        # ── Step 1: Probe Video Metadata ──
        _update(job_id, {"status": "probing", "progress": 5})
        probe = probe_video(video_path)
        if not probe["success"]:
            raise RuntimeError(f"Video probe failed: {probe['error']}")

        # ── Step 2: Widescreen Smart Crop ──
        _update(job_id, {"status": "smart_cropping", "progress": 15})
        smart_crop_path = os.path.join(work_dir, "smart_crop.mp4")
        crop_res = detect_and_crop(video_path, smart_crop_path, probe)
        if not crop_res["success"]:
            raise RuntimeError(f"Smart crop failed: {crop_res['error']}")

        # Determines what aspect ratio to render (e.g. 9:16 mobile)
        normalized_ratio = (output_ratio or "original").strip().lower()
        use_original = normalized_ratio in {"", "original", "source", "actual"}
        source_w = int(probe.get("width", 0))
        source_h = int(probe.get("height", 0))
        crop_w = int(crop_res.get("crop_w") or source_w)
        crop_h = int(crop_res.get("crop_h") or source_h)
        canvas_w, canvas_h = crop_w, crop_h

        # ── Step 3: Layer Canvas Composition ──
        working_video_path = smart_crop_path
        if not use_original:
            if normalized_ratio not in RATIO_DIMS:
                raise RuntimeError(f"Unsupported output_ratio: {output_ratio!r}")
            _update(job_id, {"status": "composing_canvas", "progress": 25})
            canvas_path = os.path.join(work_dir, "canvas.mp4")
            
            # Combines the video layer on top of a custom layout background (blur background, custom colors)
            canvas_res = compose_canvas(
                smart_crop_path,
                canvas_path,
                normalized_ratio,
                background_type,
                blur_opacity,
                background_color,
            )
            if not canvas_res["success"]:
                raise RuntimeError(f"Canvas render failed: {canvas_res['error']}")
            working_video_path = canvas_path
            canvas_w, canvas_h = RATIO_DIMS[normalized_ratio]

        # ── Step 4: AI Analysis & Prompting ──
        _update(job_id, {"status": "generating_ai", "progress": 55})
        # Passes cropped layout to Gemini AI pipeline.
        # - AI inspects video contents, evaluates context and generates:
        #   1. `overlays`: 20 catchy title options.
        #   2. `caption`: A caption block (with hashtags and hook lines) ready to be copied for social posts.
        ai = run_gemini_pipeline(working_video_path, intensity=intensity, ratio=normalized_ratio, tone="relatable")
        overlays = ai["overlays"]
        caption  = ai["caption"]

        # ── Step 5: Finalize and Save Clip ──
        from main import CLIPS_DIR, PROJECTS_FILE, _read_json, _write_json
        
        _update(job_id, {"status": "finalizing", "progress": 93})
        final_filename = f"repurposed_v2_{job_id}.mp4"
        final_path     = os.path.join(CLIPS_DIR, final_filename)
        
        # Copies final rendered MP4 video clip to backend/clips/ folder
        shutil.copy2(working_video_path, final_path)

        # Generates JPG thumbnail preview
        base_clip_id = f"repurposed_v2_{job_id}"
        generate_thumbnail(final_path, base_clip_id)
        thumb_filename = f"{base_clip_id}_thumb.jpg"

        # Builds project entries dictionary conforming to library schema
        clip = {
            "clip_id": base_clip_id,
            "clip_url": f"/clips/{final_filename}",
            "thumb_url": f"/clips/{thumb_filename}",
            "start_time": 0,
            "end_time": float(probe.get("duration", 0)),
            "background_type": background_type,
            "background_color": background_color,
            "blur_opacity": blur_opacity,
            "crop_ratio": "original" if use_original else normalized_ratio,
            "output_ratio": "original" if use_original else normalized_ratio,
            "source_w": source_w,
            "source_h": source_h,
            "crop_w": crop_w,
            "crop_h": crop_h,
            "smart_cropped": bool(crop_res.get("cropped")),
            "canvas_w": canvas_w,
            "canvas_h": canvas_h,
            "hook": overlays[0] if overlays else "Repurposed Clip", # Defaults hook to AI overlay index 0
            "clip_caption": caption,
            "overlay_texts": overlays,
            "analysis_source": "repurpose_v2"
        }

        # ── Save Project to library in projects.json ──
        project_id    = f"proj_{job_id}_rep_v2"
        source_title  = "Repurposed Upload"
        project_entry = {
            "project_id": project_id,
            "video_id":   job_id,
            "title":      source_title,
            "platform":   "Upload",
            "uploader":   "You",
            "user_id":    user_id,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "clips":      [clip],
        }
        existing_projects = _read_json(PROJECTS_FILE, [])
        # Overwrites duplicates and inserts new project folder on top
        existing_projects = [p for p in existing_projects if p.get("project_id") != project_id]
        existing_projects.insert(0, project_entry)
        _write_json(PROJECTS_FILE, existing_projects)

        # Triggers completion state update. React frontend immediately catches this and unlocks the Editor page!
        _update(job_id, {
            "status":       "done",
            "progress":     100,
            "clip":         clip,
            "project_id":   project_id,
            "work_dir":     work_dir,
            "canvas_path":   working_video_path,
            "canvas_w":      canvas_w,
            "canvas_h":      canvas_h,
        })
        log.info("[repurpose_v2] Pipeline complete: job=%s", job_id)

    except Exception as exc:
        _update(job_id, {"status": "failed", "error": str(exc)})
        log.error("[repurpose_v2] Pipeline error for %s:\n%s", job_id, traceback.format_exc())


# ── ENDPOINT CONTROLLER PATHWAYS ──

@router.post("", summary="Upload video and run the full V2 repurpose pipeline")
async def repurpose_upload(
    background_tasks: BackgroundTasks,
    video: Optional[UploadFile] = File(default=None),
    video_id: str = Form(default=""),
    background_type: str = Form(default="black"),
    blur_opacity: float = Form(default=0.5),
    background_color: str = Form(default="#000000"),
    output_ratio: str = Form(default="original"),
    intensity: str = Form(default="medium"),
    logo: Optional[UploadFile] = File(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """
    UPLOAD PORT: Accepts multipart/form-data video file uploads.
    - Extracts variables (ratio, backgrounds, logo watermarks).
    - Schedules the heavy pipeline loop background runner inside the CPU Thread pool.
    - Instantly returns the generated `job_id` so the frontend can start showing the loading meter bar.
    """
    from main import _get_current_user_from_token
    user = _get_current_user_from_token(authorization)

    job_id   = uuid.uuid4().hex[:10]
    work_dir = tempfile.mkdtemp(prefix=f"repurpose_v2_{job_id}_")

    # Creates absolute filepath to save the incoming raw video stream to disk
    video_path = os.path.join(work_dir, f"input_{job_id}.mp4")
    if video:
        with open(video_path, "wb") as fh:
            shutil.copyfileobj(video.file, fh)
    elif video_id:
        UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
        source_path = os.path.join(UPLOAD_DIR, f"{video_id}.mp4")
        if not os.path.exists(source_path):
            raise HTTPException(status_code=400, detail="Provided video_id not found")
        shutil.copy2(source_path, video_path)
    else:
        raise HTTPException(status_code=400, detail="Must provide either video or video_id")

    # Decodes and saves branding logo image watermark if one is uploaded
    logo_path = None
    if logo and logo.filename:
        ext = os.path.splitext(logo.filename)[1] or ".png"
        logo_path = os.path.join(work_dir, f"logo{ext}")
        with open(logo_path, "wb") as fh:
            shutil.copyfileobj(logo.file, fh)

    file_display_name = video.filename if video else f"video_{job_id}"

    # Sets up initial queued entry state
    JOBS[job_id] = {
        "job_id":      job_id,
        "status":      "queued",
        "progress":    0,
        "file_name":   file_display_name,
        "created_at":  datetime.utcnow().isoformat() + "Z",
        "job_type":    "repurpose_v2",
        "user_id":     user.get("user_id"),
    }

    # Saves to database files immediately so job preserves if user refreshes page
    from main import _update_job
    _update_job(job_id, JOBS[job_id])

    # Kicks off the heavy pipeline process inside background threads
    loop = asyncio.get_event_loop()
    background_tasks.add_task(
        loop.run_in_executor,
        _pool, _run_pipeline,
        job_id, video_path, work_dir,
        background_type, blur_opacity, background_color, output_ratio, intensity, logo_path, user.get("user_id"),
    )

    return {"job_id": job_id}


@router.get("/status/{job_id}", summary="Poll job status")
async def get_status(job_id: str):
    """POLLING PATH: Returns progress updates during active rendering jobs."""
    from main import jobs as main_jobs
    if job_id not in JOBS and job_id not in main_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = JOBS.get(job_id) or main_jobs.get(job_id)
    return {
        "job_id":    job_id,
        "status":    job.get("status"),
        "progress":  job.get("progress", 0),
        "video_url": job.get("video_url"),
        "clip":      job.get("clip"),
        "project_id": job.get("project_id"),
        "overlays":  job.get("overlays"),
        "caption":   job.get("caption"),
        "error":     job.get("error"),
    }


@router.get("/jobs", summary="List all V2 repurpose jobs")
async def list_jobs(authorization: Optional[str] = Header(default=None)):
    """LIST QUEUES: Merges and lists current and historical AI jobs for the logged-in user."""
    from main import jobs as main_jobs, _get_current_user_from_token, _read_json, JOBS_FILE
    user = _get_current_user_from_token(authorization)
    persisted = _read_json(JOBS_FILE, {})
    merged: dict[str, dict] = {}
    
    # Merges and resolves overlaps between persisted database records and in-memory caches
    for jid, jdata in persisted.items():
        if jdata.get("job_type") == "repurpose_v2" and jdata.get("user_id") == user.get("user_id"):
            merged[jid] = jdata
    for jid, jdata in JOBS.items():
        if jdata.get("user_id") == user.get("user_id"):
            merged[jid] = jdata
    for jid, jdata in main_jobs.items():
        if jdata.get("job_type") == "repurpose_v2" and jdata.get("user_id") == user.get("user_id") and jid not in merged:
            merged[jid] = jdata
            
    # Sorts descending from newest jobs
    jobs_list = sorted(merged.values(), key=lambda j: j.get("created_at", ""), reverse=True)
    return {"jobs": jobs_list}


@router.post("/rerender", response_model=RerenderResponse, summary="Re-render with new overlay text")
async def rerender_video(req: RerenderRequest):
    """
    RERENDER FAST TRACK:
    - Swaps overlay text hooks on the fly.
    - Re-uses `canvas.mp4` stored in the job work directory.
    - Runs in seconds since it skips the heavy crop detects and Gemini calls.
    """
    job = JOBS.get(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("status") != "done":
        raise HTTPException(status_code=400, detail=f"Job not complete (status={job.get('status')})")

    canvas_path = job.get("canvas_path")
    if not canvas_path or not os.path.exists(canvas_path):
        raise HTTPException(status_code=500, detail="Canvas video missing — please re-upload")

    canvas_w = job.get("canvas_w", 1080)
    canvas_h = job.get("canvas_h", 1920)

    rerender_filename = f"rerender_{req.job_id}_{uuid.uuid4().hex[:6]}.mp4"
    rerender_path     = os.path.join(OUTPUT_DIR, rerender_filename)

    # Runs light-speed overlay renderer in background thread
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _pool,
        lambda: render_overlay_text(
            canvas_path, rerender_path,
            req.overlay_text, canvas_w, canvas_h,
        ),
    )

    if not result["success"]:
        raise HTTPException(
            status_code=500,
            detail=f"Re-render failed: {result.get('error', 'unknown')}",
        )

    return RerenderResponse(video_url=f"/api/v2/repurpose/download/{rerender_filename}")


@router.get("/download/{filename}", summary="Serve output video file")
async def download_file(filename: str):
    """
    DOWNLOAD PORT: Serves completed videos to frontend download anchors.
    - Security: Prevents directory path traversal (preventing hackers from reading other system directories).
    """
    safe      = os.path.basename(filename)
    file_path = os.path.join(OUTPUT_DIR, safe)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        file_path,
        media_type="video/mp4",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )
