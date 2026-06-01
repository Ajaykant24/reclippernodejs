const fs = require('fs')
const path = require('path')

const BASE_DIR = __dirname

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const raw = line.trim()
    if (!raw || raw.startsWith('#') || !raw.includes('=')) continue
    const separator = raw.indexOf('=')
    const key = raw.slice(0, separator).trim()
    const value = raw.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (process.env[key] == null) process.env[key] = value
  }
}

loadEnvFile(path.join(BASE_DIR, '.env'))

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

let client = null

function hasGeminiKey() {
  return Boolean(GEMINI_API_KEY && GEMINI_API_KEY !== 'put_your_gemini_api_key_here')
}

function getClient() {
  if (!hasGeminiKey()) throw new Error('GEMINI_API_KEY not set')
  if (!client) {
    const { GoogleGenAI } = require('@google/genai')
    client = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  }
  return client
}

const OVERLAY_PROMPT = `You are the admin of a highly popular, relatable meme page based in the United States. You treat your audience like your close friends and group chat.
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
`

const CAPTION_PROMPT = `You are an elite Instagram caption writer who specializes in viral short-form content for American audiences. You understand parasocial psychology, cultural timing, emotional resonance, and what makes people stop mid-scroll.

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
`

const DEFAULT_OVERLAYS = [
  'wait for it 👀', 'this changed everything', 'the ending got me', "we've all been here",
  'pov: you realized', 'not me doing this', 'me at 3am', 'is this normal?',
  'the way i screamed', "i can't stop watching", 'who else does this?', 'the accuracy',
  'this is your sign', 'i feel attacked', 'the simulation is glitching', 'explain this',
  "i'm screaming", 'core memory', 'the intrusive thoughts won', 'i need answers',
]

const DEFAULT_CAPTION = (
  'Some moments just stop you mid-scroll. This one did it for us. '
  + "There's something raw and real happening here that most people walk right past — "
  + "but once you see it, you can't unsee it. Pay attention to the details. "
  + "Save this for the next time someone tells you it's not that serious."
)

function extractJson(text) {
  let value = String(text || '').trim()
  value = value.replace(/^```(?:json)?\s*/i, '')
  value = value.replace(/\s*```$/, '')
  value = value.trim()
  if (value.startsWith('{')) return value
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return value.slice(start, end + 1)
  return value
}

async function callGemini(prompt, jsonMode = true, videoFile = null) {
  const ai = getClient()
  const { createPartFromUri } = require('@google/genai')
  const contents = videoFile != null
    ? [createPartFromUri(videoFile.uri, videoFile.mimeType), prompt]
    : prompt
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      temperature: 1.0,
      responseMimeType: jsonMode ? 'application/json' : 'text/plain',
    },
  })
  return response.text
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function uploadVideoForGemini(videoPath) {
  const ai = getClient()
  let uploaded = await ai.files.upload({ file: videoPath })
  for (let index = 0; index < 30; index += 1) {
    const state = String(uploaded.state || '').toUpperCase()
    if (!state || state.includes('ACTIVE')) return uploaded
    if (state.includes('FAILED')) throw new Error('Gemini video upload failed')
    await sleep(2000)
    uploaded = await ai.files.get({ name: uploaded.name })
  }
  return uploaded
}

async function generateOverlays(transcript, videoFile = null) {
  const prompt = OVERLAY_PROMPT.replace('{transcript}', transcript)
  const rawText = await callGemini(prompt, true, videoFile)
  const data = JSON.parse(extractJson(rawText))
  const overlays = (data.overlays || []).filter(option => option.text).map(option => option.text)
  return overlays.length ? overlays : [...DEFAULT_OVERLAYS]
}

async function generateCaption(transcript, videoFile = null) {
  const prompt = CAPTION_PROMPT.replace('{transcript}', transcript)
  const caption = String(await callGemini(prompt, false, videoFile) || '').trim()
  return caption || DEFAULT_CAPTION
}

async function runGeminiPipeline(videoPath, intensity = 'medium', ratio = '9:16', tone = 'relatable') {
  let transcript = ''

  if (videoPath && fs.existsSync(videoPath)) {
    try {
      const { transcribeVideo } = require('./transcriber')
      const result = await transcribeVideo(videoPath)
      if (result.success) transcript = result.transcript || ''
      else console.warn('[repurpose_v2_ai] Whisper failed:', result.error)
    } catch (error) {
      console.error('[repurpose_v2_ai] Whisper exception:', error.message)
    }
  } else {
    console.warn('[repurpose_v2_ai] video_path missing or not found:', videoPath)
  }

  const transcriptAvailable = Boolean(transcript.trim())
  if (!transcriptAvailable) {
    transcript = '[No transcript extracted. Analyze the attached video directly, including visual action, audio cues, pacing, expressions, and context.]'
  }

  if (!hasGeminiKey()) {
    console.warn('[repurpose_v2_ai] GEMINI_API_KEY not set — using defaults')
    return { context: {}, overlays: [...DEFAULT_OVERLAYS], caption: DEFAULT_CAPTION }
  }

  let videoFile = null
  try {
    if (!transcriptAvailable && videoPath && fs.existsSync(videoPath)) {
      videoFile = await uploadVideoForGemini(videoPath)
    }
    const [overlaysResult, captionResult] = await Promise.allSettled([
      generateOverlays(transcript, videoFile),
      generateCaption(transcript, videoFile),
    ])
    return {
      context: {},
      overlays: overlaysResult.status === 'fulfilled' ? overlaysResult.value : [...DEFAULT_OVERLAYS],
      caption: captionResult.status === 'fulfilled' ? captionResult.value : DEFAULT_CAPTION,
    }
  } catch (error) {
    console.error('[repurpose_v2_ai] Pipeline failed:', error)
    return { context: {}, overlays: [...DEFAULT_OVERLAYS], caption: DEFAULT_CAPTION }
  }
}

module.exports = {
  DEFAULT_OVERLAYS,
  DEFAULT_CAPTION,
  extractJson,
  runGeminiPipeline,
}
