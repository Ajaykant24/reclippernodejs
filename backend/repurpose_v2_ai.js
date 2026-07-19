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

let client = null
let clientKey = null

function getApiKey() {
  return process.env.GEMINI_API_KEY || ''
}

function getModel() {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash'
}

function hasGeminiKey() {
  const key = getApiKey()
  return Boolean(key && key !== 'put_your_gemini_api_key_here')
}

function getClient() {
  if (!hasGeminiKey()) throw new Error('GEMINI_API_KEY not set')
  const key = getApiKey()
  // Recreate client if key changed
  if (!client || clientKey !== key) {
    const { GoogleGenAI } = require('@google/genai')
    client = new GoogleGenAI({ apiKey: key })
    clientKey = key
  }
  return client
}

const OVERLAY_PROMPT = `You run a viral meme page with 2M followers. Someone sent you this transcript and you need to write 20 overlay texts to put on the video before reposting it.

Transcript: "{transcript}"

Write 20 overlay texts. Each one must be the REACTION or REFRAME — what the viewer feels, thinks, or would text their group chat — NOT a summary of what was said. Every line must be specific to this exact transcript. No generic lines that could work on any video.

Mix these styles across the 20:
- Reaction: "bro really said that with his whole chest"
- Universal: "every American watching this rn"
- POV: "POV: you just realized nothing is changing"
- Call-out: "they really thought we wouldn't notice"
- Tag-a-friend: "send this to someone who still believes it"
- Inner monologue: "me pretending i'm fine after hearing this"
- Dark humor: "my bank account and my patience: both gone"
- Validation: "ngl he said what nobody else had the guts to say"

Rules: under 15 words each, casual American slang, end each line with one fitting emoji from: 😭 💀 🔥 😤 👀 🤯 💸 😮‍💨 🫠 🤡 😐 🙃 💔 👏 🫡

Output only the 20 lines, numbered 1 to 20. No other text.`

const CAPTION_PROMPT = `You are an elite Instagram caption writer who specializes in viral short-form content for American audiences. You understand parasocial psychology, cultural timing, emotional resonance, and what makes people stop mid-scroll.

TRANSCRIPT:
{transcript}

Watch the entire video. Do not skim. Then extract:
Context Layer
Every person visible — full legal name or widely-known identity, what they've done that matters, why this specific audience cares about them right now
Exact scene, location, event, era, and emotional stakes — infer confidently and specifically if not explicitly shown. Never hedge. Never say "appears to be."
The single sharpest viral moment in the video — the 2-second clip someone would screenshot and why it psychologically lands
The dominant emotional frequency: chaotic, tender, triumphant, raw, unhinged, nostalgic, surreal, legendary
Caption Structure — one flowing piece, no headings, no bullets, no bold labels, pure paragraphs:
Hook line — your single most important sentence. It must create a gap the reader needs to close. Match the video's exact emotional register. Funny = deadpan or absurdist. Intense = declarative and sharp. Emotional = intimate and immediate. Never open with a question. Never open with "This is..." or "Watch as..." Never be generic.
The full story — real names, real context, real stakes. Write like you're voice-messaging your culturally-fluent American friend who's completely off the grid. Assume they're smart. Don't over-explain. Give them the vivid, specific version — the one that makes them feel like they were there.
The time arc (this is the heart of the caption — make it richly detailed) — give the full context across three beats:
  • PAST: the backstory, history, or chain of events that led to this exact moment. Who these people are, what they've done before, what built up to this.
  • PRESENT: what is actually happening on screen right now and why it matters in this exact instant — the stakes, the tension, the why-now.
  • FUTURE: what this signals, sets in motion, or foreshadows — the ripple effect, what comes next, why it'll still matter.
The layer nobody caught — 2–3 lines of background, history, or context that reframes what they just watched. Make them feel like insiders. This is what earns saves and shares.
The American mirror — one detailed paragraph (this video is for a U.S. audience) connecting this moment directly to what Americans are collectively feeling, living through, debating, or nostalgic about right now. Make the relatability explicit and specific to American life, culture, politics, or memory — not vague. The "this is bigger than the video, this is about us" beat.
The closer — one single line that leaves them with an emotion. Not a summary. An aftertaste. Make them feel seen, fired up, nostalgic, proud, or devastated. This line determines whether they share it.
Emoji selection logic — end the caption with exactly one emoji based on dominant energy:
🔥 hype / legendary moment | 😭 emotional / heartbreaking | 💀 chaotic / unhinged funny | 🫡 deep respect / tribute | 👏 genuinely inspiring | 🤯 mind-blowing / surreal
Non-negotiable rules:
Word range: aim for 180–280 words — detailed and rich, never thin or generic, but never padded with filler
Zero hashtags — anywhere
Do NOT include any call-to-action, follow prompt, credit line, handle, or @mention (e.g. "Follow @...", "DM @...", "Credit to...") — none of that, ever
Zero vague language: never write "a man," "someone," "a woman," "an athlete," "a celebrity" — always the real name or a specific earned title
Never use filler transitions: "In this video," "As you can see," "It's clear that"
If exact details are unknown, make a confident, specific, educated inference — commit to it. Vagueness kills virality.
No passive voice. No hedging. No corporate-sounding phrases.
Every single line must justify its existence. If it doesn't add emotion, context, or forward momentum — cut it.
Write like a real person with taste, not a content template with a pulse
Quality bar: Before you output — ask yourself: would someone screenshot this caption specifically? If not, rewrite it.

Return ONLY the caption. No labels, no headings, no JSON. Raw caption text followed by the single emoji.`

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
  const config = { temperature: 1.0 }
  if (jsonMode) config.responseMimeType = 'application/json'
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini request timed out after 120s')), 120000)
  )
  const response = await Promise.race([
    ai.models.generateContent({
      model: getModel(),
      contents,
      config,
    }),
    timeout,
  ])
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

