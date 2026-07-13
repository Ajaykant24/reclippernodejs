const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const cors = require('cors')
const express = require('express')

const BASE_DIR = __dirname
const STORAGE_DIR = process.env.STORAGE_DIR || BASE_DIR
const DATA_DIR = path.join(STORAGE_DIR, 'data')
const CLIPS_DIR = path.join(STORAGE_DIR, 'clips')
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(CLIPS_DIR, { recursive: true })

const jobs = {}

function readJson(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) return defaultValue
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return defaultValue
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function updateJob(jobId, patch) {
  const current = jobs[jobId] || {}
  Object.assign(current, patch)
  jobs[jobId] = current
  const persisted = readJson(JOBS_FILE, {})
  persisted[jobId] = current
  writeJson(JOBS_FILE, persisted)
}

function getCurrentUserFromToken(authorization) {
  let token = ''
  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    token = authorization.split(' ', 2)[1].trim()
  }
  return { user_id: token || 'local-user' }
}

function passwordHash(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex')
}

function sessionFor(user) {
  return {
    token: user.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name || user.email.split('@', 1)[0],
      plan: user.plan || 'Pro',
    },
  }
}

function uuidHex(length) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length)
}

function httpError(status, detail) {
  const error = new Error(detail)
  error.status = status
  error.detail = detail
  return error
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed || error.code === 'ETIMEDOUT') {
          reject(new Error('FFmpeg export timed out'))
          return
        }
        const failure = new Error(stderr || error.message)
        failure.stderr = stderr || ''
        failure.code = error.code
        reject(failure)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function withExportPreviewDefaults(body) {
  return {
    clip_id: body.clip_id,
    ratio: body.ratio ?? 'original',
    bg_type: body.bg_type ?? 'black',
    bg_custom_color: body.bg_custom_color ?? '#000000',
    blur_strength: body.blur_strength ?? 42.0,
    custom_text: body.custom_text ?? '',
    text_hidden: body.text_hidden ?? false,
    text_align: body.text_align ?? 'center',
    text_style: body.text_style ?? 'plain',
    text_color: body.text_color ?? '#ffffff',
    font_size: body.font_size ?? 20.0,
    volume: body.volume ?? 1.0,
    video_transform: body.video_transform ?? null,
    text_transform: body.text_transform ?? null,
    overlay_image: body.overlay_image ?? null,
    enable_captions: body.enable_captions ?? false,
    caption_style: body.caption_style ?? '1_word',
    caption_transform: body.caption_transform ?? null,
    caption_settings: body.caption_settings ?? null,
    // Full editor state, saved back onto the clip so reopening restores every edit.
    editor_payload: body.editor_payload ?? null,
  }
}

const app = express()

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    // Any Vercel deployment (production + preview URLs) and the production domain.
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
    /^https:\/\/([a-z0-9-]+\.)?clippar\.online$/i,
    ...String(process.env.CORS_ORIGINS || process.env.ALLOW_ORIGINS || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
  ],
  credentials: true,
}))
app.use(express.json({ limit: '50mb' }))
app.use('/clips', express.static(CLIPS_DIR))
app.use('/api/v2/repurpose', require('./repurpose_v2_router'))

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Reclipper API', version: '1.0.0' })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.post('/auth/signup', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const users = readJson(USERS_FILE, [])
  if (users.some(user => user.email === email)) {
    throw httpError(409, 'An account already exists for this email.')
  }
  const user = {
    id: `user_${uuidHex(10)}`,
    email,
    name: String(req.body.name || '').trim() || email.split('@', 1)[0],
    password_hash: passwordHash(String(req.body.password || '')),
    plan: 'Pro',
  }
  users.push(user)
  writeJson(USERS_FILE, users)
  res.json(sessionFor(user))
}))

app.post('/auth/signin', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const users = readJson(USERS_FILE, [])
  const user = users.find(candidate => (
    candidate.email === email
    && candidate.password_hash === passwordHash(String(req.body.password || ''))
  ))
  if (!user) throw httpError(401, 'Invalid email or password.')
  res.json(sessionFor(user))
}))

app.post('/auth/demo', (req, res) => {
  res.json(sessionFor({
    id: 'local-user',
    email: 'demo@reclipper.local',
    name: 'Demo Clipper',
    plan: 'Scale',
  }))
})

app.get('/projects', (req, res) => {
  const user = getCurrentUserFromToken(req.get('authorization'))
  const projects = readJson(PROJECTS_FILE, []).filter(project => (
    project.user_id == null || project.user_id === user.user_id
  ))
  res.json({ projects })
})

