"""
repurpose_pipeline.py — FFmpeg processing functions for the Content Repurpose Tool.

Steps:
  1. probe_video           — ffprobe to detect resolution, fps, duration, aspect ratio
  2. normalize_aspect      — cropdetect + scale + pad to 9:16 with blurred background
  3. bypass_duplicate      — zoom, hue shift, brightness, noise, re-encode
  4. extract_first_frame   — single JPEG frame for AI analysis
  5. extract_whisper_audio — rip strict mono/16 kHz WAV for Whisper compatibility
  6. burn_overlay_text     — drawtext filter baked into final video
  7. final_encode          — libx264, aac, CRF 23, faststart
"""

import json
import logging
import os
import re
import subprocess
import uuid

log = logging.getLogger(__name__)

# ── Target resolutions by platform ────────────────────────────────────────────
PLATFORM_DIMS = {
    "instagram": (1080, 1920),
    "youtube": (1080, 1920),
    "tiktok": (1080, 1920),
}


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


def _resolve_drawtext_font() -> str:
    windir = os.environ.get("WINDIR", r"C:\Windows")
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        os.environ.get("SF_FONT_PATH", ""),
        os.path.join(windir, "Fonts", "SF-Pro-Text-Regular.otf"),
        os.path.join(windir, "Fonts", "SF-Pro-Display-Regular.otf"),
        os.path.join(local_appdata, "Microsoft", "Windows", "Fonts", "SF-Pro-Text-Regular.otf"),
        os.path.join(local_appdata, "Microsoft", "Windows", "Fonts", "SF-Pro-Display-Regular.otf"),
        os.path.join(windir, "Fonts", "segoeui.ttf"),
        os.path.join(windir, "Fonts", "arial.ttf"),
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return ""


def _wrap_overlay_lines(text: str, max_non_space: int = 25, max_lines: int = 3) -> list[str]:
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
        word_len = len(word.replace(" ", ""))
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


def build_overlay_timeline(overlay_texts: list[str], duration: float) -> list[dict]:
    valid_texts = [str(text).strip() for text in overlay_texts if str(text).strip()]
    if not valid_texts:
        return []
    total = max(float(duration or 0.0), 0.1)
    slot = total / len(valid_texts)
    timeline = []
    for idx, text in enumerate(valid_texts):
        start = round(idx * slot, 3)
        end = round(total if idx == len(valid_texts) - 1 else (idx + 1) * slot, 3)
        timeline.append({"text": text, "start": start, "end": max(start + 0.1, end)})
    return timeline


def _run_ffmpeg(args: list, step_name: str) -> dict:
    """Run an ffmpeg command. Returns {success, error}."""
    cmd = ["ffmpeg", "-y"] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            return {"success": False, "error": f"FFmpeg [{step_name}] failed: {result.stderr[-2000:]}"}
        return {"success": True}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"FFmpeg [{step_name}] timed out after 300s"}
    except FileNotFoundError:
        return {"success": False, "error": "ffmpeg not found in PATH"}
    except Exception as e:
        return {"success": False, "error": f"FFmpeg [{step_name}] exception: {e}"}