async function callGeminiWithRetry(prompt, jsonMode, videoFile, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await callGemini(prompt, jsonMode, videoFile)
    } catch (err) {
      const msg = String(err.message || '')
      const is503 = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('overloaded')
      const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')
      if ((is503 || is429) && attempt < retries) {
        const base = attempt * 10000
        const jitter = Math.floor(Math.random() * 4000)
        const wait = base + jitter
        console.warn(`[repurpose_v2_ai] Gemini ${is429 ? '429' : '503'}, retrying in ${(wait/1000).toFixed(1)}s (attempt ${attempt}/${retries})`)
        await sleep(wait)
        continue
      }
      throw err
    }
  }
}

async function generateOverlays(transcript, videoFile = null) {
  const prompt = OVERLAY_PROMPT.replace('{transcript}', transcript)
  let rawText
  try {
    rawText = await callGeminiWithRetry(prompt, false, videoFile)
  } catch (err) {
    console.error('[repurpose_v2_ai] Gemini overlay call failed:', err.message)
    return [...DEFAULT_OVERLAYS]
  }
  console.log('[repurpose_v2_ai] Overlay raw response:', String(rawText || '').slice(0, 400))
  const overlays = String(rawText || '')
    .split('\n')
    .filter(line => /^\d+\.\s+\S/.test(line.trim()))
    .map(line => line.trim().replace(/^\d+\.\s*/, '').trim())
    // Strip markdown bold/italic asterisks so overlays never render literal ** characters.
    .map(line => line.replace(/\*+/g, '').trim())
    .filter(line => line.length > 0 && line.length < 120)
  if (overlays.length >= 5) return overlays.slice(0, 20)
  console.warn('[repurpose_v2_ai] Could not parse overlays, only got', overlays.length, '| full raw:', String(rawText || '').slice(0, 500))
  return [...DEFAULT_OVERLAYS]
}

async function generateCaption(transcript, videoFile = null) {
  const prompt = CAPTION_PROMPT.replace('{transcript}', transcript)
  try {
    const caption = String(await callGeminiWithRetry(prompt, false, videoFile) || '').trim()
    return caption || DEFAULT_CAPTION
  } catch (err) {
    console.error('[repurpose_v2_ai] Gemini caption call failed:', err.message)
    return DEFAULT_CAPTION
  }
}

