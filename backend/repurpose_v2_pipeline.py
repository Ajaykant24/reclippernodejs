"""
repurpose_v2_pipeline.py — FFmpeg video processing pipeline for the V2 Repurpose Tool.

Steps:
  1. probe_video           — ffprobe to get resolution, fps, duration
  2. detect_and_crop       — cropdetect + padded inward crop to remove background borders
  3. compose_canvas        — place cropped video on target-ratio canvas (black/white/blur)
  4. extract_analysis_frame — pull a single JPEG frame for Gemini vision
  5. render_overlay_text   — drawtext filter with dynamic font size + line wrap
  6. apply_logo_overlay    — optional top-right logo compositing
"""

import json
import logging
import os
import re
import subprocess
from collections import Counter

log = logging.getLogger(__name__)

# ── Target canvas dimensions by output ratio ───────────────────────────────────
RATIO_DIMS = {
    "9:16": (1080, 1920),
    "2:3":  (1080, 1620),
    "1:1":  (1080, 1080),
    "4:5":  (1080, 1350),
    "3:4":  (1080, 1440),
    "3:2":  (1620, 1080),
    "4:3":  (1440, 1080),
    "16:9": (1920, 1080),
    "21:9": (1920, 824),
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _run(args: list, step: str, timeout: int = 600) -> dict:
    """Run an ffmpeg command and return {success, error}."""
    cmd = ["ffmpeg", "-y"] + args
    log.info("[repurpose_v2] %s → %s", step, " ".join(cmd[:8]))
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            tail = result.stderr[-3000:] if result.stderr else "(no stderr)"
            log.error("[repurpose_v2] %s failed:\n%s", step, tail)
            return {"success": False, "error": f"FFmpeg [{step}] rc={result.returncode}: {tail}"}
        return {"success": True}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"FFmpeg [{step}] timed out after {timeout}s"}
    except FileNotFoundError:
        return {"success": False, "error": "ffmpeg not found in PATH"}
    except Exception as e:
        return {"success": False, "error": f"FFmpeg [{step}] exception: {e}"}


def _run_probe(args: list, timeout: int = 30) -> dict:
    """Run ffprobe and return {success, stdout, error}."""
    cmd = ["ffprobe"] + args
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            return {"success": False, "error": result.stderr[-2000:]}
        return {"success": True, "stdout": result.stdout, "stderr": result.stderr}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "ffprobe timed out"}
    except FileNotFoundError:
        return {"success": False, "error": "ffprobe not found in PATH"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _escape_drawtext(text: str) -> str:
    return (
        str(text or "")
        .replace("\\", "\\\\")
        .replace(":", r"\:")
        .replace("'", r"\'")
        .replace("%", r"\%")
        .replace(",", r"\,")
        .replace("[", r"\[")
        .replace("]", r"\]")
    )


def _resolve_font() -> str:
    candidates = [
        os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "arialbd.ttf"),
        os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "segoeuib.ttf"),
        os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "arial.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return ""


def _wrap_text(text: str, max_non_space: int = 25, max_lines: int = 3) -> list[str]:
    """
    Wrap overlay text: split when non-space chars exceed 32 per line.
    Spaces are never counted toward the limit. Max 3 lines.
    """
    words = str(text or "").replace("\n", " ").split()
    if not words:
        return []
    lines: list[str] = []
    current_words: list[str] = []
    current_len = 0

    for word in words:
        word_len = len(word.replace(" ", ""))  # non-space chars only
        if current_words and current_len + word_len > max_non_space:
            lines.append(" ".join(current_words))
            if len(lines) >= max_lines:
                break
            current_words = [word]
            current_len = word_len
        else:
            current_words.append(word)
            current_len += word_len

    if current_words and len(lines) < max_lines:
        lines.append(" ".join(current_words))
    return lines