app.get('/projects/library', (req, res) => {
  const user = getCurrentUserFromToken(req.get('authorization'))
  const projects = readJson(PROJECTS_FILE, []).filter(project => (
    project.user_id == null || project.user_id === user.user_id
  ))
  res.json({ projects })
})

app.delete('/projects/:projectId', (req, res, next) => {
  try {
    const user = getCurrentUserFromToken(req.get('authorization'))
    const projects = readJson(PROJECTS_FILE, [])
    const kept = projects.filter(project => !(
      project.project_id === req.params.projectId
      && (project.user_id == null || project.user_id === user.user_id)
    ))
    if (kept.length === projects.length) throw httpError(404, 'Project not found')
    writeJson(PROJECTS_FILE, kept)
    res.json({ deleted: req.params.projectId })
  } catch (error) {
    next(error)
  }
})

app.post('/projects/bulk-delete', (req, res) => {
  const user = getCurrentUserFromToken(req.get('authorization'))
  const wanted = new Set(req.body.project_ids || [])
  const deleted = []
  const kept = []
  for (const project of readJson(PROJECTS_FILE, [])) {
    const canDelete = wanted.has(project.project_id) && (
      project.user_id == null || project.user_id === user.user_id
    )
    if (canDelete) deleted.push(project.project_id)
    else kept.push(project)
  }
  writeJson(PROJECTS_FILE, kept)
  res.json({ deleted })
})

app.post('/export/preview', asyncRoute(async (req, res) => {
  const payload = withExportPreviewDefaults(req.body || {})
  const projects = readJson(PROJECTS_FILE, [])
  let sourceFilename = null
  let matchedClip = null

  for (const project of projects) {
    for (const clip of project.clips || []) {
      if (clip.clip_id === payload.clip_id) {
        sourceFilename = path.basename(clip.clip_url || '')
        matchedClip = clip
        break
      }
    }
    if (sourceFilename) break
  }

  if (!sourceFilename) throw httpError(404, 'Clip not found in projects')

  // Persist the editor's full edit state onto the clip so reopening the project
  // restores every change (text, layout, colors, captions, logo, transforms).
  if (matchedClip && payload.editor_payload && typeof payload.editor_payload === 'object') {
    try {
      matchedClip.editor_payload = payload.editor_payload
      writeJson(PROJECTS_FILE, projects)
    } catch (error) {
      console.error('[export/preview] Failed to persist editor_payload (non-fatal):', error.message)
    }
  }
  const filePath = path.join(CLIPS_DIR, sourceFilename)
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw httpError(404, 'Clip file no longer on server — this happens when the server restarts without a persistent disk. Add a Render disk at /var/data and re-upload your video.')
  }

  const inputs = ['-i', filePath]
  let filterComplex = ''
  let mapLabel = '[composite]'

  if (payload.bg_type === 'blur') {
    const sigma = payload.blur_strength != null
      ? Math.max(8, Math.trunc((payload.blur_strength / 100.0) * 60.0))
      : 16
    filterComplex += (
      // Reproduce the editor preview's blur layer exactly:
      //   object-fit: cover + transform: scale(1.18)  -> cover then zoom 18% and re-crop
      //   filter: blur(...) brightness(0.84)           -> gblur + colorlevels (multiply by 0.84)
      //   overlay: rgba(8,13,20,0.22)                  -> drawbox color=0x080d14@0.22
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,`
      + `crop=1080:1920,`
      + `scale=iw*1.18:-1,`
      + `crop=1080:1920,`
      + `gblur=sigma=${sigma},`
      + `colorlevels=romax=0.84:gomax=0.84:bomax=0.84,`
      + 'drawbox=x=0:y=0:w=iw:h=ih:color=0x080d14@0.22:t=fill[bg];'
    )
  } else {
    let colorHex = '#0f1116'
    if (payload.bg_type === 'white') colorHex = '#ffffff'
    else if (payload.bg_type === 'custom') colorHex = payload.bg_custom_color || '#000000'
    filterComplex += `color=c=0x${colorHex.replace(/^#/, '')}:s=1080x1920:r=30[bg];`
  }

  const exportScale = 1920.0 / 720.0
  let fw
  let fh
  let fx
  let fy
  if (payload.video_transform) {
    fw = Math.trunc(payload.video_transform.w * exportScale)
    fh = Math.trunc(payload.video_transform.h * exportScale)
    fx = Math.trunc(payload.video_transform.x * exportScale)
    fy = Math.trunc(payload.video_transform.y * exportScale)
  } else {
    fw = 1080
    fh = 1920
    fx = 0
    fy = 0
  }
  fw -= fw % 2
  fh -= fh % 2
  fx = Math.round(fx)
  fy = Math.round(fy)

  filterComplex += `[0:v]scale=${fw}:${fh}:force_original_aspect_ratio=increase,crop=${fw}:${fh}[fg];`
  filterComplex += `[bg][fg]overlay=x=${fx}:y=${fy}:shortest=1[composite]`

  let tempPngPath = null
  if (payload.overlay_image && !payload.text_hidden) {
    try {
      const dataB64 = payload.overlay_image.includes(',')
        ? payload.overlay_image.split(',', 2)[1]
        : payload.overlay_image
      tempPngPath = path.join(CLIPS_DIR, `${uuidHex(24)}.png`)
      fs.writeFileSync(tempPngPath, Buffer.from(dataB64, 'base64'))
      inputs.push('-i', tempPngPath)
      filterComplex += ';[composite][1:v]overlay=0:0[composite_with_text]'
      mapLabel = '[composite_with_text]'
    } catch (error) {
      console.error('Failed to decode overlay_image:', error)
    }
  }

  const outFilename = `export_${payload.clip_id}_${uuidHex(6)}.mp4`
  const outPath = path.join(CLIPS_DIR, outFilename)
  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', mapLabel,
    '-map', '0:a?',
  ]

  // Only touch the audio when volume actually changes. Otherwise stream-copy it
  // (the clip's audio is already aac from creation) — skips a redundant re-encode
  // and makes most exports noticeably faster.
  const changesAudio = payload.volume != null && payload.volume !== 1.0
  if (changesAudio) {
    args.push('-filter:a', `volume=${payload.volume}`)
  }

  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22')
  if (changesAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k')
  } else {
    args.push('-c:a', 'copy')
  }
  args.push(
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outPath,
  )

  try {
    await runCommand('ffmpeg', args, 300000)
  } catch (error) {
    throw httpError(500, error.message === 'FFmpeg export timed out'
      ? error.message
      : `FFmpeg export failed: ${(error.stderr || error.message).slice(-1000)}`)
  } finally {
    if (tempPngPath && fs.existsSync(tempPngPath)) {
      try {
        fs.unlinkSync(tempPngPath)
      } catch {}
    }
  }

  if (!fs.existsSync(outPath) || !fs.statSync(outPath).isFile()) {
    throw httpError(500, 'Failed to generate export video')
  }
  res.json({ url: `/clips/${outFilename}`, filename: outFilename })
}))

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }
  res.status(error.status || 500).json({ detail: error.detail || error.message || 'Internal Server Error' })
})