// Merge the user's original overlay into an overlay list: in 'original'/'exact'
// mode it goes first (= becomes the default burned-in text), otherwise appended.
function mergeOriginalOverlay(overlays, overlayMode, originalOverlay) {
  if (!originalOverlay) return overlays
  const rest = overlays.filter(t => t !== originalOverlay)
  if (overlayMode === 'original' || overlayMode === 'exact') {
    return [originalOverlay, ...rest]
  }
  return [...rest, originalOverlay]
}

async function runGeminiPipeline(videoPath, intensity = 'medium', ratio = '9:16', tone = 'relatable', overlayMode = 'generated', originalOverlay = '') {
  if (!hasGeminiKey()) {
    console.warn('[repurpose_v2_ai] GEMINI_API_KEY not set — using defaults')
    const overlays = mergeOriginalOverlay(overlayMode === 'exact' ? [] : [...DEFAULT_OVERLAYS], overlayMode, originalOverlay)
    return { context: {}, overlays, caption: DEFAULT_CAPTION }
  }

  // Step 1: Transcribe with Whisper
  let transcript = ''
  if (videoPath && fs.existsSync(videoPath)) {
    try {
      console.log('[repurpose_v2_ai] Transcribing with Whisper...')
      const { transcribeVideo } = require('./transcriber')
      const result = await transcribeVideo(videoPath)
      if (result.success && result.transcript) {
        transcript = result.transcript
        console.log('[repurpose_v2_ai] Transcript:', transcript.slice(0, 80) + '...')
      } else {
        console.warn('[repurpose_v2_ai] Whisper failed:', result.error)
      }
    } catch (error) {
      console.warn('[repurpose_v2_ai] Whisper exception:', error.message)
    }
  }

  // Step 2: Fallback context if no transcript (never use filename — it's a technical path)
  if (!transcript) {
    transcript = '[No speech detected in this video. Generate 20 highly relatable, viral overlay texts and an Instagram caption suited for a short-form social media video clip.]'
  }

  // Step 2b: Upload the video to Gemini so the caption can describe the actual on-screen
  // context (people, scene, era) — not just the transcript. Best-effort; falls back gracefully.
  let captionVideoFile = null
  if (videoPath && fs.existsSync(videoPath)) {
    try {
      console.log('[repurpose_v2_ai] Uploading video to Gemini for caption context...')
      captionVideoFile = await uploadVideoForGemini(videoPath)
    } catch (error) {
      console.warn('[repurpose_v2_ai] Gemini video upload failed, using transcript only:', error.message)
    }
  }

  // Step 3: Generate overlays + caption with Gemini.
  // In 'exact' mode the user wants only the exact on-screen text — skip AI overlay generation entirely.
  const skipOverlayGeneration = overlayMode === 'exact'
  try {
    console.log('[repurpose_v2_ai] Sending to Gemini...')
    const [overlaysResult, captionResult] = await Promise.allSettled([
      skipOverlayGeneration ? Promise.resolve([]) : generateOverlays(transcript),
      generateCaption(transcript, captionVideoFile),
    ])
    let overlays = skipOverlayGeneration
      ? []
      : (overlaysResult.status === 'fulfilled' ? overlaysResult.value : [...DEFAULT_OVERLAYS])
    const caption = captionResult.status === 'fulfilled' ? captionResult.value : DEFAULT_CAPTION

    // Merge original overlay: always include it, position based on mode
    overlays = mergeOriginalOverlay(overlays, overlayMode, originalOverlay)

    console.log(`[repurpose_v2_ai] Done — ${overlays.length} overlays, caption: ${caption.slice(0, 60)}...`)
    return { context: {}, overlays, caption }
  } catch (error) {
    console.error('[repurpose_v2_ai] Gemini failed:', error.message)
    const overlays = mergeOriginalOverlay(overlayMode === 'exact' ? [] : [...DEFAULT_OVERLAYS], overlayMode, originalOverlay)
    return { context: {}, overlays, caption: DEFAULT_CAPTION }
  }
}

module.exports = {
  DEFAULT_OVERLAYS,
  DEFAULT_CAPTION,
  extractJson,
  runGeminiPipeline,
}
