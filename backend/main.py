# ── MAIN FASTAPI APPLICATION ROUTER: main.py ──
# - Purpose: This is the heartbeat of your backend server.
# - Key Roles:
#   1. Serves as the web server host (FastAPI) handling API communication from your React frontend.
#   2. Performs database lookups (read/write JSON files like jobs.json and projects.json on your computer).
#   3. Executes advanced FFmpeg shell commands to combine video layers, render blur backgrounds, crop mobile clips, and inject logo overlays.
# - Editing Tip: If you want to modify how local project/user databases are named or stored, look at the directory constants below.

import json
import os
import hashlib
import uuid
import base64
import tempfile
import subprocess
import logging
from typing import Any, Optional

log = logging.getLogger(__name__)

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Import sub-router for v2 repurpose loops (smart-cropping & Gemini AI pipelines)
from repurpose_v2_router import router as repurpose_v2_router


# ── LOCAL DATABASE DIRECTORIES & CONSTANTS ──
# - Purpose: Establishes paths where user account files, project states, and raw video files are stored.
# - Storage format: Plain JSON text files acting as lightweight local database tables.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")           # C:\...\backend\data (Stores metadata files)
CLIPS_DIR = os.path.join(BASE_DIR, "clips")         # C:\...\backend\clips (Stores raw/exported MP4 clips)
JOBS_FILE = os.path.join(DATA_DIR, "jobs.json")       # Tracks active and complete AI render job lists
PROJECTS_FILE = os.path.join(DATA_DIR, "projects.json") # Stores user folders and clip timelines
USERS_FILE = os.path.join(DATA_DIR, "users.json")     # Stores hashed passwords & emails

# Automatically creates backend/data and backend/clips folders on your computer if they don't exist yet
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CLIPS_DIR, exist_ok=True)

# In-memory dictionary tracking current active rendering job progresses
jobs: dict[str, dict[str, Any]] = {}


# ── LOCAL FILE DATABASE UTILITIES (JSON CRUD) ──

def _read_json(path: str, default: Any) -> Any:
    """
    Reads a database file from your disk.
    - If the file is missing or corrupted, returns the default empty value (like [] or {}).
    """
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return default


def _write_json(path: str, data: Any) -> None:
    """
    Saves/Writes data back to a database file on your disk.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def _update_job(job_id: str, patch: dict[str, Any]) -> None:
    """
    Updates progress values for a specific AI processing job.
    - Updates in-memory 'jobs' dictionary and saves state directly to jobs.json.
    """
    current = jobs.get(job_id, {})
    current.update(patch)
    jobs[job_id] = current
    persisted = _read_json(JOBS_FILE, {})
    persisted[job_id] = current
    _write_json(JOBS_FILE, persisted)


def _get_current_user_from_token(authorization: Optional[str] = Header(default=None)) -> dict[str, str]:
    """
    Resolves the logged-in user identity from the HTTP Bearer request header.
    - Fallback: Defaults to 'local-user' if running offline/demo workspace.
    """
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    return {"user_id": token or "local-user"}


# ── REQUEST SCHEMA MODELS (DATA VALIDATION) ──
# - Purpose: Define the exact JSON structure the frontend must send to the backend.
# - Pydantic models automatically validate incoming requests and send error codes if fields are missing.

class VideoTransform(BaseModel):
    """Tracks how a video layer is positioned, sized, and scaled in the visual editor canvas."""
    ox: float  # Origin X offset
    oy: float  # Origin Y offset
    scale: float  # Scale multiplier (zoom)
    x: float  # Visual Left position
    y: float  # Visual Top position
    w: float  # Visual Width size
    h: float  # Visual Height size


class TextTransform(BaseModel):
    """Tracks positioning coordinates of customized text hooks overlaid on the clip."""
    x: float
    y: float
    w: float


class CaptionTransform(BaseModel):
    """Tracks positioning coordinates of subtitles/captions overlaid on the clip."""
    x: float
    y: float
    w: float


class ExportPreviewRequest(BaseModel):
    """
    The detailed settings bundle sent by the React editor when generating/rendering a final video.
    - Tells FFmpeg whether to use blurred borders, custom background colors, captions, or custom logo watermarks.
    """
    clip_id: str
    ratio: Optional[str] = "original"                      # Crop Ratio (e.g. 9:16 mobile, 1:1 square)
    bg_type: Optional[str] = "black"                       # Background Style: 'black' | 'white' | 'blur' | 'custom'
    bg_custom_color: Optional[str] = "#000000"             # Custom color Hex value
    blur_strength: Optional[float] = 42.0                  # Blur multiplier for blurred borders
    custom_text: Optional[str] = ""                        # Custom text hook caption overlay
    text_hidden: Optional[bool] = False                    # If true, hides the text hook overlay
    text_align: Optional[str] = "center"                   # Text alignment
    text_style: Optional[str] = "plain"                    # Style styling presets
    text_color: Optional[str] = "#ffffff"                  # Overlay text color Hex value
    font_size: Optional[float] = 20.0                      # Overlay text font size
    volume: Optional[float] = 1.0                          # Video audio volume multiplier
    video_transform: Optional[VideoTransform] = None        # Scale/Position coordinates of raw video layer
    text_transform: Optional[TextTransform] = None          # Position coordinates of customized text hook layer
    overlay_image: Optional[str] = None                    # Base64 encoded logo image watermark layer
    enable_captions: Optional[bool] = False                # Turns subtitles on or off
    caption_style: Optional[str] = "1_word"                # Style structure for subtitles
    caption_transform: Optional[CaptionTransform] = None    # Position coordinates of subtitles layer
    caption_settings: Optional[dict] = None                # Miscellaneous settings (styling, speed)


class AuthRequest(BaseModel):
    """User login or signup request data model."""
    email: str
    password: str
    name: str = ""


class BulkDeleteRequest(BaseModel):
    """A list of project IDs queued for batch deletion."""
    project_ids: list[str]


def _password_hash(password: str) -> str:
    """Hashes passwords using SHA256 before saving to users.json, keeping details secure."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _session_for(user: dict[str, Any]) -> dict[str, Any]:
    """Generates an authentication response bundle, caching user variables for the browser."""
    public_user = {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name") or user["email"].split("@", 1)[0],
        "plan": user.get("plan", "Pro"),
    }
    return {"token": user["id"], "user": public_user}


