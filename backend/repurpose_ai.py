import os
import json
import re

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None

MODEL_NAME = "gemini-2.0-flash"

REPURPOSE_PROMPT = """You are a master meme creator and social media strategist.
Analyze the following transcript from a video and transform it into 1-3 brand-new, original-feeling meme-style short clips.

Video Context:
Title: {title}
Platform: {platform}
Uploader: {uploader}

Transcript:
{transcript}

For each clip, you must provide:
1. start_time: The exact start time in seconds. Find a logical starting point.
2. end_time: The exact end time in seconds. Must be between 7 and 90 seconds total duration.
3. new_framing: A fresh angle (e.g., "POV:", "When you...", "Nobody:").
4. new_hook: A scroll-stopping opening line or on-screen text that reframes the clip.
5. new_caption: A completely rewritten caption for social media (TikTok/Reels).
6. meme_format: What meme style fits this moment.
7. overlay_texts: A list of 5-8 short, punchy on-screen text overlays to appear throughout the clip.

Return ONLY valid JSON in this exact format:
{{
    "clips": [
        {{
            "start_time": 10.5,
            "end_time": 25.0,
            "new_framing": "POV: You just woke up",
            "new_hook": "POV: You just woke up",
            "new_caption": "Relatable 😭 #meme #funny",
            "meme_format": "reaction",
            "overlay_texts": ["Wait for it...", "POV: You just woke up", "Bro really said that 😭", "I can't breathe", "Too accurate"]
        }}
    ]
}}
"""

def extract_json(text: str) -> str:
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0]
    return text.strip()

def analyze_repurpose(transcript: str, segments: list, duration: float, title: str = "", platform: str = "", uploader: str = "") -> dict:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or genai is None:
        return {"success": False, "error": "Gemini API key or google-genai missing."}
        
    client = genai.Client(api_key=api_key)
    
    transcript_summary = "\\n".join(f"{s.get('start', 0)} - {s.get('end', 0)}: {s.get('text', '')}" for s in segments)
    
    prompt = REPURPOSE_PROMPT.format(
        title=title,
        platform=platform,
        uploader=uploader,
        transcript=transcript_summary
    )
    
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                max_output_tokens=4096,
                temperature=0.7,
            ),
        )
        data = json.loads(extract_json(response.text))
        
        formatted_clips = []
        for c in data.get("clips", []):
            start = float(c.get("start_time", 0))
            end = float(c.get("end_time", duration))
            if end - start < 5:
                end = min(duration, start + 15)
                
            formatted_clips.append({
                "start_time": start,
                "end_time": end,
                "hook": c.get("new_hook", ""),
                "emotion": c.get("meme_format", "funny"),
                "virality_score": 9.5,
                "overlay_texts": c.get("overlay_texts", [c.get("new_hook", "")]),
                "clip_caption": c.get("new_caption", ""),
                "new_framing": c.get("new_framing", "")
            })
            
        return {"success": True, "data": {"clips": formatted_clips, "caption": ""}}
    except Exception as e:
        return {"success": False, "error": str(e)}
