const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const express = require('express')
const multer = require('multer')
const { analyzeForRepurpose } = require('./repurpose_ai')
const { validateRepurposeExportRequest } = require('./repurpose_models')
const { renderRepurposeExport } = require('./repurpose_render')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage() })
const JOBS = {}
const BASE_DIR = __dirname
const OUTPUT_DIR = path.join(BASE_DIR, 'repurpose_outputs')
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function uuidHex(length) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length)
}

function httpError(status, detail) {
  const error = new Error(detail)
  error.status = status
  error.detail = detail
  return error
}

function update(jobId, patch) {
  Object.assign(JOBS[jobId], patch)
}

async function runPipeline(jobId, videoPath) {
  try {
    update(jobId, { status: 'transcribing', progress: 20 })
    const { transcribeVideo } = require('./transcriber')
    const transcription = await transcribeVideo(videoPath)
    if (!transcription.success) throw new Error(`Transcription failed: ${transcription.error}`)

    const transcript = transcription.transcript
    const segments = transcription.segments
    update(jobId, { status: 'analyzing', progress: 55 })

    let duration = 0.0
    if (segments.length) {
      const end = Number(segments[segments.length - 1].end)
      duration = Number.isNaN(end) ? 0.0 : end
    }

    const ai = await analyzeForRepurpose(transcript, segments, duration)
    if (!ai.success) throw new Error('AI analysis returned failure')
    const data = ai.data
    update(jobId, {
      status: 'decision',
      progress: 100,
      transcript,
      caption: data.caption,
      overlays: data.overlays,
      viral_clips: data.viral_clips || [],
      video_path: videoPath,
    })
  } catch (error) {
    update(jobId, { status: 'failed', error: error.message })
    console.error(`[repurpose_router] pipeline error for ${jobId}:`, error)
  }
}

router.post('/upload', upload.single('video'), (req, res, next) => {
  try {
    if (!req.file) throw httpError(422, 'video is required')
    const jobId = uuidHex(10)
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `repurpose_${jobId}_`))
    const videoPath = path.join(workDir, `input_${jobId}.mp4`)
    fs.writeFileSync(videoPath, req.file.buffer)
    JOBS[jobId] = {
      job_id: jobId,
      status: 'uploaded',
      progress: 5,
      work_dir: workDir,
      video_path: videoPath,
    }
    setImmediate(() => runPipeline(jobId, videoPath))
    res.json({ job_id: jobId })
  } catch (error) {
    next(error)
  }
})

router.get('/status/:jobId', (req, res, next) => {
  try {
    const job = JOBS[req.params.jobId]
    if (!job) throw httpError(404, 'Job not found')
    res.json({
      job_id: req.params.jobId,
      status: job.status,
      progress: job.progress || 0,
      caption: job.caption,
      overlays: job.overlays,
      viral_clips: job.viral_clips,
      error: job.error,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/export', express.json(), async (req, res, next) => {
  try {
    const payload = validateRepurposeExportRequest(req.body || {})
    const job = JOBS[payload.job_id]
    if (!job) throw httpError(404, 'Job not found')
    if (job.status !== 'decision') throw httpError(400, `Job is not ready for export (status=${job.status})`)
    if (!job.video_path || !fs.existsSync(job.video_path)) throw httpError(500, 'Source video file is missing')

    const filename = `repurposed_${payload.job_id}.mp4`
    const outputPath = path.join(OUTPUT_DIR, filename)
    const result = await renderRepurposeExport(
      job.video_path,
      outputPath,
      payload.background_hex,
      payload.overlay_text,
      payload.overlay_y_position_normalized,
    )
    if (!result.success) throw httpError(500, `Rendering failed: ${result.error || 'unknown'}`)
    res.json({
      status: 'success',
      video_url: `/api/repurpose/download/${filename}`,
      caption: payload.caption || job.caption || '',
    })
  } catch (error) {
    next(error)
  }
})

router.get('/download/:filename', (req, res, next) => {
  try {
    const safe = path.basename(req.params.filename)
    const filePath = path.join(OUTPUT_DIR, safe)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw httpError(404, 'File not found')
    res.download(filePath, safe)
  } catch (error) {
    next(error)
  }
})

module.exports = router
module.exports.JOBS = JOBS
module.exports.runPipeline = runPipeline
