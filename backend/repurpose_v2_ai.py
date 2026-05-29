"""
repurpose_v2_ai.py — AI pipeline for the V2 Repurpose Tool.

Uses google-genai SDK (v1.x) with gemini-2.5-flash.
Pass 1: Transcribe the uploaded short clip using Whisper.
Pass 2a: Gemini — generate 20 overlay texts (meme page prompt).
Pass 2b: Gemini — generate Instagram caption (elite writer prompt).
Passes 2a and 2b run concurrently.
"""

import json
import logging
import os
import re
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

from google import genai
from google.genai import types

log = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_env_file(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file(os.path.join(BASE_DIR, ".env"))

_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

_client: genai.Client | None = None


def _has_gemini_key() -> bool:
    return bool(_GEMINI_API_KEY and _GEMINI_API_KEY != "put_your_gemini_api_key_here")

def _get_client() -> genai.Client:
    global _client
    if not _has_gemini_key():
        raise RuntimeError("GEMINI_API_KEY not set")
    if _client is None:
        _client = genai.Client(api_key=_GEMINI_API_KEY)
    return _client


# ── Prompt 1: Overlay texts ────────────────────────────────────────────────────

_OVERLAY_PROMPT = """\
You are the admin of a highly popular, relatable meme page based in the United States. You treat your audience like your close friends and group chat.
Your job is to deeply analyze the video transcript and generate 20 highly relatable, viral-worthy overlay texts.

Here is the transcript of the video clip:
{transcript}

Return your response in strict JSON format:
{{
  "overlays": [
    {{ "tone": "Tone Name", "text": "Overlay text with emoji" }}
  ]
}}

Ensure exactly 20 overlay texts are generated.

### 20 OVERLAY TEXTS
Analyze the video carefully — its visuals, energy, pacing, expressions, actions, and implied emotion. Then generate exactly 20 overlay text options.

Each overlay text must:
- Be punchy, engaging, and built for mobile screens (1-2 lines long to create a strong hook)
- Be written in one of these distinct tones/styles tailored to US meme culture: POV (Point of View), Highly Relatable / "Me IRL", US Internet Slang / Gen-Z, Sarcastic / Dry Humor, Unhinged / Chaotic, Nostalgic / Shared Experience, Bro-coded / Group Chat Energy, or Self-Deprecating.
- CRITICAL: Directly reflect the SPECIFIC dialogue, actions, or unique situation happening in the video.
- CRITICAL: DO NOT use generic meme tropes (e.g., "me at 2am", "my last brain cell", "corporate job", "my boss"). The text MUST feel like it was written specifically for this exact video clip.
- Make a viewer stop scrolling
- Include a matching emoji IN THE TEXT ITSELF, not in the tone label.
"""


# ── Prompt 2: Instagram caption ────────────────────────────────────────────────

_CAPTION_PROMPT = """\
You are an elite Instagram caption writer who specializes in viral short-form content for American audiences. You understand parasocial psychology, cultural timing, emotional resonance, and what makes people stop mid-scroll.

Here is the transcript of the video clip:
{transcript}

Watch the entire transcript. Do not skim. Then extract:

Context Layer:
- Every person visible — full legal name or widely-known identity, what they've done that matters, why this specific audience cares about them right now
- Exact scene, location, event, era, and emotional stakes — infer confidently and specifically if not explicitly shown. Never hedge. Never say "appears to be."
- The single sharpest viral moment in the video — the 2-second clip someone would screenshot and why it psychologically lands
- The dominant emotional frequency: chaotic, tender, triumphant, raw, unhinged, nostalgic, surreal, legendary

Caption Structure — one flowing piece, no headings, no bullets, no bold labels, pure paragraphs:
1. Hook line — your single most important sentence. It must create a gap the reader needs to close. Match the video's exact emotional register. Funny = deadpan or absurdist. Intense = declarative and sharp. Emotional = intimate and immediate. Never open with a question. Never open with "This is..." or "Watch as..." Never be generic.
2. The full story — real names, real context, real stakes. Write like you're voice-messaging your culturally-fluent American friend who's completely off the grid. Assume they're smart. Don't over-explain. Give them the vivid, specific version — the one that makes them feel like they were there.
3. The layer nobody caught — 2-3 lines of background, history, or context that reframes what they just watched. Make them feel like insiders. This is what earns saves and shares.
4. The cultural mirror — one tight paragraph connecting this moment to something Americans are collectively feeling, living through, or nostalgic about right now. Not a reference — a resonance. The "this is bigger than the video" beat.
5. The closer — one single line that leaves them with an emotion. Not a summary. An aftertaste. Make them feel seen, fired up, nostalgic, proud, or devastated. This line determines whether they share it.

Emoji selection logic — pick exactly one based on dominant energy:
🔥 hype / legendary moment | 😭 emotional / heartbreaking | 💀 chaotic / unhinged funny | 🫡 deep respect / tribute | 👏 genuinely inspiring | 🤯 mind-blowing / surreal

Non-negotiable rules:
- Hard cap: under 200 words total
- Zero hashtags — anywhere
- Zero vague language: never write "a man," "someone," "a woman," "an athlete," "a celebrity" — always the real name or a specific earned title
- Never use filler transitions: "In this video," "As you can see," "It's clear that"
- If exact details are unknown, make a confident, specific, educated inference — commit to it. Vagueness kills virality.
- No passive voice. No hedging. No corporate-sounding phrases.
- Every single line must justify its existence. If it doesn't add emotion, context, or forward momentum — cut it.
- Write like a real person with taste, not a content template with a pulse

Quality bar: Before you output — ask yourself: would someone screenshot this caption specifically? If not, rewrite it.

Return ONLY the caption text. No JSON. No labels. No headings. Just the raw caption paragraph(s) followed by the single emoji.
"""


# ── Defaults ───────────────────────────────────────────────────────────────────

_DEFAULT_OVERLAYS = [
    "wait for it 👀", "this changed everything", "the ending got me", "we've all been here",
    "pov: you realized", "not me doing this", "me at 3am", "is this normal?",
    "the way i screamed", "i can't stop watching", "who else does this?", "the accuracy",
    "this is your sign", "i feel attacked", "the simulation is glitching", "explain this",
    "i'm screaming", "core memory", "the intrusive thoughts won", "i need answers"
]

_DEFAULT_CAPTION = (
    "Some moments just stop you mid-scroll. This one did it for us. "
    "There's something raw and real happening here that most people walk right past — "
    "but once you see it, you can't unsee it. Pay attention to the details. "
    "Save this for the next time someone tells you it's not that serious."
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> str:
    """Robustly extract the first valid JSON object from a string."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()
    if text.startswith("{"):
        return text
    start = text.find("{")
    end   = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1]
    return text


def _call_gemini(prompt: str, json_mode: bool = True, video_file=None) -> str:
    """Single Gemini API call. Returns raw response text."""
    client = _get_client()
    config = types.GenerateContentConfig(
        temperature=1.0,
        response_mime_type="application/json" if json_mode else "text/plain",
    )
    contents = [video_file, prompt] if video_file is not None else prompt
    response = client.models.generate_content(
        model=_GEMINI_MODEL,
        contents=contents,
        config=config,
    )
    return response.text


def _upload_video_for_gemini(video_path: str):
    client = _get_client()
    uploaded = client.files.upload(file=video_path)
    for _ in range(30):
        state = str(getattr(uploaded, "state", "") or "").upper()
        if not state or "ACTIVE" in state:
            return uploaded
        if "FAILED" in state:
            raise RuntimeError("Gemini video upload failed")
        time.sleep(2)
        uploaded = client.files.get(name=uploaded.name)
    return uploaded


def _generate_overlays(transcript: str, video_file=None) -> list[str]:
    """Call Gemini with the overlay prompt and return list of text strings."""
    prompt   = _OVERLAY_PROMPT.format(transcript=transcript)
    raw_text = _call_gemini(prompt, json_mode=True, video_file=video_file)
    log.info("[repurpose_v2_ai][overlays] Raw (%d chars): %.400s", len(raw_text), raw_text)

    raw  = _extract_json(raw_text)
    data = json.loads(raw)
    opts = data.get("overlays", [])

    overlays = [opt.get("text", "") for opt in opts if opt.get("text")]
    log.info("[repurpose_v2_ai][overlays] Parsed %d overlays", len(overlays))

    return overlays if overlays else _DEFAULT_OVERLAYS.copy()


def _generate_caption(transcript: str, video_file=None) -> str:
    """Call Gemini with the elite caption prompt and return the caption string."""
    prompt   = _CAPTION_PROMPT.format(transcript=transcript)
    raw_text = _call_gemini(prompt, json_mode=False, video_file=video_file)
    caption  = raw_text.strip()
    log.info("[repurpose_v2_ai][caption] Raw (%d chars): %.400s", len(caption), caption)

    return caption if caption else _DEFAULT_CAPTION


# ── Main entry point ───────────────────────────────────────────────────────────

def run_gemini_pipeline(
    video_path: str,
    intensity: str = "medium",
    ratio: str = "9:16",
    tone: str = "relatable",
) -> dict:
    """
    Pipeline:
      Pass 1 — Whisper: transcribe video
      Pass 2a — Gemini: 20 overlay texts  (concurrent)
      Pass 2b — Gemini: Instagram caption (concurrent)

    Returns: {context, overlays, caption}
    """
    log.info("[repurpose_v2_ai] Starting pipeline (Whisper -> Gemini %s)", _GEMINI_MODEL)
    transcript = ""

    if video_path and os.path.exists(video_path):
        try:
            from transcriber import transcribe_video
            result = transcribe_video(video_path)
            if result.get("success"):
                transcript = result.get("transcript", "")
                log.info("[repurpose_v2_ai] Transcription OK: %d chars", len(transcript))
            else:
                log.warning("[repurpose_v2_ai] Whisper failed: %s", result.get("error"))
        except Exception as exc:
            log.error("[repurpose_v2_ai] Whisper exception: %s", exc)
    else:
        log.warning("[repurpose_v2_ai] video_path missing or not found: %s", video_path)

    transcript_available = bool(transcript.strip())
    if not transcript_available:
        transcript = "[No transcript extracted. Analyze the attached video directly, including visual action, audio cues, pacing, expressions, and context.]"
        log.info("[repurpose_v2_ai] Using placeholder transcript")

    if not _has_gemini_key():
        log.warning("[repurpose_v2_ai] GEMINI_API_KEY not set — using defaults")
        return {"context": {}, "overlays": _DEFAULT_OVERLAYS, "caption": _DEFAULT_CAPTION}

    overlays = _DEFAULT_OVERLAYS.copy()
    caption  = _DEFAULT_CAPTION
    video_file = None

    try:
        if not transcript_available and video_path and os.path.exists(video_path):
            log.info("[repurpose_v2_ai] Uploading video to Gemini for direct multimodal analysis")
            video_file = _upload_video_for_gemini(video_path)

        # Run both Gemini calls concurrently
        with ThreadPoolExecutor(max_workers=2) as pool:
            fut_overlays = pool.submit(_generate_overlays, transcript, video_file)
            fut_caption  = pool.submit(_generate_caption,  transcript, video_file)

            for fut in as_completed([fut_overlays, fut_caption]):
                try:
                    fut.result()  # surface exceptions early
                except Exception as exc:
                    log.error("[repurpose_v2_ai] Concurrent call failed: %s\n%s",
                              exc, traceback.format_exc())

        overlays = fut_overlays.result() if not fut_overlays.exception() else _DEFAULT_OVERLAYS.copy()
        caption  = fut_caption.result()  if not fut_caption.exception()  else _DEFAULT_CAPTION

    except Exception as e:
        log.error("[repurpose_v2_ai] Pipeline failed: %s\n%s", e, traceback.format_exc())

    log.info("[repurpose_v2_ai] Done: %d overlays, caption %d chars", len(overlays), len(caption))
    return {"context": {}, "overlays": overlays, "caption": caption}
