const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const PLATFORM_DIMS = {
  instagram: [1080, 1920],
  youtube: [1080, 1920],
  tiktok: [1080, 1920],
}

function escapeDrawtext(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function resolveDrawtextFont() {
  const windir = process.env.WINDIR || 'C:\\Windows'
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = [
    process.env.SF_FONT_PATH || '',
    path.join(windir, 'Fonts', 'SF-Pro-Text-Regular.otf'),
    path.join(windir, 'Fonts', 'SF-Pro-Display-Regular.otf'),
    path.join(localAppData, 'Microsoft', 'Windows', 'Fonts', 'SF-Pro-Text-Regular.otf'),
    path.join(localAppData, 'Microsoft', 'Windows', 'Fonts', 'SF-Pro-Display-Regular.otf'),
    path.join(windir, 'Fonts', 'segoeui.ttf'),
    path.join(windir, 'Fonts', 'arial.ttf'),
    '/System/Library/Fonts/SFNS.ttf',
    '/System/Library/Fonts/SFNSDisplay.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  ]
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || ''
}

function codePointLength(text) {
  return Array.from(text).length
}

function wrapOverlayLines(text, maxNonSpace = 25, maxLines = 3) {
  const words = String(text || '').replace(/\n/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const lines = []
  let currentWords = []
  let currentLength = 0
  for (const word of words) {
    const wordLength = codePointLength(word.replace(/ /g, ''))
    if (currentWords.length && currentLength + wordLength > maxNonSpace) {
      lines.push(currentWords.join(' '))
      if (lines.length >= maxLines) break
      currentWords = [word]
      currentLength = wordLength
    } else {
      currentWords.push(word)
      currentLength += wordLength
    }
  }
  if (currentWords.length && lines.length < maxLines) lines.push(currentWords.join(' '))
  return lines
}

function buildOverlayTimeline(overlayTexts, duration) {
  const validTexts = (overlayTexts || []).map(text => String(text).trim()).filter(Boolean)
  if (!validTexts.length) return []
  const total = Math.max(Number(duration || 0.0), 0.1)
  const slot = total / validTexts.length
  return validTexts.map((text, index) => {
    const start = Number((index * slot).toFixed(3))
    const end = Number((index === validTexts.length - 1 ? total : (index + 1) * slot).toFixed(3))
    return { text, start, end: Math.max(start + 0.1, end) }
  })
}

function exec(command, args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function runFfmpeg(args, stepName) {
  try {
    await exec('ffmpeg', ['-y', ...args])
    return { success: true }
  } catch (error) {
    if (error.killed || error.code === 'ETIMEDOUT') {
      return { success: false, error: `FFmpeg [${stepName}] timed out after 300s` }
    }
    if (error.code === 'ENOENT') return { success: false, error: 'ffmpeg not found in PATH' }
    return { success: false, error: `FFmpeg [${stepName}] failed: ${String(error.stderr || '').slice(-2000)}` }
  }
}

async function probeVideo(filePath) {
  try {
    const result = await exec('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams', '-show_format',
      filePath,
    ], 30000)
    const data = JSON.parse(result.stdout)
    const videoStream = (data.streams || []).find(stream => stream.codec_type === 'video')
    if (!videoStream) return { success: false, error: 'No video stream found in file' }
    const width = Number.parseInt(videoStream.width || 0, 10)
    const height = Number.parseInt(videoStream.height || 0, 10)
    let fps = 30.0
    try {
      const [num, den] = String(videoStream.r_frame_rate || '30/1').split('/')
      fps = Number(num) / Number(den)
    } catch {}
    const duration = Number.parseFloat((data.format || {}).duration || 0)
    return {
      success: true,
      width,
      height,
      fps,
      duration,
      aspect_ratio: height > 0 ? Number((width / height).toFixed(4)) : 1.0,
    }
  } catch (error) {
    return { success: false, error: `probe_video exception: ${error.message}` }
  }
}

async function detectCrop(filePath) {
  try {
    const result = await exec('ffmpeg', [
      '-i', filePath,
      '-vf', 'cropdetect=24:16:0',
      '-vframes', '30',
      '-f', 'null', '-',
    ], 60000)
    const crops = [...String(result.stderr || '').matchAll(/crop=(\d+:\d+:\d+:\d+)/g)].map(match => match[1])
    if (!crops.length) return null
    const counts = new Map()
    for (const crop of crops) counts.set(crop, (counts.get(crop) || 0) + 1)
    let mostCommon = crops[0]
    for (const crop of crops) {
      if (counts.get(crop) > counts.get(mostCommon)) mostCommon = crop
    }
    return `crop=${mostCommon}`
  } catch (error) {
    const crops = [...String(error.stderr || '').matchAll(/crop=(\d+:\d+:\d+:\d+)/g)].map(match => match[1])
    if (!crops.length) return null
    const counts = new Map()
    for (const crop of crops) counts.set(crop, (counts.get(crop) || 0) + 1)
    let mostCommon = crops[0]
    for (const crop of crops) {
      if (counts.get(crop) > counts.get(mostCommon)) mostCommon = crop
    }
    return `crop=${mostCommon}`
  }
}

async function normalizeAspect(inputPath, outputPath, platform, probe) {
  const [tw, th] = PLATFORM_DIMS[platform] || [1080, 1920]
  const cropFilter = await detectCrop(inputPath)
  const cropPart = cropFilter ? `${cropFilter},` : ''
  const filterComplex = (
    `[0:v]${cropPart}split=2[bg_raw][fg_raw];`
    + `[bg_raw]scale=${tw}:${th}:force_original_aspect_ratio=increase,`
    + `crop=${tw}:${th},boxblur=luma_radius=40:luma_power=3[bg];`
    + `[fg_raw]scale=${tw}:${th}:force_original_aspect_ratio=increase,`
    + `crop=${tw}:${th}[fg];`
    + '[bg][fg]overlay=0:0[out]'
  )
  return runFfmpeg([
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ], 'normalize_aspect')
}

async function bypassDuplicate(inputPath, outputPath) {
  const vf = (
    'scale=iw*1.02:ih*1.02,'
    + 'crop=iw/1.02:ih/1.02,'
    + 'hue=h=2,'
    + 'eq=brightness=0.02:contrast=1.02,'
    + 'noise=alls=2:allf=t'
  )
  return runFfmpeg([
    '-i', inputPath,
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ], 'bypass_duplicate')
}

async function extractFirstFrame(videoPath, outputFramePath) {
  return runFfmpeg([
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2',
    outputFramePath,
  ], 'extract_first_frame')
}

async function burnOverlayText(inputPath, outputPath, overlays, probe) {
  const duration = Number(probe.duration || 0.0)
  let timeline

  if (typeof overlays === 'string') {
    timeline = buildOverlayTimeline([overlays], duration)
  } else {
    timeline = []
    for (const item of overlays || []) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const text = String(item.text || '').trim()
        if (!text) continue
        const start = Number(item.start || 0.0)
        const end = Number(item.end || duration || start + 1.0)
        timeline.push({ text, start, end: Math.max(start + 0.1, end) })
      } else {
        const text = String(item).trim()
        if (text) timeline.push({ text, start: 0.0, end: duration || 9999.0 })
      }
    }
    if (timeline.length && timeline.every(item => item.start === 0.0 && item.end === (duration || 9999.0))) {
      timeline = buildOverlayTimeline(timeline.map(item => item.text), duration)
    }
  }

  if (!timeline.length) return { success: false, error: 'No valid overlay text entries were provided.' }

  const fontPath = resolveDrawtextFont()
  const filterParts = []
  let currentLabel = '[0:v]'
  const lineSpacing = Math.max(12, Math.trunc((probe.height || 1920) * 0.018))
  const fontSize = Math.max(42, Math.trunc((probe.height || 1920) * 0.065))

  for (let index = 0; index < timeline.length; index += 1) {
    const overlay = timeline[index]
    const lines = wrapOverlayLines(overlay.text)
    if (!lines.length) continue
    const blockHeight = lines.length * fontSize + Math.max(0, lines.length - 1) * lineSpacing
    const baseY = `h-${blockHeight + 20}`
    const enableExpression = `between(t\\,${overlay.start.toFixed(3)}\\,${overlay.end.toFixed(3)})`

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const escaped = escapeDrawtext(lines[lineIndex])
      const nextLabel = `[v_${index}_${lineIndex}]`
      let draw = (
        `${currentLabel}drawtext=text='${escaped}':`
        + 'x=(w-text_w)/2:'
        + `y=${baseY}+${lineIndex * (fontSize + lineSpacing)}:`
        + `fontsize=${fontSize}:`
        + 'fontcolor=white:'
        + 'borderw=4:bordercolor=black@0.95:'
        + 'shadowx=3:shadowy=3:shadowcolor=black@0.95:'
        + `line_spacing=${lineSpacing}:`
        + `enable='${enableExpression}'`
      )
      if (fontPath) draw += `:fontfile='${escapeDrawtext(fontPath)}'`
      filterParts.push(`${draw}${nextLabel}`)
      currentLabel = nextLabel
    }
  }

  if (!filterParts.length) return { success: false, error: 'Overlay text produced no drawable lines.' }
  return runFfmpeg([
    '-i', inputPath,
    '-filter_complex', filterParts.join(';'),
    '-map', currentLabel,
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ], 'burn_overlay_text')
}