# ── INITIALIZING FASTAPI WEB APP SERVER ──

app = FastAPI(title="Reclipper API")

# CORS MIDDLEWARE RULES:
# - Allows local browser instances (like Vite localhost:5173 / localhost:3000) to safely talk to this backend port (8000).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# STICKY STATIC FILE SERVERS:
# - Mounts backend/clips directory under /clips web URL. 
# - Allows the React frontend to stream render previews of MP4 clips directly by referencing <video src="http://localhost:8000/clips/file.mp4" />
app.mount("/clips", StaticFiles(directory=CLIPS_DIR), name="clips")

# Connects repurpose_v2_router.py endpoints (AI generator) under /api/v2/repurpose URLs
app.include_router(repurpose_v2_router)


# ── API ENDPOINT CONTROLLERS ──

@app.get("/health")
async def health():
    """Simple connection health-check endpoint to verify if the server is turned on."""
    return {"status": "ok"}


@app.post("/auth/signup")
async def signup(req: AuthRequest):
    """
    REGISTRATION ENDPOINT: Saves new users to users.json.
    - Hashes passwords securely.
    - Rejects request with a 409 error if the email is already in use.
    """
    email = req.email.strip().lower()
    users = _read_json(USERS_FILE, [])
    if any(user.get("email") == email for user in users):
        raise HTTPException(status_code=409, detail="An account already exists for this email.")
    user = {
        "id": f"user_{uuid.uuid4().hex[:10]}",
        "email": email,
        "name": req.name.strip() or email.split("@", 1)[0],
        "password_hash": _password_hash(req.password),
        "plan": "Pro",
    }
    users.append(user)
    _write_json(USERS_FILE, users)
    return _session_for(user)


@app.post("/auth/signin")
async def signin(req: AuthRequest):
    """
    LOGIN SIGN-IN ENDPOINT: Validates email & password hashes.
    - Sends a 401 unauthorized code if credentials don't match.
    """
    email = req.email.strip().lower()
    users = _read_json(USERS_FILE, [])
    for user in users:
        if user.get("email") == email and user.get("password_hash") == _password_hash(req.password):
            return _session_for(user)
    raise HTTPException(status_code=401, detail="Invalid email or password.")


@app.post("/auth/demo")
async def demo_auth():
    """
    DEMO BYPASS SHORTCUT: Returns a pre-configured 'Scale' plan demo user immediately.
    - Used when clicking "Try Demo" on the login screen.
    """
    return _session_for({
        "id": "local-user",
        "email": "demo@reclipper.local",
        "name": "Demo Clipper",
        "plan": "Scale",
    })


