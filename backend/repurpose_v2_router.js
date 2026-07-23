const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const express = require('express')
const multer = require('multer')
const {
  RATIO_DIMS,
  composeCanvas,
  probeVideo,
  detectAndCrop,
  renderOverlayText,
  freshenVideo,
} = require('./repurpose_v2_pipeline')
const { runGeminiPipeline } = require('./repurpose_v2_ai')
const { generateThumbnail } = require('./video_processor')

const router = express.Router()
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${file.fieldname}${path.extname(file.originalname) || '.mp4'}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
})
const JOBS = {}

// ── PIPELINE QUEUE ──
// Each pipeline spawns several CPU/RAM-heavy ffmpeg passes. Without a cap, N clippers
// uploading at once meant N parallel pipelines thrashing the VPS — every job slowed to
// a crawl. Jobs beyond the cap stay status 'queued' and start as running slots free up.
const MAX_CONCURRENT_PIPELINES = 2
const pipelineQueue = []
let runningPipelines = 0

function enqueuePipeline(startFn) {
  pipelineQueue.push(startFn)
  drainPipelineQueue()
}

function drainPipelineQueue() {
  while (runningPipelines < MAX_CONCURRENT_PIPELINES && pipelineQueue.length) {
    const startFn = pipelineQueue.shift()
    runningPipelines++
    Promise.resolve()
      .then(startFn)
      .catch(() => {}) // per-job errors are already handled inside startFn
      .finally(() => {
        runningPipelines--
        drainPipelineQueue()
      })
  }
}

const BASE_DIR = __dirname
const STORAGE_DIR = process.env.STORAGE_DIR || BASE_DIR
const OUTPUT_DIR = path.join(STORAGE_DIR, 'repurpose_outputs')
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function uuidHex(length) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length)
}

function utcIsoWithoutMilliseconds() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function update(jobId, patch) {
  const { updateJob } = require('./main')
  if (JOBS[jobId]) Object.assign(JOBS[jobId], patch)
  updateJob(jobId, patch)
}