if (require.main === module) {
  // On every startup, mark any jobs that were mid-pipeline as failed.
  // This handles Render restarts, OOM kills, and cold starts — so the
  // frontend never gets stuck polling a job that can't complete.
  // Wrapped in try/catch so a disk hiccup can never stop the server
  // from starting and accepting requests.
  try {
    const staleStatuses = new Set(['queued', 'probing', 'smart_cropping', 'composing_canvas', 'generating_ai', 'finalizing'])
    const persistedJobs = readJson(JOBS_FILE, {})
    let staleFound = false
    for (const [jobId, job] of Object.entries(persistedJobs)) {
      if (staleStatuses.has(job.status)) {
        persistedJobs[jobId] = { ...job, status: 'failed', error: 'Server restarted while processing. Please re-upload your video.' }
        staleFound = true
      }
    }
    if (staleFound) {
      writeJson(JOBS_FILE, persistedJobs)
      console.log('[startup] Marked stale in-progress jobs as failed')
    }
  } catch (error) {
    console.error('[startup] Stale job recovery failed (non-fatal):', error.message)
  }

  const port = Number(process.env.PORT || 8000)
  app.listen(port, '0.0.0.0', () => {
    console.log(`Reclipper API listening on port ${port}`)
  })
}

module.exports = {
  app,
  BASE_DIR,
  DATA_DIR,
  CLIPS_DIR,
  JOBS_FILE,
  PROJECTS_FILE,
  USERS_FILE,
  jobs,
  readJson,
  writeJson,
  updateJob,
  getCurrentUserFromToken,
  httpError,
  asyncRoute,
}
