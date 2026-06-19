const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

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
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = [
    process.env.SF_FONT_PATH || '',
    path.join(__dirname, 'fonts', 'SFProText-Regular.ttf'),
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
  ]
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || ''
}

function codePointLength(text) {
  return Array.from(text).length
}

function wrapLines(text, maxNonSpace = 25, maxLines = 3) {
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

function run(args, step) {
  return new Promise(resolve => {
    execFile('ffmpeg', ['-y', ...args], { timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ success: true })
        return
      }
      if (error.killed || error.code === 'ETIMEDOUT') {
        resolve({ success: false, error: `FFmpeg [${step}] timed out` })
        return
      }
      if (error.code === 'ENOENT') {
        resolve({ success: false, error: 'ffmpeg not found in PATH' })
        return
      }
      resolve({ success: false, error: `FFmpeg [${step}] rc=${error.code}: ${String(stderr || '').slice(-2000)}` })
    })
  })
}

async function renderRepurposeExport(
  inputPath,
  outputPath,
  backgroundHex,
  overlayText,
  overlayYPositionNormalized,
  canvasW = 1080,
  canvasH = 1920,
) {
  const normY = Math.max(0.02, Math.min(0.98, Number(overlayYPositionNormalized)))
  let fontSize = Math.max(48, Math.trunc(canvasH * 0.055))
  const lineSpacing = Math.max(8, Math.trunc(canvasH * 0.012))
  let yPx = Math.trunc(normY * canvasH) - Math.trunc(fontSize / 2)
  yPx = Math.max(10, Math.min(canvasH - fontSize - 10, yPx))

  const bg = String(backgroundHex).replace(/^#/, '')
  let filterComplex = (
    `color=c=0x${bg}:s=${canvasW}x${canvasH}:r=30[bg];`
    + `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease,`
    + 'setsar=1[fg];'
    + '[bg][fg]overlay=(W-w)/2:(H-h)/2[base]'
  )
  let mapLabel = '[base]'

  if (overlayText && String(overlayText).trim()) {
    const fontPath = resolveFont()
    const lines = wrapLines(String(overlayText).trim())
    fontSize = Math.max(48, Math.trunc(canvasH * 0.055))
    const blockHeight = lines.length * fontSize + Math.max(0, lines.length - 1) * lineSpacing
    const baseY = Math.max(24, canvasH - blockHeight - 20)
    let current = 'base'

    for (let index = 0; index < lines.length; index += 1) {
      const escaped = escapeDrawtext(lines[index])
      const lineY = baseY + index * (fontSize + lineSpacing)
      const nextLabel = `txt${index}`
      let draw = (
        `[${current}]drawtext=`
        + `text='${escaped}':`
        + 'x=(w-text_w)/2:'
        + `y=${lineY}:`
        + `fontsize=${fontSize}:`
        + 'fontcolor=white:'
        + 'borderw=5:bordercolor=black@0.92:'
        + 'shadowx=3:shadowy=3:shadowcolor=black@0.85'
      )
      if (fontPath) draw += `:fontfile='${escapeDrawtext(fontPath)}'`
      draw += `[${nextLabel}]`
      filterComplex += `;${draw}`
      current = nextLabel
    }
    mapLabel = `[${current}]`
  }

  return run([
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', mapLabel,
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ], 'render_repurpose_export')
}

module.exports = {
  escapeDrawtext,
  resolveFont,
  wrapLines,
  renderRepurposeExport,
}