async function runPipeline(
  jobId,
  videoPath,
  workDir,
  backgroundType,
  blurOpacity,
  backgroundColor,
  outputRatio,
  intensity,
  logoPath,
  userId,
  overlayMode = 'generated',
  originalOverlay = '',
  textAlign = 'left',
) {
  try {
    update(jobId, { status: 'probing', progress: 5 })
    const probe = await probeVideo(videoPath)
    if (!probe.success) throw new Error(`Video probe failed: ${probe.error}`)

    const normalizedRatio = String(outputRatio || 'original').trim().toLowerCase()
    const useOriginal = ['', 'original', 'source', 'actual'].includes(normalizedRatio)

    // Kick off the AI (Whisper/Gemini) on the ORIGINAL uploaded video NOW so its
    // network latency overlaps the crop/compose/freshen encodes instead of being
    // added on top of them. It has no dependency on the encoded outputs and is
    // awaited later, right before the clip is assembled. The no-op catch prevents
    // an unhandled-rejection warning; real error handling happens at the await.
    const aiPromise = runGeminiPipeline(videoPath, intensity, normalizedRatio, 'relatable', overlayMode, originalOverlay)
    aiPromise.catch(() => {})

    update(jobId, { status: 'smart_cropping', progress: 15 })
    const smartCropPath = path.join(workDir, 'smart_crop.mp4')
    const cropResult = await detectAndCrop(videoPath, smartCropPath, probe)
    if (!cropResult.success) throw new Error(`Smart crop failed: ${cropResult.error}`)
    const sourceW = Number.parseInt(probe.width || 0, 10)
    const sourceH = Number.parseInt(probe.height || 0, 10)
    const cropW = Number.parseInt(cropResult.crop_w || sourceW, 10)
    const cropH = Number.parseInt(cropResult.crop_h || sourceH, 10)
    let canvasW = cropW
    let canvasH = cropH
    let workingVideoPath = smartCropPath

    if (!useOriginal) {
      if (!RATIO_DIMS[normalizedRatio]) throw new Error(`Unsupported output_ratio: '${outputRatio}'`)
      update(jobId, { status: 'composing_canvas', progress: 25 })
      const canvasPath = path.join(workDir, 'canvas.mp4')
      const canvasResult = await composeCanvas(
        smartCropPath,
        canvasPath,
        normalizedRatio,
        backgroundType,
        blurOpacity,
        backgroundColor,
      )
      if (!canvasResult.success) throw new Error(`Canvas render failed: ${canvasResult.error}`)
      workingVideoPath = canvasPath
      ;[canvasW, canvasH] = RATIO_DIMS[normalizedRatio]
    }

    update(jobId, { status: 'generating_ai', progress: 55 })

    const {
      CLIPS_DIR,
      PROJECTS_FILE,
      readJson,
      writeJson,
    } = require('./main')

    update(jobId, { status: 'finalizing', progress: 88 })
    // Skip freshenVideo during creation to save time—the ~1ms uniqueness delay is not worth
    // the full re-encode pass. Export/download can handle uniqueness if needed.
    const sourceForFinal = workingVideoPath

    // The AI was started at the top and ran concurrently with the encode passes;
    // collect its result now (resolves instantly if it already finished).
    const ai = await aiPromise
    const overlays = ai.overlays
    const caption = ai.caption

    update(jobId, { status: 'finalizing', progress: 93 })
    const finalFilename = `repurposed_v2_${jobId}.mp4`
    const finalPath = path.join(CLIPS_DIR, finalFilename)
    fs.copyFileSync(sourceForFinal, finalPath)

    const baseClipId = `repurposed_v2_${jobId}`
    await generateThumbnail(finalPath, baseClipId)
    const thumbFilename = `${baseClipId}_thumb.jpg`

    const clip = {
      clip_id: baseClipId,
      clip_url: `/clips/${finalFilename}`,
      thumb_url: `/clips/${thumbFilename}`,
      start_time: 0,
      end_time: Number.parseFloat(probe.duration || 0),
      background_type: backgroundType,
      background_color: backgroundColor,
      blur_opacity: blurOpacity,
      crop_ratio: useOriginal ? 'original' : normalizedRatio,
      output_ratio: useOriginal ? 'original' : normalizedRatio,
      source_w: sourceW,
      source_h: sourceH,
      crop_w: cropW,
      crop_h: cropH,
      smart_cropped: Boolean(cropResult.cropped),
      canvas_w: canvasW,
      canvas_h: canvasH,
      hook: overlays.length ? overlays[0] : 'Repurposed Clip',
      clip_caption: caption,
      overlay_texts: overlays,
      original_overlay: originalOverlay,
      text_align: textAlign,
      analysis_source: 'repurpose_v2',
    }

    const projectId = `proj_${jobId}_rep_v2`
    const projectEntry = {
      project_id: projectId,
      video_id: jobId,
      title: 'Repurposed Upload',
      platform: 'Upload',
      uploader: 'You',
      user_id: userId,
      created_at: utcIsoWithoutMilliseconds(),
      clips: [clip],
    }
    const existingProjects = readJson(PROJECTS_FILE, []).filter(project => project.project_id !== projectId)
    existingProjects.unshift(projectEntry)
    writeJson(PROJECTS_FILE, existingProjects)

    update(jobId, {
      status: 'done',
      progress: 100,
      clip,
      project_id: projectId,
      work_dir: workDir,
      canvas_path: workingVideoPath,
      background_type: backgroundType,
      background_color: backgroundColor,
      canvas_w: canvasW,
      canvas_h: canvasH,
    })
    console.log(`[repurpose_v2] Pipeline complete: job=${jobId}`)
  } catch (error) {
    update(jobId, { status: 'failed', error: error.message })
    console.error(`[repurpose_v2] Pipeline error for ${jobId}:`, error)
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }
}

