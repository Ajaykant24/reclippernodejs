const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

async function transcribeVideo(videoPath) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { success: false, transcript: '', error: 'Video file not found' }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'))
  const jsonFile = path.join(tmpDir, 'transcript.json')

  try {
    await new Promise((resolve, reject) => {
      execFile(
        'whisper',
        [
          videoPath,
          // tiny.en: fastest English model, low RAM — avoids OOM on small instances.
          '--model', 'tiny.en',
          '--output_format', 'json',
          '--output_dir', tmpDir,
          '--language', 'en',
          '--fp16', 'False',
        ],
        { timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(stderr || error.message))
          else resolve()
        },
      )
    })

    // Whisper names the output after the input filename
    const baseName = path.basename(videoPath, path.extname(videoPath))
    const outFile = path.join(tmpDir, `${baseName}.json`)
    const targetFile = fs.existsSync(outFile) ? outFile : jsonFile

    if (!fs.existsSync(targetFile)) {
      return { success: false, transcript: '', error: 'Whisper output not found' }
    }

    const data = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
    const transcript = (data.text || '').trim()
    const segments = (data.segments || []).map(s => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }))

    return { success: true, transcript, segments }
  } catch (error) {
    return { success: false, transcript: '', error: error.message }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

module.exports = { transcribeVideo }