def _normalize_hex_color(value: str, fallback: str = "#000000") -> str:
    raw = str(value or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", raw):
        return raw
    if re.fullmatch(r"[0-9a-fA-F]{6}", raw):
        return f"#{raw}"
    return fallback


def _ffmpeg_color(value: str) -> str:
    return _normalize_hex_color(value).replace("#", "0x")


# ── Step 1: Probe ──────────────────────────────────────────────────────────────

def probe_video(file_path: str) -> dict:
    """Return {success, width, height, fps, duration, aspect_ratio}."""
    res = _run_probe([
        "-v", "quiet", "-print_format", "json",
        "-show_streams", "-show_format", file_path,
    ])
    if not res["success"]:
        return {"success": False, "error": res["error"]}
    try:
        data = json.loads(res["stdout"])
        video_stream = next(
            (s for s in data.get("streams", []) if s.get("codec_type") == "video"), None
        )
        if not video_stream:
            return {"success": False, "error": "No video stream found"}
        width  = int(video_stream.get("width", 0))
        height = int(video_stream.get("height", 0))
        fps_str = video_stream.get("r_frame_rate", "30/1")
        try:
            num, den = fps_str.split("/")
            fps = float(num) / float(den)
        except Exception:
            fps = 30.0
        duration = float(data.get("format", {}).get("duration", 0))
        aspect   = round(width / height, 4) if height > 0 else 1.0
        return {
            "success": True,
            "width": width, "height": height,
            "fps": fps, "duration": duration,
            "aspect_ratio": aspect,
        }
    except Exception as e:
        return {"success": False, "error": f"probe_video parse error: {e}"}


# ── Step 2: Detect and Crop ────────────────────────────────────────────────────

def detect_and_crop(input_path: str, output_path: str, probe: dict) -> dict:
    """
    Find the inner video by detecting motion (ignoring static backgrounds like white bars, blur, or meme text).
    If detected crop is within 5% of full dimensions → skip.
    Returns {success, cropped: bool, crop_w, crop_h, error}.
    """
    full_w = probe.get("width", 0)
    full_h = probe.get("height", 0)

    crop_x, crop_y, crop_w, crop_h = 0, 0, full_w, full_h
    cropped = False

    try:
        import cv2
        import numpy as np
        
        cap = cv2.VideoCapture(input_path)
        if cap.isOpened():
            frames = []
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 300)
            step = max(1, total_frames // 15)
            
            # Read up to 15 frames distributed across the video
            for i in range(0, total_frames, step):
                cap.set(cv2.CAP_PROP_POS_FRAMES, i)
                ret, frame = cap.read()
                if ret:
                    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
                if len(frames) >= 15:
                    break
            cap.release()

            if len(frames) >= 2:
                diffs = []
                for i in range(len(frames) - 1):
                    diffs.append(cv2.absdiff(frames[i], frames[i+1]))
                
                max_diff = np.max(diffs, axis=0)
                # threshold to remove compression artifacts
                _, thresh = cv2.threshold(max_diff, 30, 255, cv2.THRESH_BINARY)
                
                # Morphological opening to remove isolated noise (like text jitter)
                kernel = np.ones((5,5), np.uint8)
                thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
                
                contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if contours:
                    # Keep contours that are at least 1% of the total screen area
                    min_area = (full_w * full_h) * 0.01
                    valid_contours = [c for c in contours if cv2.contourArea(c) > min_area]
                    
                    if valid_contours:
                        x_min, y_min = full_w, full_h
                        x_max, y_max = 0, 0
                        for c in valid_contours:
                            cx, cy, cw, ch = cv2.boundingRect(c)
                            x_min = min(x_min, cx)
                            y_min = min(y_min, cy)
                            x_max = max(x_max, cx + cw)
                            y_max = max(y_max, cy + ch)
                            
                        x = x_min
                        y = y_min
                        w = x_max - x_min
                        h = y_max - y_min
                        
                        # Apply 3% inward padding for a cleaner edge
                        pad_w = int(w * 0.03)
                        pad_h = int(h * 0.03)
                        w = max(16, w - pad_w * 2)
                        h = max(16, h - pad_h * 2)
                        x = x + pad_w
                        y = y + pad_h
                        
                        crop_x, crop_y, crop_w, crop_h = x, y, w, h
    except Exception as e:
        log.error("[repurpose_v2] OpenCV crop detect failed: %s", e)

    # Check if we found a valid crop
    if crop_w < full_w and crop_h <= full_h:
        tolerance_w = full_w * 0.05
        tolerance_h = full_h * 0.05
        if (abs(crop_w - full_w) <= tolerance_w and abs(crop_h - full_h) <= tolerance_h):
            log.info("[repurpose_v2] Type A video detected — skipping crop")
        else:
            # Make dimensions and coordinates even (libx264 4:2:0 requirement)
            crop_w = crop_w - (crop_w % 2)
            crop_h = crop_h - (crop_h % 2)
            crop_x = crop_x - (crop_x % 2)
            crop_y = crop_y - (crop_y % 2)
            cropped = True
            log.info("[repurpose_v2] Motion crop: %dx%d+%d+%d", crop_w, crop_h, crop_x, crop_y)

    if cropped:
        vf = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}"
        result = _run([
            "-i", input_path,
            "-vf", vf,
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            output_path,
        ], "detect_and_crop")
        if not result["success"]:
            return result
        return {"success": True, "cropped": True, "crop_w": crop_w, "crop_h": crop_h}
    else:
        import shutil
        shutil.copy2(input_path, output_path)
        return {"success": True, "cropped": False, "crop_w": full_w, "crop_h": full_h}


