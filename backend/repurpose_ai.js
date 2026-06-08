const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

const REPURPOSE_PROMPT = `You are a master meme creator and social media strategist.
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
`

function extractJson(text) {
  let value = String(text || '')
  if (value.includes('```json')) value = value.split('```json', 2)[1].split('```', 1)[0]
  else if (value.includes('```')) value = value.split('```', 2)[1].split('```', 1)[0]
  return value.trim()
}

function fillPrompt(values) {
  return REPURPOSE_PROMPT
    .replace('{title}', values.title)
    .replace('{platform}', values.platform)
    .replace('{uploader}', values.uploader)
    .replace('{transcript}', values.transcript)
}

async function analyzeRepurpose(transcript, segments, duration, title = '', platform = '', uploader = '') {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) return { success: false, error: 'Gemini API key or google-genai missing.' }

  let GoogleGenAI
  try {
    ;({ GoogleGenAI } = require('@google/genai'))
  } catch {
    return { success: false, error: 'Gemini API key or google-genai missing.' }
  }

  const client = new GoogleGenAI({ apiKey })
  const transcriptSummary = (segments || [])
    .map(segment => `${segment.start || 0} - ${segment.end || 0}: ${segment.text || ''}`)
    .join('\\n')
  const prompt = fillPrompt({ title, platform, uploader, transcript: transcriptSummary })

  try {
    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        maxOutputTokens: 4096,
        temperature: 0.7,
      },
    })
    const data = JSON.parse(extractJson(response.text))
    const clips = []
    for (const clip of data.clips || []) {
      const start = Number.parseFloat(clip.start_time || 0)
      let end = Number.parseFloat(clip.end_time ?? duration)
      if (end - start < 5) end = Math.min(duration, start + 15)
      clips.push({
        start_time: start,
        end_time: end,
        hook: clip.new_hook || '',
        emotion: clip.meme_format || 'funny',
        virality_score: 9.5,
        overlay_texts: clip.overlay_texts || [clip.new_hook || ''],
        clip_caption: clip.new_caption || '',
        new_framing: clip.new_framing || '',
      })
    }
    return { success: true, data: { clips, caption: '' } }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

module.exports = {
  MODEL_NAME,
  REPURPOSE_PROMPT,
  extractJson,
  analyzeRepurpose,
  analyzeForRepurpose: analyzeRepurpose,
}