router.post('/', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'logo', maxCount: 1 },
]), (req, res, next) => {
  try {
    const { getCurrentUserFromToken, updateJob, httpError } = require('./main')
    const user = getCurrentUserFromToken(req.get('authorization'))
    const jobId = uuidHex(10)
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `repurpose_v2_${jobId}_`))
    const videoPath = path.join(workDir, `input_${jobId}.mp4`)
    const video = req.files.video && req.files.video[0]
    const videoId = String(req.body.video_id || '')

    if (video) {
      fs.renameSync(video.path, videoPath)
    } else if (videoId) {
      const sourcePath = path.join(BASE_DIR, 'uploads', `${videoId}.mp4`)
      if (!fs.existsSync(sourcePath)) throw httpError(400, 'Provided video_id not found')
      fs.copyFileSync(sourcePath, videoPath)
    } else {
      throw httpError(400, 'Must provide either video or video_id')
    }

    const logo = req.files.logo && req.files.logo[0]
    let logoPath = null
    if (logo && logo.originalname) {
      const extension = path.extname(logo.originalname) || '.png'
      logoPath = path.join(workDir, `logo${extension}`)
      fs.renameSync(logo.path, logoPath)
    }

    const backgroundType = String(req.body.background_type || 'black')
    const blurOpacity = Number.parseFloat(req.body.blur_opacity ?? '0.5')
    const backgroundColor = String(req.body.background_color || '#000000')
    const outputRatio = String(req.body.output_ratio || 'original')
    const intensity = String(req.body.intensity || 'medium')
    const overlayMode = String(req.body.overlay_mode || 'generated')
    const originalOverlay = String(req.body.original_overlay || '').trim()
    const textAlignInput = String(req.body.text_align || 'left').toLowerCase()
    const textAlign = ['left', 'center', 'right'].includes(textAlignInput) ? textAlignInput : 'left'

    JOBS[jobId] = {
      job_id: jobId,
      status: 'queued',
      progress: 0,
      file_name: video ? video.originalname : `video_${jobId}`,
      created_at: utcIsoWithoutMilliseconds(),
      job_type: 'repurpose_v2',
      user_id: user.user_id,
    }
    updateJob(jobId, JOBS[jobId])

    enqueuePipeline(() =>
      runPipeline(
        jobId,
        videoPath,
        workDir,
        backgroundType,
        blurOpacity,
        backgroundColor,
        outputRatio,
        intensity,
        logoPath,
        user.user_id,
        overlayMode,
        originalOverlay,
        textAlign,
      ).catch(error => {
        update(jobId, { status: 'failed', error: error.message || 'Unexpected error' })
        console.error(`[repurpose_v2] Unhandled error for ${jobId}:`, error)
        try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
      })
    )

    res.json({ job_id: jobId })
  } catch (error) {
    next(error)
  }
})

router.get('/status/:jobId', (req, res, next) => {
  try {
    const { jobs: mainJobs, httpError } = require('./main')
    const job = JOBS[req.params.jobId] || mainJobs[req.params.jobId]
    if (!job) throw httpError(404, 'Job not found')
    res.json({
      job_id: req.params.jobId,
      status: job.status,
      progress: job.progress || 0,
      video_url: job.video_url,
      clip: job.clip,
      project_id: job.project_id,
      overlays: job.overlays,
      caption: job.caption,
      error: job.error,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/jobs', (req, res) => {
  const {
    jobs: mainJobs,
    getCurrentUserFromToken,
    readJson,
    JOBS_FILE,
  } = require('./main')
  const user = getCurrentUserFromToken(req.get('authorization'))
  const persisted = readJson(JOBS_FILE, {})
  const merged = {}

  for (const [jobId, job] of Object.entries(persisted)) {
    if (job.job_type === 'repurpose_v2' && job.user_id === user.user_id) merged[jobId] = job
  }
  for (const [jobId, job] of Object.entries(JOBS)) {
    if (job.user_id === user.user_id) merged[jobId] = job
  }
  for (const [jobId, job] of Object.entries(mainJobs)) {
    if (job.job_type === 'repurpose_v2' && job.user_id === user.user_id && !merged[jobId]) {
      merged[jobId] = job
    }
  }

  const jobs = Object.values(merged).sort((left, right) => (
    String(right.created_at || '').localeCompare(String(left.created_at || ''))
  ))
  res.json({ jobs })
})

router.post('/rerender', express.json(), async (req, res, next) => {
  try {
    const { httpError } = require('./main')
    const job = JOBS[req.body.job_id]
    if (!job) throw httpError(404, 'Job not found')
    if (job.status !== 'done') throw httpError(400, `Job not complete (status=${job.status})`)

    const canvasPath = job.canvas_path
    if (!canvasPath || !fs.existsSync(canvasPath)) {
      throw httpError(500, 'Canvas video missing — please re-upload')
    }

    const rerenderFilename = `rerender_${req.body.job_id}_${uuidHex(6)}.mp4`
    const rerenderPath = path.join(OUTPUT_DIR, rerenderFilename)
    const result = await renderOverlayText(
      canvasPath,
      rerenderPath,
      req.body.overlay_text,
      job.canvas_w || 1080,
      job.canvas_h || 1920,
      job.background_type || 'black',
      job.background_color || '#000000',
    )
    if (!result.success) throw httpError(500, `Re-render failed: ${result.error || 'unknown'}`)
    res.json({ video_url: `/api/v2/repurpose/download/${rerenderFilename}` })
  } catch (error) {
    next(error)
  }
})

router.get('/download/:filename', (req, res, next) => {
  try {
    const { httpError } = require('./main')
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