# ── Step 3: Compose Canvas ─────────────────────────────────────────────────────

def compose_canvas(
    cropped_path: str,
    output_path: str,
    output_ratio: str,
    background_type: str,   # "black" | "white" | "blur" | "custom"
    blur_opacity: float,    # 0.0 – 1.0 (only used when background_type == "blur")
    background_color: str = "#000000",
) -> dict:
    """
    Place cropped video centered on a canvas of the target output ratio.
    background_type:
      "black" → solid black pad
      "white" → solid white pad
      "blur"  → blurred video fill behind, opacity controlled by blur_opacity
    """
    tw, th = RATIO_DIMS.get(output_ratio, (1080, 1920))

    if background_type in ("black", "white", "custom"):
        if background_type == "custom":
            color = _ffmpeg_color(background_color)
        else:
            color = "black" if background_type == "black" else "white"
        filter_complex = (
            f"[0:v]scale={tw}:{th}:force_original_aspect_ratio=decrease,"
            f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:color={color}[out]"
        )
        return _run([
            "-i", cropped_path,
            "-filter_complex", filter_complex,
            "-map", "[out]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path,
        ], "compose_canvas_solid")

    elif background_type == "blur":
        # Build blur background:
        # [bg] = video scaled to fill canvas + heavy gaussian blur
        bg_chain = (
            f"[0:v]scale={tw}:{th}:force_original_aspect_ratio=increase,"
            f"crop={tw}:{th},"
            f"gblur=sigma=40"
        )
        # Apply black overlay to match blur_opacity (alpha)
        opacity = 1.0 - max(0.0, min(1.0, blur_opacity))
        if opacity > 0.0:
            bg_chain += f",drawbox=x=0:y=0:w=iw:h=ih:color=black@{opacity:.3f}:t=fill"
        bg_chain += "[bg]"

        # [fg] = video scaled to fit canvas (letterboxed) with transparent padding
        fg_chain = (
            f"[0:v]scale={tw}:{th}:force_original_aspect_ratio=decrease,"
            f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:color=black@0[fg]"
        )

        filter_complex = (
            f"{bg_chain};"
            f"{fg_chain};"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2[out]"
        )

        return _run([
            "-i", cropped_path,
            "-filter_complex", filter_complex,
            "-map", "[out]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path,
        ], "compose_canvas_blur")

    else:
        return {"success": False, "error": f"Unknown background_type: {background_type!r}"}


