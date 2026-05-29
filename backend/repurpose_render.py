"""
repurpose_render.py — React-to-FFmpeg rendering bridge.

This module is imported by repurpose_router.py to keep the pipeline file clean.
The key function here is render_repurpose_export(), which translates a
RepurposeExportRequest (with normalized Y position) into a concrete FFmpeg
single-pass filter chain at the target 1080×1920 canvas.
"""

import os
import subprocess


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
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return ""


def _wrap_lines(text: str, max_non_space: int = 25, max_lines: int = 3) -> list[str]:
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


def _run(args: list, step: str) -> dict:
    cmd = ["ffmpeg", "-y"] + args
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            return {"success": False, "error": f"FFmpeg [{step}] rc={r.returncode}: {r.stderr[-2000:]}"}
        return {"success": True}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"FFmpeg [{step}] timed out"}
    except FileNotFoundError:
        return {"success": False, "error": "ffmpeg not found in PATH"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def render_repurpose_export(
    input_path: str,
    output_path: str,
    background_hex: str,
    overlay_text: str,
    overlay_y_position_normalized: float,
    canvas_w: int = 1080,
    canvas_h: int = 1920,
) -> dict:
    """
    React-to-FFmpeg rendering bridge.

    Parameters match RepurposeExportRequest exactly:
      background_hex                : CSS hex, e.g. '#0d0d1a'
      overlay_text                  : hook string chosen by the user (empty = no text)
      overlay_y_position_normalized : float 0.0 (top) … 1.0 (bottom)

    Single FFmpeg pass:
      [bg] solid color canvas
      [fg] video scaled to fit (letterboxed, preserving AR)
      overlay at center
      drawtext at normalized Y → absolute pixel Y
    """
    # Map normalized Y to pixel space
    norm_y = max(0.02, min(0.98, float(overlay_y_position_normalized)))
    font_size = max(48, int(canvas_h * 0.055))         # ~106 px at 1920h
    line_spacing = max(8, int(canvas_h * 0.012))        # ~23 px at 1920h
    y_px = int(norm_y * canvas_h) - font_size // 2
    y_px = max(10, min(canvas_h - font_size - 10, y_px))

    # ── Step 1: background + letterbox composite ───────────────────────────
    # Normalize hex: strip '#' for FFmpeg color spec
    bg = background_hex.lstrip("#")
    filter_complex = (
        f"color=c=0x{bg}:s={canvas_w}x{canvas_h}:r=30[bg];"
        f"[0:v]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=decrease,"
        f"setsar=1[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2[base]"
    )

    # ── Step 2: drawtext (only if hook text provided) ─────────────────────
    map_label = "[base]"
    if overlay_text and overlay_text.strip():
        font_path = _resolve_font()
        lines = _wrap_lines(overlay_text.strip())
        # Bottom-anchor: block sits 20px from bottom, 24px side margins each side
        font_size    = max(48, int(canvas_h * 0.055))
        line_spacing = max(8, int(canvas_h * 0.012))
        block_height = len(lines) * font_size + max(0, len(lines) - 1) * line_spacing
        base_y       = max(24, canvas_h - block_height - 20)
        current = "base"

        for i, line in enumerate(lines):
            esc      = _escape_drawtext(line)
            line_y   = base_y + i * (font_size + line_spacing)
            next_lbl = f"txt{i}"

            draw = (
                f"[{current}]drawtext="
                f"text='{esc}':"
                f"x=(w-text_w)/2:"
                f"y={line_y}:"
                f"fontsize={font_size}:"
                f"fontcolor=white:"
                f"borderw=5:bordercolor=black@0.92:"
                f"shadowx=3:shadowy=3:shadowcolor=black@0.85"
            )
            if font_path:
                draw += f":fontfile='{_escape_drawtext(font_path)}'"
            draw += f"[{next_lbl}]"

            filter_complex += f";{draw}"
            current = next_lbl

        map_label = f"[{current}]"

    args = [
        "-i", input_path,
        "-filter_complex", filter_complex,
        "-map", map_label,
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]
    return _run(args, "render_repurpose_export")
