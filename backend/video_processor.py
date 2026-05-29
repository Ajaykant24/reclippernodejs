import os
import subprocess


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLIPS_DIR = os.path.join(BASE_DIR, "clips")
os.makedirs(CLIPS_DIR, exist_ok=True)


def generate_thumbnail(video_path: str, clip_id: str) -> str:
    thumb_path = os.path.join(CLIPS_DIR, f"{clip_id}_thumb.jpg")
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            "00:00:01",
            "-i",
            video_path,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            thumb_path,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or "Thumbnail generation failed")
    return thumb_path