@app.get("/projects")
async def list_projects(authorization: Optional[str] = Header(default=None)):
    """LIST PROJECTS ENDPOINT: Gathers and returns the current user's projects from projects.json."""
    user = _get_current_user_from_token(authorization)
    projects = [
        project
        for project in _read_json(PROJECTS_FILE, [])
        if project.get("user_id") in (None, user["user_id"])
    ]
    return {"projects": projects}


@app.get("/projects/library")
async def list_project_library(authorization: Optional[str] = Header(default=None)):
    """ALIASED LIBRARY ENPOINT: Redirects query directly to list_projects."""
    return await list_projects(authorization)


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, authorization: Optional[str] = Header(default=None)):
    """DELETE PROJECT ENDPOINT: Removes a single project matching {project_id} from projects.json."""
    user = _get_current_user_from_token(authorization)
    projects = _read_json(PROJECTS_FILE, [])
    kept = [
        project for project in projects
        if not (project.get("project_id") == project_id and project.get("user_id") in (None, user["user_id"]))
    ]
    if len(kept) == len(projects):
        raise HTTPException(status_code=404, detail="Project not found")
    _write_json(PROJECTS_FILE, kept)
    return {"deleted": project_id}


@app.post("/projects/bulk-delete")
async def bulk_delete_projects(req: BulkDeleteRequest, authorization: Optional[str] = Header(default=None)):
    """BATCH DELETE PROJECTS: Deletes a list of checked project IDs from projects.json in one go."""
    user = _get_current_user_from_token(authorization)
    wanted = set(req.project_ids)
    deleted: list[str] = []
    kept = []
    for project in _read_json(PROJECTS_FILE, []):
        can_delete = project.get("project_id") in wanted and project.get("user_id") in (None, user["user_id"])
        if can_delete:
            deleted.append(project.get("project_id"))
        else:
            kept.append(project)
    _write_json(PROJECTS_FILE, kept)
    return {"deleted": deleted}


# ── ADVANCED VIDEO EXPORT RENDERING PIPELINE (FFMPEG SHELL COMMAND) ──

