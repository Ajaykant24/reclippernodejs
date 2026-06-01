const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const RATIO_DIMS = {
  '9:16': [1080, 1920],
  '2:3': [1080, 1620],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '3:4': [1080, 1440],
  '3:2': [1620, 1080],
  '4:3': [1440, 1080],
  '16:9': [1920, 1080],
  '21:9': [1920, 824],
}

function exec(command, args, timeout, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout,
      maxBuffer: 128 * 1024 * 1024,
      encoding,
    }, (error, stdout, stderr) => {
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

async function run(args, step, timeout = 600) {
  try {
    await exec('ffmpeg', ['-y', ...args], timeout * 1000)
    return { success: true }
  } catch (error) {
    if (error.killed || error.code === 'ETIMEDOUT') {
      return { success: false, error: `FFmpeg [${step}] timed out after ${timeout}s` }
    }
    if (error.code === 'ENOENT') return { success: false, error: 'ffmpeg not found in PATH' }
    const tail = String(error.stderr || '(no stderr)').slice(-3000)
    return { success: false, error: `FFmpeg [${step}] rc=${error.code}: ${tail}` }
  }
}

async function runProbe(args, timeout = 30) {
  try {
    const result = await exec('ffprobe', args, timeout * 1000)
    return { success: true, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (error.killed || error.code === 'ETIMEDOUT') {
      return { success: false, error: 'ffprobe timed out' }
    }
    if (error.code === 'ENOENT') return { success: false, error: 'ffprobe not found in PATH' }
    return { success: false, error: String(error.stderr || error.message).slice(-2000) }
  }
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

function resolveFont() {
  const windir = process.env.WINDIR || 'C:\\Windows'
  const candidates = [
    path.join(windir, 'Fonts', 'arialbd.ttf'),
    path.join(windir, 'Fonts', 'segoeuib.ttf'),
    path.join(windir, 'Fonts', 'arial.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  ]
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || ''
}

function codePointLength(text) {
  return Array.from(text).length
}

function wrapText(text, maxNonSpace = 25, maxLines = 3) {
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

function normalizeHexColor(value, fallback = '#000000') {
  const raw = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw}`
  return fallback
}

function ffmpegColor(value) {
  return normalizeHexColor(value).replace('#', '0x')
}

async function probeVideo(filePath) {
  const result = await runProbe([
    '-v', 'quiet', '-print_format', 'json',
    '-show_streams', '-show_format', filePath,
  ])
  if (!result.success) return { success: false, error: result.error }

  try {
    const data = JSON.parse(result.stdout)
    const videoStream = (data.streams || []).find(stream => stream.codec_type === 'video')
    if (!videoStream) return { success: false, error: 'No video stream found' }
    const width = Number.parseInt(videoStream.width || 0, 10)
    const height = Number.parseInt(videoStream.height || 0, 10)
    let fps = 30.0
    try {
      const [num, den] = String(videoStream.r_frame_rate || '30/1').split('/')
      fps = Number(num) / Number(den)
    } catch {}
    const duration = Number.parseFloat((data.format || {}).duration || 0)
    const aspectRatio = height > 0 ? Number((width / height).toFixed(4)) : 1.0
    return { success: true, width, height, fps, duration, aspect_ratio: aspectRatio }
  } catch (error) {
    return { success: false, error: `probe_video parse error: ${error.message}` }
  }
}

async function extractGrayFrame(inputPath, frameIndex, fps, width, height) {
  const timestamp = fps > 0 ? frameIndex / fps : 0
  try {
    const result = await exec('ffmpeg', [
      '-v', 'error',
      '-ss', String(timestamp),
      '-i', inputPath,
      '-frames:v', '1',
      '-vf', 'format=gray',
      '-f', 'rawvideo',
      'pipe:1',
    ], 60000, 'buffer')
    const expected = width * height
    if (!Buffer.isBuffer(result.stdout) || result.stdout.length < expected) return null
    return new Uint8Array(result.stdout.subarray(0, expected))
  } catch {
    return null
  }
}

function buildIntegral(binary, width, height) {
  const stride = width + 1
  const integral = new Int32Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    for (let x = 0; x < width; x += 1) {
      rowSum += binary[y * width + x]
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum
    }
  }
  return integral
}

function rectSum(integral, width, x0, y0, x1, y1) {
  const stride = width + 1
  return (
    integral[y1 * stride + x1]
    - integral[y0 * stride + x1]
    - integral[y1 * stride + x0]
    + integral[y0 * stride + x0]
  )
}

function erode5x5(binary, width, height) {
  const integral = buildIntegral(binary, width, height)
  const output = new Uint8Array(binary.length)
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      if (rectSum(integral, width, x - 2, y - 2, x + 3, y + 3) === 25) {
        output[y * width + x] = 1
      }
    }
  }
  return output
}

function dilate5x5(binary, width, height) {
  const integral = buildIntegral(binary, width, height)
  const output = new Uint8Array(binary.length)
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 2)
    const y1 = Math.min(height, y + 3)
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - 2)
      const x1 = Math.min(width, x + 3)
      if (rectSum(integral, width, x0, y0, x1, y1) > 0) output[y * width + x] = 1
    }
  }
  return output
}

function findValidBounds(binary, width, height, minArea) {
  const visited = new Uint8Array(binary.length)
  const queue = new Int32Array(binary.length)
  let bounds = null

  for (let index = 0; index < binary.length; index += 1) {
    if (!binary[index] || visited[index]) continue
    let head = 0
    let tail = 0
    let area = 0
    let xMin = width
    let yMin = height
    let xMax = 0
    let yMax = 0
    queue[tail++] = index
    visited[index] = 1

    while (head < tail) {
      const current = queue[head++]
      const x = current % width
      const y = Math.trunc(current / width)
      area += 1
      xMin = Math.min(xMin, x)
      yMin = Math.min(yMin, y)
      xMax = Math.max(xMax, x + 1)
      yMax = Math.max(yMax, y + 1)

      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
          const neighbor = ny * width + nx
          if (binary[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1
            queue[tail++] = neighbor
          }
        }
      }
    }

    if (area > minArea) {
      if (!bounds) bounds = { xMin, yMin, xMax, yMax }
      else {
        bounds.xMin = Math.min(bounds.xMin, xMin)
        bounds.yMin = Math.min(bounds.yMin, yMin)
        bounds.xMax = Math.max(bounds.xMax, xMax)
        bounds.yMax = Math.max(bounds.yMax, yMax)
      }
    }
  }

  return bounds
}

async function detectAndCrop(inputPath, outputPath, probe) {
  const fullW = probe.width || 0
  const fullH = probe.height || 0
  let cropX = 0
  let cropY = 0
  let cropW = fullW
  let cropH = fullH
  let cropped = false

  try {
    const totalFrames = Math.trunc((probe.duration || 0) * (probe.fps || 0)) || 300
    const step = Math.max(1, Math.trunc(totalFrames / 15))
    const frames = []
    for (let frameIndex = 0; frameIndex < totalFrames && frames.length < 15; frameIndex += step) {
      const frame = await extractGrayFrame(inputPath, frameIndex, probe.fps || 30, fullW, fullH)
      if (frame) frames.push(frame)
    }

    if (frames.length >= 2) {
      const maxDiff = new Uint8Array(fullW * fullH)
      for (let frameIndex = 0; frameIndex < frames.length - 1; frameIndex += 1) {
        const first = frames[frameIndex]
        const second = frames[frameIndex + 1]
        for (let index = 0; index < maxDiff.length; index += 1) {
          const diff = Math.abs(first[index] - second[index])
          if (diff > maxDiff[index]) maxDiff[index] = diff
        }
      }

      const threshold = new Uint8Array(maxDiff.length)
      for (let index = 0; index < maxDiff.length; index += 1) {
        if (maxDiff[index] > 30) threshold[index] = 1
      }
      const opened = dilate5x5(erode5x5(threshold, fullW, fullH), fullW, fullH)
      const bounds = findValidBounds(opened, fullW, fullH, fullW * fullH * 0.01)

      if (bounds) {
        let x = bounds.xMin
        let y = bounds.yMin
        let w = bounds.xMax - bounds.xMin
        let h = bounds.yMax - bounds.yMin
        const padW = Math.trunc(w * 0.03)
        const padH = Math.trunc(h * 0.03)
        w = Math.max(16, w - padW * 2)
        h = Math.max(16, h - padH * 2)
        x += padW
        y += padH
        cropX = x
        cropY = y
        cropW = w
        cropH = h
      }
    }
  } catch (error) {
    console.error('[repurpose_v2] crop detect failed:', error)
  }

  if (cropW < fullW && cropH <= fullH) {
    const toleranceW = fullW * 0.05
    const toleranceH = fullH * 0.05
    if (!(Math.abs(cropW - fullW) <= toleranceW && Math.abs(cropH - fullH) <= toleranceH)) {
      cropW -= cropW % 2
      cropH -= cropH % 2
      cropX -= cropX % 2
      cropY -= cropY % 2
      cropped = true
    }
  }

  if (cropped) {
    const result = await run([
      '-i', inputPath,
      '-vf', `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ], 'detect_and_crop')
    if (!result.success) return result
    return { success: true, cropped: true, crop_w: cropW, crop_h: cropH }
  }

  fs.copyFileSync(inputPath, outputPath)
  return { success: true, cropped: false, crop_w: fullW, crop_h: fullH }
}

async function composeCanvas(
  croppedPath,
  outputPath,
  outputRatio,
  backgroundType,
  blurOpacity,
  backgroundColor = '#000000',
) {
  const [tw, th] = RATIO_DIMS[outputRatio] || [1080, 1920]

  if (['black', 'white', 'custom'].includes(backgroundType)) {
    const color = backgroundType === 'custom'
      ? ffmpegColor(backgroundColor)
      : (backgroundType === 'black' ? 'black' : 'white')
    const filterComplex = (
      `[0:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,`
      + `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=${color}[out]`
    )
    return run([
      '-i', croppedPath,
      '-filter_complex', filterComplex,
      '-map', '[out]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ], 'compose_canvas_solid')
  }

  if (backgroundType === 'blur') {
    let bgChain = (
      `[0:v]scale=${tw}:${th}:force_original_aspect_ratio=increase,`
      + `crop=${tw}:${th},`
      + 'gblur=sigma=40'
    )
    const opacity = 1.0 - Math.max(0.0, Math.min(1.0, blurOpacity))
    if (opacity > 0.0) {
      bgChain += `,drawbox=x=0:y=0:w=iw:h=ih:color=black@${opacity.toFixed(3)}:t=fill`
    }
    bgChain += '[bg]'
    const fgChain = (
      `[0:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,`
      + `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black@0[fg]`
    )
    return run([
      '-i', croppedPath,
      '-filter_complex', `${bgChain};${fgChain};[bg][fg]overlay=(W-w)/2:(H-h)/2[out]`,
      '-map', '[out]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ], 'compose_canvas_blur')
  }

  return { success: false, error: `Unknown background_type: '${backgroundType}'` }
}

async function extractAnalysisFrame(videoPath, outputFramePath, seekSecs = 1.0) {
  const result = await run([
    '-ss', String(seekSecs),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2',
    outputFramePath,
  ], 'extract_analysis_frame')
  if (result.success && !fs.existsSync(outputFramePath)) {
    return run([
      '-i', videoPath, '-vframes', '1', '-q:v', '2', outputFramePath,
    ], 'extract_analysis_frame_fallback')
  }
  return result
}

async function renderOverlayText(canvasPath, outputPath, overlayText, canvasW, canvasH) {
  const text = String(overlayText || '').trim()
  if (!text) {
    fs.copyFileSync(canvasPath, outputPath)
    return { success: true }
  }

  const fontSize = Math.max(42, Math.min(120, Math.trunc(canvasW * 0.055)))
  const lineSpacing = Math.max(8, Math.trunc(fontSize * 0.22))
  const lines = wrapText(text)
  if (!lines.length) {
    fs.copyFileSync(canvasPath, outputPath)
    return { success: true }
  }

  const fontPath = resolveFont()
  const sideMargin = 24
  const blockHeight = lines.length * fontSize + Math.max(0, lines.length - 1) * lineSpacing
  const baseY = Math.max(sideMargin, canvasH - blockHeight - 20)
  const filterParts = []
  let current = '[0:v]'

  for (let index = 0; index < lines.length; index += 1) {
    const escaped = escapeDrawtext(lines[index])
    const lineY = baseY + index * (fontSize + lineSpacing)
    const nextLabel = `[txt${index}]`
    let draw = (
      `${current}drawtext=`
      + `text='${escaped}':`
      + 'x=(w-text_w)/2:'
      + `y=${lineY}:`
      + `fontsize=${fontSize}:`
      + 'fontcolor=white:'
      + 'borderw=4:bordercolor=black@0.95:'
      + 'shadowx=3:shadowy=3:shadowcolor=black@0.90'
    )
    if (fontPath) draw += `:fontfile='${escapeDrawtext(fontPath)}'`
    draw += nextLabel
    filterParts.push(draw)
    current = nextLabel
  }

  return run([
    '-i', canvasPath,
    '-filter_complex', filterParts.join(';'),
    '-map', current,
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ], 'render_overlay_text')
}

async function applyLogo(videoPath, logoPath, outputPath, canvasW, canvasH) {
  const logoSize = Math.trunc(canvasW * 0.10)
  const padding = Math.trunc(canvasW * 0.05)
  return run([
    '-i', videoPath,
    '-i', logoPath,
    '-filter_complex', `[1:v]scale=${logoSize}:-1[logo];[0:v][logo]overlay=W-w-${padding}:${padding}[out]`,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ], 'apply_logo')
}

module.exports = {
  RATIO_DIMS,
  escapeDrawtext,
  resolveFont,
  wrapText,
  normalizeHexColor,
  ffmpegColor,
  probeVideo,
  detectAndCrop,
  composeCanvas,
  extractAnalysisFrame,
  renderOverlayText,
  applyLogo,
}