def probe_video(file_path: str) -> dict:
    """Use ffprobe to get video metadata."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_streams", "-show_format",
        file_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return {"success": False, "error": f"ffprobe failed: {result.stderr}"}
        data = json.loads(result.stdout)
        video_stream = next(
            (s for s in data.get("streams", []) if s.get("codec_type") == "video"),
            None,
        )
        if not video_stream:
            return {"success": False, "error": "No video stream found in file"}

        width = int(video_stream.get("width", 0))
        height = int(video_stream.get("height", 0))
        fps_str = video_stream.get("r_frame_rate", "30/1")
        try:
            num, den = fps_str.split("/")
            fps = float(num) / float(den)
        except Exception:
            fps = 30.0
        duration = float(data.get("format", {}).get("duration", 0))
        aspect = round(width / height, 4) if height > 0 else 1.0

        return {
            "success": True,
            "width": width,
            "height": height,
            "fps": fps,
            "duration": duration,
            "aspect_ratio": aspect,
        }
    except Exception as e:
        return {"success": False, "error": f"probe_video exception: {e}"}


def _detect_crop(file_path: str) -> str:
    """Run cropdetect on 10 frames and return the most common crop filter string, or None."""
    cmd = [
        "ffmpeg", "-i", file_path,
        "-vf", "cropdetect=24:16:0",
        "-vframes", "30",
        "-f", "null", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        # cropdetect prints to stderr
        crops = re.findall(r"crop=(\d+:\d+:\d+:\d+)", result.stderr)
        if not crops:
            return None
        # Return the most common crop
        from collections import Counter
        most_common = Counter(crops).most_common(1)[0][0]
        return f"crop={most_common}"
    except Exception as e:
        print(f"[repurpose_pipeline] cropdetect failed: {e}")
        return None


def normalize_aspect(input_path: str, output_path: str, platform: str, probe: dict) -> dict:
    """
    Crop letterbox + scale + pad to platform target resolution.
    Fills with a blurred version of the video for aesthetic background.
    """
    tw, th = PLATFORM_DIMS.get(platform, (1080, 1920))
    crop_filter = _detect_crop(input_path)

    # Build filter complex:
    # [0:v] → optionally crop → split into two:
    #   bg: scale to fill target, heavy boxblur
    #   fg: scale to fit within target (preserving AR), then overlay centered
    crop_part = f"{crop_filter}," if crop_filter else ""

    filter_complex = (
        f"[0:v]{crop_part}split=2[bg_raw][fg_raw];"
        f"[bg_raw]scale={tw}:{th}:force_original_aspect_ratio=increase,"
        f"crop={tw}:{th},boxblur=luma_radius=40:luma_power=3[bg];"
        f"[fg_raw]scale={tw}:{th}:force_original_aspect_ratio=increase,"
        f"crop={tw}:{th}[fg];"
        f"[bg][fg]overlay=0:0[out]"
    )

    args = [
        "-i", input_path,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]
    return _run_ffmpeg(args, "normalize_aspect")


def bypass_duplicate(input_path: str, output_path: str) -> dict:
    """
    Apply subtle transformations to bypass duplicate-detection algorithms.
    All applied in a single FFmpeg filter chain.
    """
    # Slight zoom: scale to 102% then crop back
    # Hue shift: +2 degrees
    # Brightness/contrast tweak
    # Invisible noise layer
    vf = (
        "scale=iw*1.02:ih*1.02,"
        "crop=iw/1.02:ih/1.02,"
        "hue=h=2,"
        "eq=brightness=0.02:contrast=1.02,"
        "noise=alls=2:allf=t"
    )
    args = [
        "-i", input_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]
    return _run_ffmpeg(args, "bypass_duplicate")


def extract_first_frame(video_path: str, output_frame_path: str) -> dict:
    """Extract the first frame of a video as a JPEG."""
    args = [
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        output_frame_path,
    ]
    return _run_ffmpeg(args, "extract_first_frame")


def burn_overlay_text(input_path: str, output_path: str, overlays, probe: dict) -> dict:
    """
    Burn timed overlay text onto video using FFmpeg drawtext.
    Accepts a single string or a list of {text,start,end} / strings.
    """
    duration = float(probe.get("duration", 0.0) or 0.0)
    if isinstance(overlays, str):
        timeline = build_overlay_timeline([overlays], duration)
    else:
        timeline = []
        for idx, item in enumerate(overlays or []):
            if isinstance(item, dict):
                text = str(item.get("text", "")).strip()
                if not text:
                    continue
                start = float(item.get("start", 0.0) or 0.0)
                end = float(item.get("end", duration or (start + 1.0)) or (duration or (start + 1.0)))
                timeline.append({"text": text, "start": start, "end": max(start + 0.1, end)})
            else:
                text = str(item).strip()
                if text:
                    timeline.append({"text": text, "start": 0.0, "end": duration or 9999.0})
        if timeline and all(item["start"] == 0.0 and item["end"] == (duration or 9999.0) for item in timeline):
            timeline = build_overlay_timeline([item["text"] for item in timeline], duration)

    if not timeline:
        return {"success": False, "error": "No valid overlay text entries were provided."}

    font_path = _resolve_drawtext_font()
    filter_parts = []
    current_label = "[0:v]"
    line_spacing = max(12, int((probe.get("height", 1920) or 1920) * 0.018))
    font_size = max(42, int((probe.get("height", 1920) or 1920) * 0.065))

    for idx, overlay in enumerate(timeline):
        lines = _wrap_overlay_lines(overlay["text"])
        if not lines:
            continue
        line_count   = len(lines)
        block_height = line_count * font_size + max(0, line_count - 1) * line_spacing
        # Bottom-anchor: 20px from bottom edge
        base_y       = f"h-{block_height + 20}"
        enable_expr  = f"between(t\\,{overlay['start']:.3f}\\,{overlay['end']:.3f})"

        for line_idx, line in enumerate(lines):
            escaped = _escape_drawtext(line)
            next_label = f"[v_{idx}_{line_idx}]"
            draw = (
                f"{current_label}drawtext=text='{escaped}':"
                f"x=(w-text_w)/2:"
                f"y={base_y}+{line_idx * (font_size + line_spacing)}:"
                f"fontsize={font_size}:"
                f"fontcolor=white:"
                f"borderw=4:bordercolor=black@0.95:"
                f"shadowx=3:shadowy=3:shadowcolor=black@0.95:"
                f"line_spacing={line_spacing}:"
                f"enable='{enable_expr}'"
            )
            if font_path:
                draw += f":fontfile='{_escape_drawtext(font_path)}'"
            filter_parts.append(f"{draw}{next_label}")
            current_label = next_label

    if not filter_parts:
        return {"success": False, "error": "Overlay text produced no drawable lines."}

    args = [
        "-i", input_path,
        "-filter_complex", ";".join(filter_parts),
        "-map", current_label,
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]
    return _run_ffmpeg(args, "burn_overlay_text")


def final_encode(input_path: str, output_path: str) -> dict:
    """
    Final clean encode pass. libx264, aac, CRF 23, fast preset, faststart.
    """
    args = [
        "-i", input_path,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]
    return _run_ffmpeg(args, "final_encode")


def extract_audio(video_path: str, audio_path: str) -> dict:
    """Extract audio track from video (general-purpose MP3)."""
    args = [
        "-i", video_path,
        "-vn",
        "-acodec", "libmp3lame",
        audio_path,
    ]
    return _run_ffmpeg(args, "extract_audio")


def extract_whisper_audio(video_path: str, output_wav_path: str) -> dict:
    """
    Rip a Whisper-compatible WAV from any video file using ffmpeg.

    Enforces:
        -ac 1      → force mono (1 channel) — prevents PyTorch tensor shape mismatches
        -ar 16000  → resample to 16 kHz     — Whisper's native sample rate
        -f wav     → PCM WAV container       — zero-dependency, unambiguous format

    Returns:
        {"success": True}  on success
        {"success": False, "error": <stderr tail>}  on failure

    Raises:
        Never — all errors are captured and returned in the result dict.
    """
    if not video_path or not os.path.isfile(video_path):
        return {"success": False, "error": f"Source file not found: {video_path!r}"}

    args = [
        "-i",  video_path,
        "-vn",            # strip all video streams
        "-ac", "1",       # force mono — eliminates channel-count tensor mismatches
        "-ar", "16000",   # resample to 16 kHz — Whisper's native rate
        "-f",  "wav",     # WAV container (PCM s16le by default)
        output_wav_path,
    ]

    log.info(
        "[extract_whisper_audio] extracting mono/16 kHz WAV: %s → %s",
        video_path,
        output_wav_path,
    )

    try:
        cmd = ["ffmpeg", "-y"] + args
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if proc.returncode != 0:
            stderr_tail = proc.stderr[-2000:] if proc.stderr else "(no stderr)"
            log.error(
                "[extract_whisper_audio] ffmpeg exited %d:\n%s",
                proc.returncode,
                stderr_tail,
            )
            return {
                "success": False,
                "error": f"ffmpeg audio extraction failed (exit {proc.returncode}): {stderr_tail}",
            }

        if not os.path.isfile(output_wav_path) or os.path.getsize(output_wav_path) == 0:
            return {"success": False, "error": "ffmpeg produced no output WAV (empty or missing file)"}

        log.info(
            "[extract_whisper_audio] WAV written: %d bytes",
            os.path.getsize(output_wav_path),
        )
        return {"success": True}

    except subprocess.TimeoutExpired:
        log.error("[extract_whisper_audio] ffmpeg timed out after 300 s")
        return {"success": False, "error": "ffmpeg audio extraction timed out after 300 s"}
    except FileNotFoundError:
        return {"success": False, "error": "ffmpeg not found in PATH"}
    except Exception as exc:  # pragma: no cover
        log.exception("[extract_whisper_audio] unexpected error")
        return {"success": False, "error": f"extract_whisper_audio unexpected error: {exc}"}


def extract_keyframes(video_path: str, output_dir: str, count: int = 5) -> dict:
    """Capture N representative keyframes from the video."""
    probe = probe_video(video_path)
    if not probe["success"]:
        return probe
    
    duration = probe["duration"]
    interval = duration / (count + 1)
    
    frames = []
    for i in range(1, count + 1):
        timestamp = i * interval
        frame_name = f"keyframe_{i}.jpg"
        frame_path = os.path.join(output_dir, frame_name)
        args = [
            "-ss", str(round(timestamp, 3)),
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            frame_path
        ]
        res = _run_ffmpeg(args, f"extract_keyframe_{i}")
        if res["success"]:
            frames.append(frame_path)
    
    return {"success": len(frames) > 0, "frames": frames}


def run_repurpose_extraction(input_path: str, work_dir: str) -> dict:
    """Extract audio and 5 keyframes."""
    uid = str(uuid.uuid4())[:8]
    steps_done = []

    probe = probe_video(input_path)
    if not probe["success"]:
        return {"success": False, "error": probe["error"]}
    steps_done.append("video probed")

    audio_path = os.path.join(work_dir, f"{uid}_audio.mp3")
    audio_res = extract_audio(input_path, audio_path)
    if audio_res["success"]:
        steps_done.append("audio extracted")
    else:
        return {"success": False, "error": f"Audio extraction failed: {audio_res['error']}"}

    frames_dir = os.path.join(work_dir, "keyframes")
    os.makedirs(frames_dir, exist_ok=True)
    frames_res = extract_keyframes(input_path, frames_dir, count=5)
    if frames_res["success"]:
        steps_done.append("5 keyframes captured")
    else:
        return {"success": False, "error": "Keyframe extraction failed"}

    return {
        "success": True,
        "audio_path": audio_path,
        "keyframes": frames_res["frames"],
        "processing_steps": steps_done,
        "duration": probe["duration"]
    }


def render_repurpose_default(input_path: str, output_path: str, overlay_text: str, bg_color: str = "#000000") -> dict:
    """
    Direct Download Mode:
    Centered video, black background (or user hex), and a random overlay.
    """
    probe = probe_video(input_path)
    if not probe["success"]: return probe

    tw, th = 1080, 1920 # Default to 9:16 for social
    
    # Scale video to fit, center on background
    filter_complex = (
        f"[0:v]scale={tw}:-1[scaled];"
        f"color=c={bg_color}:s={tw}x{th}[bg];"
        f"[bg][scaled]overlay=(W-w)/2:(H-h)/2[base]"
    )
    
    # Burn overlay text
    font_path = _resolve_drawtext_font()
    lines = _wrap_overlay_lines(overlay_text)
    font_size    = 64
    line_spacing = 15
    block_height = len(lines) * font_size + max(0, len(lines) - 1) * line_spacing
    # Bottom-anchor: 20px from bottom, 24px side margins
    base_y = f"h-{block_height + 20}"
    
    drawtext_filters = []
    for i, line in enumerate(lines):
        escaped = _escape_drawtext(line)
        draw = (
            f"drawtext=text='{escaped}':x=(w-text_w)/2:y={base_y}+{i*(font_size+line_spacing)}:"
            f"fontsize={font_size}:fontcolor=white:borderw=4:bordercolor=black@0.9"
        )
        if font_path:
            draw += f":fontfile='{_escape_drawtext(font_path)}'"
        drawtext_filters.append(draw)
    
    final_filter = f"{filter_complex};[base]{','.join(drawtext_filters)}[out]"
    
    args = [
        "-i", input_path,
        "-filter_complex", final_filter,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]
    return _run_ffmpeg(args, "render_repurpose_default")