@app.post("/export/preview")
async def export_preview(req: ExportPreviewRequest):
    """
    EXPORTS & RENDERS YOUR COMPLETED VIDEO CLIP:
    - This is the heavy lifting center of Reclipper.
    - How it works:
      1. Finds the raw MP4 video clip in projects.json.
      2. Construct complex FFmpeg filtering graphs to:
         a. Make custom background (e.g. scale raw video to 1080x1920, add deep blur, stack dark overlay box on top)
         b. Scale and center the main raw foreground video clip based on editor zoom offsets.
         c. Decode base64 graphics (text overlay titles or logo images) and compile transparent watermark PNG overlays.
         d. Mix the audio volume.
      3. Launches FFmpeg via shell commands.
      4. Saves the rendered video clip to backend/clips/ folder and returns the streaming web URL to your browser.
    """
    # Step 1: Locates the clip matching clip_id in projects database
    projects = _read_json(PROJECTS_FILE, [])
    source_filename = None
    for project in projects:
        for clip in project.get("clips", []):
            if clip.get("clip_id") == req.clip_id:
                clip_url = clip.get("clip_url", "")
                source_filename = os.path.basename(clip_url)
                break
        if source_filename:
            break

    if not source_filename:
        raise HTTPException(status_code=404, detail="Clip not found in projects")

    file_path = os.path.join(CLIPS_DIR, source_filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail=f"Source clip file {source_filename} not found")

    # Inputs list for the shell execution. Preset with primary raw video input
    inputs = ["-i", file_path]
    filter_complex = ""
    map_label = "[composite]"

    # 1. GENERATE BACKGROUND LAYER
    if req.bg_type == "blur":
        # Calculates blur radius (sigma) from 0-100 blur strength slider setting
        sigma = max(1, int((req.blur_strength / 100.0) * 40.0)) if req.blur_strength is not None else 16
        # FFmpeg filter:
        # - scale: inflates raw video to cover vertical 1080x1920 canvas
        # - crop: crops out overflow borders to maintain strict 9:16 layout
        # - gblur: applies Gaussian blur effect to the background
        # - drawbox: overlays a transparent dark shading layer (opacity 22%) to prevent background from outshining foreground video text.
        filter_complex += (
            f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
            f"crop=1080:1920,"
            f"gblur=sigma={sigma},"
            f"drawbox=x=0:y=0:w=iw:h=ih:color=black@0.22:t=fill[bg];"
        )
    else:
        # Flat solid colored background (defaults to deep charcoal #0f1116)
        color_hex = "#0f1116"
        if req.bg_type == "white":
            color_hex = "#ffffff"
        elif req.bg_type == "custom":
            color_hex = req.bg_custom_color or "#000000"
        bg_color = color_hex.lstrip("#")
        # FFmpeg filter: Generates a blank, colorized 1080x1920 canvas running at 30 frames per second
        filter_complex += f"color=c=0x{bg_color}:s=1080x1920:r=30[bg];"

    # 2. GENERATE FOREGROUND VIDEO LAYER
    # - Scales dimensions from the visual 720h preview canvas in ProjectsPage up to a high-def 1920h export canvas.
    EXPORT_SCALE = 1920.0 / 720.0
    if req.video_transform:
        fw = int(req.video_transform.w * EXPORT_SCALE)
        fh = int(req.video_transform.h * EXPORT_SCALE)
        fx = int(req.video_transform.x * EXPORT_SCALE)
        fy = int(req.video_transform.y * EXPORT_SCALE)
    else:
        # Default positioning fallback: Centers raw video clip in the 9:16 canvas
        fw, fh = 1080, 1920
        fx, fy = 0, 0

    # Safety: Dimensions must be divisible by 2 to work with standard MP4 (yuv420p format)
    fw = fw - (fw % 2)
    fh = fh - (fh % 2)
    fx = int(round(fx))
    fy = int(round(fy))

    # Adds scaling filter to foreground video, then stitches it on top of our generated background canvas
    filter_complex += f"[0:v]scale={fw}:{fh}[fg];"
    filter_complex += f"[bg][fg]overlay=x={fx}:y={fy}:shortest=1[composite]"

    # 3. TEXT OVERLAY / LOGO WATERMARK LAYER
    temp_png_path = None
    if req.overlay_image and not req.text_hidden:
        try:
            # The canvas logo from ProjectsPage is sent as a base64 encoded string.
            # We decode this back into raw image bytes and save it as a temporary PNG file on your computer.
            data_b64 = req.overlay_image
            if "," in req.overlay_image:
                header, data_b64 = req.overlay_image.split(",", 1)
            png_data = base64.b64decode(data_b64)
            
            # Writes temporary PNG to backend/clips/ folder
            fd, temp_png_path = tempfile.mkstemp(suffix=".png", dir=CLIPS_DIR)
            with os.fdopen(fd, "wb") as fh_png:
                fh_png.write(png_data)
                
            # Loads this transparent PNG as input index 1, overlays it on top of the composites
            inputs += ["-i", temp_png_path]
            filter_complex += ";[composite][1:v]overlay=0:0[composite_with_text]"
            map_label = "[composite_with_text]"
        except Exception as e:
            log.error("Failed to decode overlay_image: %s", e)

    # 4. RUN FFMPEG SHELL COMMAND COMMANDS
    out_filename = f"export_{req.clip_id}_{uuid.uuid4().hex[:6]}.mp4"
    out_path = os.path.join(CLIPS_DIR, out_filename)

    # Core FFmpeg shell parameters
    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", filter_complex,
        "-map", map_label,
        "-map", "0:a?", # Retains audio if present
    ]

    # Adjusts audio volume based on your editor volume slider setting
    if req.volume is not None and req.volume != 1.0:
        cmd += ["-filter:a", f"volume={req.volume}"]

    # Codecs, encoding profiles, and performance presets:
    # - libx264: H.264 video codec (fully compatible with web, iPhone, Instagram)
    # - preset fast: Speeds up render times on your local computer
    # - crf 22: Constant Rate Factor (determines quality - 22 yields great visual clarity without huge files sizes)
    # - aac: Audio encoder format
    # - pix_fmt yuv420p: Standard color system required by social networks
    # - +faststart: Moves index data to the front of the file so video starts playing instantly in browsers without waiting for full download.
    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out_path
    ]

    # Fires up the background process execution
    try:
        log.info("Running export FFmpeg: %s", " ".join(cmd))
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            log.error("FFmpeg export failed: %s", result.stderr)
            raise HTTPException(status_code=500, detail=f"FFmpeg export failed: {result.stderr[-1000:]}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="FFmpeg export timed out")
    finally:
        # Safety: Destroys the temporary transparent logo PNG from clips/ directory to free up space.
        if temp_png_path and os.path.exists(temp_png_path):
            try:
                os.remove(temp_png_path)
            except Exception:
                pass

    # Verifies if the file was rendered successfully
    if os.path.isfile(out_path):
        return {"url": f"/clips/{out_filename}", "filename": out_filename}
    else:
        raise HTTPException(status_code=500, detail="Failed to generate export video")