# ── Step 4: Extract analysis frame ────────────────────────────────────────────

def extract_analysis_frame(video_path: str, output_frame_path: str, seek_secs: float = 1.0) -> dict:
    """Extract a single JPEG frame at seek_secs for Gemini vision analysis."""
    result = _run([
        "-ss", str(seek_secs),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        output_frame_path,
    ], "extract_analysis_frame")
    if result["success"] and not os.path.exists(output_frame_path):
        # Fallback: extract first frame
        return _run([
            "-i", video_path, "-vframes", "1", "-q:v", "2", output_frame_path,
        ], "extract_analysis_frame_fallback")
    return result


# ── Step 5: Render overlay text ────────────────────────────────────────────────

def render_overlay_text(
    canvas_path: str,
    output_path: str,
    overlay_text: str,
    canvas_w: int,
    canvas_h: int,
) -> dict:
    """
    Burn overlay text onto the canvas video.
    Alignment rules:
    - 8 words per line max, up to 3 lines
    - 24px side margins (text never touches video edges)
    - Bottom-anchored: 20px from bottom edge
    - Center-aligned: x=(w-text_w)/2
    - Font size scales with canvas width
    """
    text = str(overlay_text or "").strip()
    if not text:
        import shutil
        shutil.copy2(canvas_path, output_path)
        return {"success": True}

    # Font size: ~5.5% of canvas width, clamped
    font_size    = max(42, min(120, int(canvas_w * 0.055)))
    line_spacing = max(8, int(font_size * 0.22))

    lines = _wrap_text(text)   # 32 non-space chars/line, max 3 lines
    if not lines:
        import shutil
        shutil.copy2(canvas_path, output_path)
        return {"success": True}

    font_path  = _resolve_font()
    # Side margin: 24px each side — text stays inside video bounds
    side_margin = 24
    # Bottom anchor: bottom edge minus 20px, then walk up by full block height
    block_height = len(lines) * font_size + max(0, len(lines) - 1) * line_spacing
    base_y = max(side_margin, canvas_h - block_height - 20)

    filter_parts = []
    current = "[0:v]"
    for i, line in enumerate(lines):
        esc      = _escape_drawtext(line)
        line_y   = base_y + i * (font_size + line_spacing)
        next_lbl = f"[txt{i}]"
        # x=(w-text_w)/2 centers each line (including last) identically
        draw = (
            f"{current}drawtext="
            f"text='{esc}':"
            f"x=(w-text_w)/2:"
            f"y={line_y}:"
            f"fontsize={font_size}:"
            f"fontcolor=white:"
            f"borderw=4:bordercolor=black@0.95:"
            f"shadowx=3:shadowy=3:shadowcolor=black@0.90"
        )
        if font_path:
            draw += f":fontfile='{_escape_drawtext(font_path)}'"
        draw += next_lbl
        filter_parts.append(draw)
        current = next_lbl

    return _run([
        "-i", canvas_path,
        "-filter_complex", ";".join(filter_parts),
        "-map", current,
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ], "render_overlay_text")


# ── Step 6: Apply logo overlay ────────────────────────────────────────────────

def apply_logo(
    video_path: str,
    logo_path: str,
    output_path: str,
    canvas_w: int,
    canvas_h: int,
) -> dict:
    """
    Overlay logo at top-right corner: 10% of canvas width, 5% padding from edges.
    """
    logo_size = int(canvas_w * 0.10)
    padding   = int(canvas_w * 0.05)

    filter_complex = (
        f"[1:v]scale={logo_size}:-1[logo];"
        f"[0:v][logo]overlay=W-w-{padding}:{padding}[out]"
    )
    return _run([
        "-i", video_path,
        "-i", logo_path,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ], "apply_logo")