async function finalEncode(inputPath, outputPath) {
  return runFfmpeg([
    '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ], 'final_encode')
}

async function extractAudio(videoPath, audioPath) {
  return runFfmpeg([
    '-i', videoPath,
    '-vn',
    '-acodec', 'libmp3lame',
    audioPath,
  ], 'extract_audio')
}

async function extractWhisperAudio(videoPath, outputWavPath) {
  if (!videoPath || !fs.existsSync(videoPath) || !fs.statSync(videoPath).isFile()) {
    return { success: false, error: `Source file not found: '${videoPath}'` }
  }
  try {
    await exec('ffmpeg', [
      '-y',
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'wav',
      outputWavPath,
    ])
    if (!fs.existsSync(outputWavPath) || fs.statSync(outputWavPath).size === 0) {
      return { success: false, error: 'ffmpeg produced no output WAV (empty or missing file)' }
    }
    return { success: true }
  } catch (error) {
    if (error.killed || error.code === 'ETIMEDOUT') {
      return { success: false, error: 'ffmpeg audio extraction timed out after 300 s' }
    }
    if (error.code === 'ENOENT') return { success: false, error: 'ffmpeg not found in PATH' }
    return {
      success: false,
      error: `ffmpeg audio extraction failed (exit ${error.code}): ${String(error.stderr || '(no stderr)').slice(-2000)}`,
    }
  }
}

async function extractKeyframes(videoPath, outputDir, count = 5) {
  const probe = await probeVideo(videoPath)
  if (!probe.success) return probe
  const interval = probe.duration / (count + 1)
  const frames = []
  for (let index = 1; index <= count; index += 1) {
    const framePath = path.join(outputDir, `keyframe_${index}.jpg`)
    const result = await runFfmpeg([
      '-ss', String(Number((index * interval).toFixed(3))),
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      framePath,
    ], `extract_keyframe_${index}`)
    if (result.success) frames.push(framePath)
  }
  return { success: frames.length > 0, frames }
}

async function runRepurposeExtraction(inputPath, workDir) {
  const uid = crypto.randomUUID().slice(0, 8)
  const processingSteps = []
  const probe = await probeVideo(inputPath)
  if (!probe.success) return { success: false, error: probe.error }
  processingSteps.push('video probed')

  const audioPath = path.join(workDir, `${uid}_audio.mp3`)
  const audioResult = await extractAudio(inputPath, audioPath)
  if (!audioResult.success) return { success: false, error: `Audio extraction failed: ${audioResult.error}` }
  processingSteps.push('audio extracted')

  const framesDir = path.join(workDir, 'keyframes')
  fs.mkdirSync(framesDir, { recursive: true })
  const framesResult = await extractKeyframes(inputPath, framesDir, 5)
  if (!framesResult.success) return { success: false, error: 'Keyframe extraction failed' }
  processingSteps.push('5 keyframes captured')
  return {
    success: true,
    audio_path: audioPath,
    keyframes: framesResult.frames,
    processing_steps: processingSteps,
    duration: probe.duration,
  }
}

async function renderRepurposeDefault(inputPath, outputPath, overlayText, bgColor = '#000000') {
  const probe = await probeVideo(inputPath)
  if (!probe.success) return probe
  const [tw, th] = [1080, 1920]
  const filterComplex = (
    `[0:v]scale=${tw}:-1[scaled];`
    + `color=c=${bgColor}:s=${tw}x${th}[bg];`
    + '[bg][scaled]overlay=(W-w)/2:(H-h)/2[base]'
  )
  const fontPath = resolveDrawtextFont()
  const lines = wrapOverlayLines(overlayText)
  const fontSize = 64
  const lineSpacing = 15
  const blockHeight = lines.length * fontSize + Math.max(0, lines.length - 1) * lineSpacing
  const baseY = `h-${blockHeight + 20}`
  const drawtextFilters = lines.map((line, index) => {
    let draw = (
      `drawtext=text='${escapeDrawtext(line)}':x=(w-text_w)/2:y=${baseY}+${index * (fontSize + lineSpacing)}:`
      + `fontsize=${fontSize}:fontcolor=white:borderw=4:bordercolor=black@0.9`
    )
    if (fontPath) draw += `:fontfile='${escapeDrawtext(fontPath)}'`
    return draw
  })
  return runFfmpeg([
    '-i', inputPath,
    '-filter_complex', `${filterComplex};[base]${drawtextFilters.join(',')}[out]`,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ], 'render_repurpose_default')
}

module.exports = {
  PLATFORM_DIMS,
  escapeDrawtext,
  resolveDrawtextFont,
  wrapOverlayLines,
  buildOverlayTimeline,
  runFfmpeg,
  probeVideo,
  detectCrop,
  normalizeAspect,
  bypassDuplicate,
  extractFirstFrame,
  burnOverlayText,
  finalEncode,
  extractAudio,
  extractWhisperAudio,
  extractKeyframes,
  runRepurposeExtraction,
  renderRepurposeDefault,
}
