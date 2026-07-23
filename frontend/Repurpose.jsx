// ── VIDEO REPURPOSING DASHBOARD: Repurpose.jsx ──
// - Purpose: This page allows users to upload widescreen videos and configure layouts for mobile publishing.
// - Features: 
//   1. Drag-and-drop file upload area.
//   2. Background formatting selectors (solid colors, custom colors, blurred borders).
//   3. Responsive crop presets (9:16 vertical, 1:1 square, etc.).
//   4. Asynchronous FormData queries uploading raw video streams to Python.
// - Editing Tip: To change form labels or instructions, edit the text inside the `<h1>`, `<p>`, and section label fields below.

import { useState, useRef, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api/client'

// ── CANVAS BACKGROUND OPTIONS PRESETS ──
const BG_OPTS = [
  { id: 'black',  label: 'Black',  preview: '#0a0a0f' },
  { id: 'white',  label: 'White',  preview: '#ffffff' },
  { id: 'blur',   label: 'Blur',   preview: 'linear-gradient(135deg,#0a0a0f,#ff4d2e)' }, // Blur uses a gradient representation in settings page
  { id: 'custom', label: 'Custom', preview: null }, // Displays active color picker Hex on select
]

// ── CURATED BACKGROUND COLOR SWATCHES ──
// Matches editor.jsx BACKGROUND_COLORS so the Create page and editor offer the same
// tasteful palette. Shown as tappable circles instead of the phone's native color dialog.
const BACKGROUND_SWATCHES = [
  { label: 'Black',    value: '#0f1116' },
  { label: 'White',    value: '#ffffff' },
  { label: 'Midnight', value: '#111827' },
  { label: 'Charcoal', value: '#22252c' },
  { label: 'Graphite', value: '#3b3f46' },
  { label: 'Lime',     value: '#a0d83e' },
  { label: 'Aqua',     value: '#5ce1e6' },
  { label: 'Orange',   value: '#ff9700' },
  { label: 'Red',      value: '#ff3b30' },
  { label: 'Blue',     value: '#2f80ed' },
]

// ── ASPECT CROP PRESETS ──
// Always 'original' so smart crop's output is used as-is (never letterboxed onto
// a canvas). Ratio can still be changed inside the editor if a user wants.
const DEFAULT_RATIO = 'original'

// ── SAVED DEFAULT BACKGROUND ──
// Long-pressing a background option saves it as this device's default, applied
// automatically on every new clip. No saved default = Black (the original behavior).
const DEFAULT_BG_KEY = 'rc_default_bg'

function loadDefaultBg() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEFAULT_BG_KEY) || 'null')
    return saved && ['black', 'white', 'blur', 'custom'].includes(saved.type) ? saved : null
  } catch {
    return null
  }
}

// HELPER: is a hex color light enough that overlay text should be black on it?
function isLightColor(hex) {
  const h = String(hex || '').replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
}

// ── INTENSITY MODIFIERS ──
// - Determines how copyright-safe / heavily formatted the smart crop is.
const DEFAULT_INTENSITY = 'medium'

// ── DESIGN SYSTEM THEME TOKENS ──
// Palette aliases → the app-wide design tokens in index.css. Keeping the D.*
// shape lets every inline style below stay unchanged while the actual colors
// come from ONE source of truth shared with every other page.
const D = {
  card:       'var(--bg-card)',
  cardBorder: 'var(--border)',
  cardHover:  'var(--bg-hover)',
  text:       'var(--text-primary)',
  textSoft:   'var(--text-secondary)',
  textMuted:  'var(--text-muted)',
  accent:     'var(--accent)',
  accentGlow: 'var(--accent-glow)',
  accentBorder:'var(--accent-border)',
  success:    'var(--teal)',
  radius:     'var(--radius-btn)',
}

// ── AUTO OVERLAY DETECTION (OCR) ──
// - Purpose: when a clip is selected, read the big on-screen overlay text straight from the
//   video frames (in the browser, via tesseract.js) so clippers don't have to retype it.
// - Best-effort: any failure just leaves the input empty and the clipper types as before.

// Draws the video frame at `time` (seconds) onto a canvas sized for OCR speed.
function grabVideoFrame(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      try {
        const scale = Math.min(1, 960 / (video.videoWidth || 960))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        resolve(canvas)
      } catch (err) { reject(err) }
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', () => reject(new Error('seek failed')), { once: true })
    video.currentTime = time
  })
}

// Keeps only OCR lines that look like real words (drops noise like stray symbols).
function cleanOcrText(raw) {
  const lines = String(raw || '').split('\n').map(l => l.trim()).filter(Boolean)
  const good = lines.filter(line => {
    const letters = (line.match(/[a-z0-9]/gi) || []).length
    return line.length >= 3 && letters / line.length >= 0.5
  })
  return good.join(' ').replace(/\s+/g, ' ').trim()
}

// Reads the on-screen text from a selected video file. Checks an early frame first
// (overlays usually show from the very start) and falls back to a later one.
async function detectOverlayTextFromVideo(file) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    video.src = url
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
      video.addEventListener('error', () => reject(new Error('could not load video')), { once: true })
    })
    const duration = Number.isFinite(video.duration) ? video.duration : 1
    const times = [Math.min(0.6, duration / 2), Math.min(2.5, Math.max(0.1, duration - 0.2))]
    const { default: Tesseract } = await import('tesseract.js')
    let best = ''
    for (const t of times) {
      const frame = await grabVideoFrame(video, t)
      const { data } = await Tesseract.recognize(frame, 'eng')
      const text = cleanOcrText(data && data.text)
      if (text.length > best.length) best = text
      if (best.length >= 8) break // early frame already gave a solid read
    }
    return best
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function RepurposePage() {
  const nav = useNavigate()
  const fileRef = useRef(null) // Pointer to trigger click actions on hidden HTML input element

  // ── STATE VARIABLES ──
  // - phase: Controls the wizard layout view ('input' upload screen -> 'settings' customizer -> 'queued' success banner)
  const [phase, setPhase] = useState('input')   
  const [file, setFile] = useState(null)          // Stores the raw uploaded video object
  const [dragOver, setDragOver] = useState(false) // Tracks if user is holding a drag-file over upload zone
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false) // Blocks clicks during pending uploads
  const [uploadPct, setUploadPct] = useState(0)       // Real upload progress (0-100)
  const [uploadNote, setUploadNote] = useState('')    // Retry/status note under the progress bar

  // Object URL for the uploaded file, so the settings screen can show the actual
  // video in a playable box (not just its name). Revoked when the file changes/unmounts.
  const [fileUrl, setFileUrl] = useState('')
  useEffect(() => {
    if (!file) { setFileUrl(''); return }
    const url = URL.createObjectURL(file)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Settings customizer states — seeded from the saved default background (if any),
  // so every new clip starts with the clipper's own preferred canvas.
  const [bgType, setBgType] = useState(() => loadDefaultBg()?.type || 'black')
  const [bgCustomColor, setBgCustomColor] = useState(() => loadDefaultBg()?.color || '#111827')
  const [blurOpacity, setBlurOpacity] = useState(() => loadDefaultBg()?.blurOpacity ?? 0.5)
  // Which option is marked as default (shows the ★ badge); long-press to change.
  const [defaultBgType, setDefaultBgType] = useState(() => loadDefaultBg()?.type || 'black')
  const [defaultSavedMsg, setDefaultSavedMsg] = useState('')
  const longPressRef = useRef({ timer: null, fired: false })

  // Long-press handling on background options: hold ~½ second to save as default.
  const startBgLongPress = opt => {
    longPressRef.current.fired = false
    clearTimeout(longPressRef.current.timer)
    longPressRef.current.timer = setTimeout(() => {
      longPressRef.current.fired = true
      const payload = { type: opt.id }
      if (opt.id === 'custom') payload.color = bgCustomColor
      if (opt.id === 'blur') payload.blurOpacity = blurOpacity
      try { localStorage.setItem(DEFAULT_BG_KEY, JSON.stringify(payload)) } catch { /* storage full/blocked */ }
      setDefaultBgType(opt.id)
      setBgType(opt.id)
      setDefaultSavedMsg(`${opt.label} saved as your default background`)
      setTimeout(() => setDefaultSavedMsg(''), 2400)
      if (navigator.vibrate) navigator.vibrate(30) // small haptic tick on phones
    }, 550)
  }
  const cancelBgLongPress = () => clearTimeout(longPressRef.current.timer)
  const [overlayMode, setOverlayMode] = useState('generated')
  const [originalOverlay, setOriginalOverlay] = useState('')
  const [textAlign, setTextAlign] = useState('left')

  // Auto overlay detection (OCR) state. ocrJobRef versions each detection run so a
  // stale result (from a replaced/removed file) can never fill the input late.
  const [ocrStatus, setOcrStatus] = useState('')
  const ocrJobRef = useRef(0)
  const overlayValRef = useRef('')
  overlayValRef.current = originalOverlay
  const ratio = DEFAULT_RATIO
  const intensity = DEFAULT_INTENSITY

  // Color picker state
  const colorInputRef = useRef(null)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [pickerHue, setPickerHue] = useState(0)
  const colorPickerRef = useRef(null)

  // Preset color management
  const [savedPresets, setSavedPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('bgColorPresets') || '[]')
    } catch {
      return []
    }
  })
  const [presetName, setPresetName] = useState('')

  const savePreset = () => {
    if (!presetName.trim() || !bgCustomColor) return
    const newPreset = { name: presetName.trim(), color: bgCustomColor, id: Date.now() }
    const updated = [...savedPresets, newPreset]
    setSavedPresets(updated)
    localStorage.setItem('bgColorPresets', JSON.stringify(updated))
    setPresetName('')
  }

  const deletePreset = (id) => {
    const updated = savedPresets.filter(p => p.id !== id)
    setSavedPresets(updated)
    localStorage.setItem('bgColorPresets', JSON.stringify(updated))
  }

  // Color picker helpers
  const hexToHsv = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const v = max
    const s = max === 0 ? 0 : (max - min) / max
    let h = 0
    if (max !== min) {
      const d = max - min
      h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6
    }
    return { h: h * 360, s, v }
  }

  const hsvToHex = (h, s, v) => {
    h = h / 360
    const i = Math.floor(h * 6)
    const f = h * 6 - i
    const p = v * (1 - s)
    const q = v * (1 - f * s)
    const t = v * (1 - (1 - f) * s)
    let r, g, b
    switch (i % 6) {
      case 0: [r, g, b] = [v, t, p]; break
      case 1: [r, g, b] = [q, v, p]; break
      case 2: [r, g, b] = [p, v, t]; break
      case 3: [r, g, b] = [p, q, v]; break
      case 4: [r, g, b] = [t, p, v]; break
      default: [r, g, b] = [v, p, q]
    }
    const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }

  const handleColorSquareClick = (e) => {
    if (!colorPickerRef.current) return
    const rect = colorPickerRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const s = Math.max(0, Math.min(1, x))
    const v = Math.max(0, Math.min(1, 1 - y))
    setBgCustomColor(hsvToHex(pickerHue, s, v))
  }

  // ── WORKFLOW LOGIC ──

  const handleFileSelect = f => {
    // Purpose: Invoked when a file is checked or dropped. Caches file and opens settings page.
    if (!f) return
    // Reject over-limit files up front (the server caps uploads at 500MB) instead of
    // letting a phone upload for an hour and then fail.
    if (f.size > 500 * 1024 * 1024) {
      setError('This video is over 500MB. Trim or compress it first, then upload again.')
      return
    }
    setError('')
    setFile(f)
    setPhase('settings')
    autoDetectOverlay(f) // best-effort: pre-fills the overlay input from the video itself
  }

  // Low-end phones (≤4 cores / ≤4GB RAM) can freeze running wasm OCR on top of video
  // decode — and the multi-MB OCR download competes with the upcoming upload for
  // bandwidth. On weak devices or huge files, skip auto-OCR; typing still works.
  const shouldSkipAutoOcr = f => {
    const cores = Number(navigator.hardwareConcurrency || 0)
    const memGb = Number(navigator.deviceMemory || 0)
    if (cores > 0 && cores <= 4) return true
    if (memGb > 0 && memGb <= 4) return true
    if (f.size > 200 * 1024 * 1024) return true
    return false
  }

  const autoDetectOverlay = async f => {
    // Purpose: OCR the selected video in the browser and pre-fill "Custom Overlay Text"
    // so clippers don't have to retype the original video's on-screen hook.
    if (shouldSkipAutoOcr(f)) return
    const jobId = ++ocrJobRef.current
    setOcrStatus('reading')
    try {
      // Hard 20s ceiling — OCR must never hang the create flow on a slow device.
      const text = await Promise.race([
        detectOverlayTextFromVideo(f),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ocr timeout')), 20000)),
      ])
      if (ocrJobRef.current !== jobId) return // a newer file was picked — drop this result
      if (text && !overlayValRef.current.trim()) { // never overwrite what the clipper typed
        setOriginalOverlay(text)
        setOverlayMode('original')
      }
    } catch { /* OCR is best-effort — the clipper can still type the text manually */ }
    if (ocrJobRef.current === jobId) setOcrStatus('')
  }

  const startProcessing = async () => {
    // Purpose: packages layout selections into a Multipart Form request and posts to the backend.
    // The job only exists on the server AFTER the whole video finishes uploading, so the UI
    // must keep the user on the page (with real progress) until the request returns.
    setError('')
    setSubmitting(true)
    setUploadPct(0)
    setUploadNote('')

    // Builds raw form parameters
    const fd = new FormData()
    fd.append('video', file)
    fd.append('background_type', bgType)
    fd.append('background_color', bgCustomColor)
    fd.append('blur_opacity', String(blurOpacity))
    fd.append('output_ratio', ratio)
    fd.append('intensity', intensity)
    fd.append('overlay_mode', overlayMode)
    fd.append('original_overlay', originalOverlay.trim())
    fd.append('text_align', textAlign)

    // Slow networks drop connections mid-upload; a failed upload never created a job,
    // so retrying is always safe. Two retries with short backoff cover most blips.
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let progressed = false
      try {
        await api.post('/api/v2/repurpose', fd, {
          onUploadProgress: evt => {
            if (evt.total) {
              progressed = true
              setUploadPct(Math.min(99, Math.round((evt.loaded / evt.total) * 100)))
            }
          },
        })
        setUploadPct(100)
        setPhase('queued') // Show success checkmarks — NOW it's safe to leave
        setTimeout(() => nav('/projects'), 2800)
        return
      } catch (e) {
        const serverDetail = e?.response?.data?.detail || e?.response?.data?.error
        const isNetworkFailure = !e?.response // no HTTP response = connection-level problem
        if (isNetworkFailure && attempt < MAX_ATTEMPTS) {
          setUploadNote(`Connection dropped — retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})…`)
          await new Promise(r => setTimeout(r, attempt * 2000))
          continue
        }
        // Honest error messages: a mid-upload drop is the user's network, not a dead backend.
        if (isNetworkFailure && progressed) {
          setError('Upload interrupted — your internet connection dropped. No clips were created. Check your connection and hit Generate again.')
        } else if (isNetworkFailure) {
          setError(e.message) // never connected at all — keep the "cannot reach backend" hint
        } else {
          setError(serverDetail || e.message)
        }
        setSubmitting(false)
        setUploadPct(0)
        setUploadNote('')
        return
      }
    }
  }

  const reset = () => {
    // Restores original blank upload form state
    setPhase('input')
    setFile(null)
    setError('')
    setSubmitting(false)
    ocrJobRef.current++ // invalidate any in-flight overlay detection
    setOcrStatus('')
  }

  // ── INLINE ACCENT STYLINGS GENERATORS ──

  const darkCard = (extra = {}) => ({
    background: D.card,
    border: `1px solid ${D.cardBorder}`,
    borderRadius: D.radius,
    ...extra,
  })

  const sectionLabel = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
    textTransform: 'uppercase', color: D.textMuted, marginBottom: 12,
  }

  const optBtn = (active, extra = {}) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', borderRadius: 9, cursor: 'pointer',
    fontWeight: 600, fontSize: 13, transition: 'all 0.18s',
    border: active ? `1.5px solid ${D.accentBorder}` : `1px solid ${D.cardBorder}`,
    background: active ? D.accentGlow : D.card,
    color: active ? D.accent : D.textSoft,
    outline: 'none',
    ...extra,
  })

  const iconBtn = (active) => ({
    padding: 14, borderRadius: 8, cursor: 'pointer',
    textAlign: 'center', transition: 'all 0.18s',
    border: active ? `1.5px solid ${D.accentBorder}` : `1px solid ${D.cardBorder}`,
    background: active ? D.accentGlow : D.card,
    outline: 'none',
    minWidth: 0,
  })


  // ── VIEW A: QUEUED SUCCESS REDIRECT STATE (phase === 'queued') ──
  // - Purpose: Shows dynamic success checkmarks, instructions, and pulsing meters when upload successfully completes.

  if (phase === 'queued') return (
    <div className="dk-content anim-fade-up mobile-page mobile-tool-page mobile-queued-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div style={{ ...darkCard({ padding: 52, textAlign: 'center', maxWidth: 520, width: '100%' }) }}>

        {/* Pulsing circular checkmark banner */}
        <div style={{
          width: 84, height: 84, borderRadius: '50%', margin: '0 auto 28px',
          background: 'rgba(45,212,191,0.12)', border: '1.5px solid rgba(45,212,191,0.32)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'rp-pulse 2s ease-in-out infinite',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 42, color: D.success, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>

        <h2 style={{ margin: '0 0 10px', fontSize: 24, fontWeight: 800, color: D.text, letterSpacing: 0 }}>
          Clips are being generated
        </h2>
        <p style={{ margin: '0 0 8px', fontSize: 15, color: D.textSoft, lineHeight: 1.75 }}>
          Your video is processing in the background.<br />
          <strong style={{ color: D.text }}>You can safely leave — no need to wait!</strong>
        </p>
        <p style={{ margin: '0 0 28px', fontSize: 13, color: D.textMuted }}>
          Head to <strong style={{ color: D.textSoft }}>Projects</strong> — clips appear there when ready.
        </p>

        {/* Sliding rainbow progress loader bar */}
        <div style={{ height: 4, background: 'rgba(32,26,20,0.08)', borderRadius: 99, overflow: 'hidden', marginBottom: 28 }}>
          <div style={{
            height: '100%', width: '42%', borderRadius: 99,
            background: `linear-gradient(90deg, ${D.accent}, ${D.success})`,
            animation: 'rp-slide 1.8s ease-in-out infinite',
          }} />
        </div>

        <p style={{ margin: '0 0 24px', fontSize: 12, color: D.textMuted }}>Redirecting you to Projects…</p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="dk-action-btn" onClick={() => nav('/projects')}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>folder_open</span>
            Go to Projects Now
          </button>
          <button onClick={reset} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            border: `1px solid ${D.cardBorder}`, background: D.card, color: D.textSoft,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
            Upload Another
          </button>
        </div>
      </div>

      {/* inductions animation keyframes */}
      <style>{`
        @keyframes rp-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(45,212,191,.2); }
          50%      { box-shadow: 0 0 0 16px rgba(45,212,191,0); }
        }
        @keyframes rp-slide {
          0%   { transform: translateX(-130%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </div>
  )


  // ── VIEW B: INITIAL UPLOAD / DRAG ZONE STATE (phase === 'input') ──
  // - Purpose: Shows files upload zone boxes, drag indicators, file format labels, and benefit highlight grids.

  if (phase === 'input') return (
    <div className="dk-content anim-fade-up mobile-page mobile-tool-page">
      <div className="proj-page mobile-tool-inner">

        {/* Section title */}
        <div className="proj-header mobile-page-hero">
          <div>
            <h1 className="proj-heading">Long to Short</h1>
            <p className="proj-subheading">Turn any video into viral short-form clips. Once the upload finishes, everything renders in the background.</p>
          </div>
        </div>

        {/* Error Alert Box */}
        {error && (
          <div style={{ padding: '11px 16px', borderRadius: 8, background: 'rgba(255,90,61,0.1)', border: '1px solid rgba(255,90,61,0.32)', color: D.accent, fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* Hidden input element (Accepts MP4, MOV, WEBM) */}
        <input
          ref={fileRef} type="file"
          accept="video/mp4,video/mov,video/webm,.mp4,.mov,.webm"
          style={{ display: 'none' }}
          onChange={e => handleFileSelect(e.target.files?.[0])}
        />

        {/* 
          DRAG-AND-DROP UPLOAD ZONE PANEL:
          - Trigger: Clicks open system file checkers.
          - Drag events: dragOver expands size, glows the border color (.accentBorder in index.css), and changes background to red glow.
          - Drop event: Reads the raw video stream file on drop and triggers layout phase.
        */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files?.[0]) }}
          style={{
            width: '100%', minHeight: 260,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18,
            cursor: 'pointer', outline: 'none', border: 'none', borderRadius: 8,
            background: dragOver ? D.accentGlow : D.card,
            border: `2px dashed ${dragOver ? D.accentBorder : D.cardBorder}`,
            transition: 'all 0.22s',
            marginBottom: 20
          }}
        >
          {/* Cloud upload central circle icon */}
          <div style={{
            width: 70, height: 70, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: dragOver ? D.accentGlow : 'rgba(32,26,20,0.04)',
            border: `1px solid ${dragOver ? D.accentBorder : D.cardBorder}`,
            transition: 'all 0.22s',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 34, color: dragOver ? D.accent : D.textSoft, fontVariationSettings: "'FILL' 1" }}>cloud_upload</span>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: D.text, marginBottom: 6 }}>
              {dragOver ? 'Drop to upload' : 'Click or drag your video here'}
            </div>
            <div style={{ fontSize: 13, color: D.textMuted }}>MP4 · MOV · WEBM — Any file size</div>
          </div>

          {/* Glowing CTA Selection Button */}
          <span className="dk-action-btn" style={{ pointerEvents: 'none' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>upload_file</span>
            Select Video
          </span>
        </button>

        {/* Feature benefits list cards — 2 columns on desktop, stacked on phones
            (side-by-side at 390px squeezed text to 1-2 words per line) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {/* Item 1: Background rendering description */}
          <div style={{ ...darkCard({ padding: '14px 18px' }), display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              background: 'rgba(45,212,191,0.12)', border: '1px solid rgba(45,212,191,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: D.success, fontVariationSettings: "'FILL' 1" }}>cloud_done</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: D.text, marginBottom: 3 }}>Background Processing</div>
              <div style={{ fontSize: 12, color: D.textSoft, lineHeight: 1.55 }}>Upload &amp; leave. Clips are generated while you do other things.</div>
            </div>
          </div>
          
          {/* Item 2: AI Hooks description */}
          <div style={{ ...darkCard({ padding: '14px 18px' }), display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              background: 'rgba(255,90,61,0.11)', border: '1px solid rgba(255,90,61,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: D.accent, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: D.text, marginBottom: 3 }}>AI-Powered Clips</div>
              <div style={{ fontSize: 12, color: D.textSoft, lineHeight: 1.55 }}>Gemini analyzes your video and generates 20 unique overlay hooks.</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )


  // ── VIEW C: SETTINGS CONFIGURATION CUSTOMIZER (phase === 'settings') ──
  // - Purpose: Customize layout and render variables. Shows file details, background builders, aspect toggles, intensity sliders.

  if (phase === 'settings') return (
    <div className="dk-content anim-fade-up mobile-page mobile-tool-page">
      <div className="proj-page mobile-tool-inner">

        {/* Settings header titles */}
        <div className="proj-header mobile-page-hero">
          <div>
            <h1 className="proj-heading">Configure Output</h1>
            <p className="proj-subheading">Choose your format, then hit Generate. Keep the app open while it uploads — after that, you can leave.</p>
          </div>
          {/* Change video back-button */}
          <button onClick={reset} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            border: `1px solid ${D.cardBorder}`, background: D.card, color: D.textSoft, outline: 'none',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
            Change Video
          </button>
        </div>

        {/* Uploaded video preview: the actual clip you selected, in a playable box —
            so you can confirm it's the right video (not just read a file name). */}
        <div style={{ ...darkCard({ padding: 0 }), overflow: 'hidden', marginBottom: 10 }}>
          {fileUrl ? (
            <video
              src={fileUrl}
              controls
              playsInline
              preload="metadata"
              style={{ width: '100%', maxHeight: 320, display: 'block', background: '#000', objectFit: 'contain' }}
            />
          ) : null}
          {/* File name + size caption under the player */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: `1px solid ${D.cardBorder}` }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: D.success, fontVariationSettings: "'FILL' 1", flexShrink: 0 }}>check_circle</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: D.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file?.name}</span>
            <span style={{ fontSize: 12, color: D.textMuted, flexShrink: 0 }}>
              {file?.size ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ''}
            </span>
          </div>
        </div>

        {/* Fire & forget safety alert box */}
        <div style={{
          ...darkCard({ padding: '10px 18px', borderColor: 'rgba(255,90,61,0.28)', background: 'rgba(255,90,61,0.08)' }),
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 20
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 17, color: D.accent, fontVariationSettings: "'FILL' 1", flexShrink: 0 }}>rocket_launch</span>
          <span style={{ fontSize: 13, color: D.textSoft }}>
            <strong style={{ color: D.text }}>Heads up:</strong> stay on this page until the upload finishes — then you can close the app. Clips appear in Projects when ready.
          </span>
        </div>

        {/* Error box */}
        {error && (
          <div style={{ padding: '11px 16px', borderRadius: 8, background: 'rgba(255,90,61,0.1)', border: '1px solid rgba(255,90,61,0.32)', color: D.accent, fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
            {error}
          </div>
        )}

        {/* Main configuration panels block */}
        <div style={darkCard({ padding: 28 })}>

          {/* 1. BACKGROUND SELECT BLOCK */}
          <div style={{ marginBottom: 28 }}>
            <div style={sectionLabel}>Canvas &amp; Background</div>
            
            {/* Background Style options loops */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8 }}>
              {BG_OPTS.map(o => {
                const preview = o.id === 'custom' ? bgCustomColor : o.preview
                const isDefault = defaultBgType === o.id
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      // A completed long-press must not ALSO fire the tap action.
                      if (longPressRef.current.fired) { longPressRef.current.fired = false; return }
                      setBgType(o.id)
                    }}
                    onMouseDown={() => startBgLongPress(o)}
                    onMouseUp={cancelBgLongPress}
                    onMouseLeave={cancelBgLongPress}
                    onTouchStart={() => startBgLongPress(o)}
                    onTouchEnd={cancelBgLongPress}
                    onTouchMove={cancelBgLongPress}
                    onContextMenu={e => e.preventDefault()}
                    style={{ ...optBtn(bgType === o.id), position: 'relative' }}
                  >
                    {/* Small rounded preview box colored dynamically */}
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      background: preview, border: `1px solid ${D.cardBorder}`, display: 'inline-block',
                    }} />
                    {o.label}
                    {/* ★ marks the saved default background */}
                    {isDefault ? (
                      <span style={{
                        position: 'absolute', top: -7, right: -7,
                        width: 18, height: 18, borderRadius: '50%',
                        background: D.accent, color: '#fff',
                        fontSize: 11, lineHeight: '18px', textAlign: 'center',
                        boxShadow: '0 1px 4px rgba(60,45,30,0.3)',
                      }}>★</span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            {/* Long-press hint + save confirmation */}
            <div style={{ fontSize: 12, color: defaultSavedMsg ? D.success : D.textMuted, paddingTop: 8 }}>
              {defaultSavedMsg || 'Hold any option for a second to make it your default for every new clip.'}
            </div>

            {/* Custom color panel (Only visible when Custom background is checked).
                Tasteful in-app swatch circles + hex input — no native OS color dialog. */}
            {bgType === 'custom' && (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 8, background: 'rgba(32,26,20,0.03)', border: `1px solid ${D.cardBorder}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: D.text, marginBottom: 10 }}>Canvas color</div>

                {/* Curated background-color circles */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                  {BACKGROUND_SWATCHES.map(sw => {
                    const active = bgCustomColor.toLowerCase() === sw.value.toLowerCase()
                    return (
                      <button
                        key={sw.value}
                        type="button"
                        title={sw.label}
                        aria-label={sw.label}
                        onClick={() => setBgCustomColor(sw.value)}
                        style={{
                          width: 34, height: 34, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                          background: sw.value,
                          border: active ? `2px solid ${D.accent}` : `1px solid ${D.cardBorder}`,
                          boxShadow: active ? `0 0 0 3px ${D.accentGlow}` : 'none',
                          padding: 0,
                        }}
                      />
                    )
                  })}
                </div>

                {/* Color picker toggle button */}
                <button
                  type="button"
                  onClick={() => { setShowColorPicker(!showColorPicker); setPickerHue(hexToHsv(bgCustomColor).h) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',
                    marginBottom: 14, borderRadius: 8, background: 'rgba(32,26,20,0.03)', border: `1px solid ${D.cardBorder}`,
                    cursor: 'pointer', color: D.text, fontSize: 12, fontWeight: 600,
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: bgCustomColor, border: `1px solid ${D.cardBorder}` }} />
                  <span style={{ flex: 1, textAlign: 'left' }}>Click to pick color</span>
                  <span style={{ fontSize: 14 }}>{showColorPicker ? '▼' : '▶'}</span>
                </button>

                {/* Custom color picker */}
                {showColorPicker && (
                  <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'rgba(32,26,20,0.02)', border: `1px solid ${D.cardBorder}` }}>
                    {/* Color square */}
                    <div
                      ref={colorPickerRef}
                      onClick={handleColorSquareClick}
                      style={{
                        width: '100%', height: 200, marginBottom: 12, borderRadius: 6, cursor: 'crosshair',
                        // Layer order matters: the black fade must be the FIRST layer (painted on
                        // top) or the opaque white→hue layer hides it and the bottom looks white.
                        background: `linear-gradient(to top, black, transparent),
                                    linear-gradient(to right, white, hsl(${pickerHue}, 100%, 50%))`,
                        border: `1px solid ${D.cardBorder}`, position: 'relative',
                      }}
                    />

                    {/* Hue slider */}
                    <div style={{ marginBottom: 12 }}>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        value={pickerHue}
                        onChange={e => setPickerHue(Number(e.target.value))}
                        style={{
                          width: '100%', height: 20, borderRadius: 10, cursor: 'pointer', padding: 0, margin: 0,
                          appearance: 'none', background: `linear-gradient(to right,
                            red, yellow, lime, cyan, blue, magenta, red)`,
                          WebkitAppearance: 'none',
                        }}
                      />
                      <style>{`
                        input[type=range]::-webkit-slider-thumb {
                          -webkit-appearance: none; appearance: none;
                          width: 18px; height: 18px; border-radius: 50%;
                          background: #fff; border: 3px solid var(--accent); cursor: pointer;
                          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
                        }
                        input[type=range]::-moz-range-thumb {
                          width: 18px; height: 18px; border-radius: 50%;
                          background: #fff; border: 3px solid var(--accent); cursor: pointer;
                          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
                        }
                      `}</style>
                    </div>

                    {/* Hex input */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="text"
                        value={bgCustomColor}
                        onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setBgCustomColor(e.target.value) }}
                        maxLength={7}
                        placeholder="#111827"
                        style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', color: D.text, background: 'transparent', border: `1px solid ${D.cardBorder}`, borderRadius: 6, padding: '6px 8px', outline: 'none' }}
                      />
                      <span style={{ fontSize: 12, color: D.textMuted }}>Hex</span>
                    </div>
                  </div>
                )}

                {/* Save current color as preset */}
                <div style={{ display: 'flex', gap: 8, marginBottom: savedPresets.length > 0 ? 14 : 0 }}>
                  <input
                    type="text"
                    value={presetName}
                    onChange={e => setPresetName(e.target.value)}
                    onKeyPress={e => e.key === 'Enter' && savePreset()}
                    placeholder="Preset name..."
                    style={{ flex: 1, fontSize: 12, color: D.text, background: 'transparent', border: `1px solid ${D.cardBorder}`, borderRadius: 6, padding: '6px 8px', outline: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={savePreset}
                    disabled={!presetName.trim()}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
                      background: presetName.trim() ? D.accent : 'rgba(255,255,255,0.05)',
                      color: presetName.trim() ? '#000' : D.textMuted,
                      border: `1px solid ${D.cardBorder}`, cursor: presetName.trim() ? 'pointer' : 'default',
                      opacity: presetName.trim() ? 1 : 0.5,
                    }}
                  >
                    Save
                  </button>
                </div>

                {/* Show saved presets */}
                {savedPresets.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: D.textMuted, marginBottom: 8 }}>Your saved presets</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {savedPresets.map(preset => (
                        <div
                          key={preset.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                            borderRadius: 6, background: 'rgba(32,26,20,0.03)', border: `1px solid ${D.cardBorder}`,
                            fontSize: 11,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setBgCustomColor(preset.color)}
                            title={preset.color}
                            style={{
                              width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                              background: preset.color, border: `1px solid ${D.cardBorder}`, padding: 0,
                            }}
                          />
                          <span style={{ color: D.text, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>{preset.name}</span>
                          <button
                            type="button"
                            onClick={() => deletePreset(preset.id)}
                            style={{
                              fontSize: 10, fontWeight: 700, color: D.textMuted, background: 'none', border: 'none',
                              cursor: 'pointer', padding: '0 4px',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Blurred strength range slider input (Only visible when Blur background is checked) */}
            {bgType === 'blur' && (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 8, background: 'rgba(32,26,20,0.03)', border: `1px solid ${D.cardBorder}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: D.textMuted, marginBottom: 8 }}>
                  <span>Blur strength</span>
                  <span style={{ color: D.accent }}>{Math.round(blurOpacity * 100)}%</span>
                </div>
                {/* Slider input adjusts blur opacity between 15% and 100% */}
                <input 
                  type="range" 
                  min="0.15" 
                  max="1" 
                  step="0.05" 
                  value={blurOpacity}
                  onChange={e => setBlurOpacity(Number(e.target.value))}
                  style={{ width: '100%', accentColor: D.accent }} 
                />
              </div>
            )}
          </div>

          {/* 2. OVERLAY TEXT */}
          <div style={{ marginBottom: 28 }}>
            <div style={sectionLabel}>
              Custom Overlay Text
              <span style={{ fontWeight: 400, opacity: 0.5, marginLeft: 6 }}>(optional)</span>
            </div>
            <textarea
              rows={2}
              value={originalOverlay}
              onChange={e => {
                setOriginalOverlay(e.target.value)
                setOverlayMode(e.target.value.trim() ? 'original' : 'generated')
              }}
              placeholder="Leave blank for AI-generated overlays (recommended)"
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'none',
                background: D.card, border: `1px solid ${D.cardBorder}`, borderRadius: 8,
                color: D.text, fontSize: 13, padding: '10px 12px', outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.5,
              }}
            />
            <div style={{ fontSize: 12, color: D.textMuted, paddingTop: 6, marginBottom: 14 }}>
              {ocrStatus === 'reading' && !originalOverlay.trim()
                ? 'Reading on-screen text from your video — it will fill in here automatically…'
                : originalOverlay.trim()
                  ? 'Your text will be applied to the video. AI overlays are also available in the editor.'
                  : 'AI will pick the most relatable hook from the generated overlays as default.'}
            </div>

            {/* Overlay text alignment — applies to the generated clip; can still be changed later in the editor. */}
            <div style={{ fontSize: 11, fontWeight: 700, color: D.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Text Alignment
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { id: 'left', icon: 'format_align_left' },
                { id: 'center', icon: 'format_align_center' },
                { id: 'right', icon: 'format_align_right' },
              ].map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setTextAlign(o.id)}
                  style={iconBtn(textAlign === o.id)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: textAlign === o.id ? D.accent : D.textSoft }}>{o.icon}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 3. PRIMARY GENERATE CLIPS SUBMIT BUTTON */}
          <button
            type="button"
            onClick={startProcessing}
            disabled={submitting}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '15px 24px', borderRadius: 8, cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 15, fontWeight: 800, letterSpacing: 0,
              border: `1px solid ${D.accentBorder}`,
              background: submitting ? 'rgba(255,90,61,0.12)' : D.accent,
              color: '#0a0a0f',
              boxShadow: 'none',
              opacity: submitting ? 0.75 : 1,
              transition: 'all 0.2s',
              outline: 'none',
            }}
          >
            {submitting ? (
              <><span className="material-symbols-outlined anim-spin" style={{ fontSize: 20 }}>progress_activity</span> Uploading {uploadPct}% — keep the app open</>
            ) : (
              <><span className="material-symbols-outlined" style={{ fontSize: 20 }}>rocket_launch</span> Generate Clips →</>
            )}
          </button>

          {/* Live upload progress bar + retry note — visible only while uploading */}
          {submitting ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 6, borderRadius: 99, background: 'rgba(32,26,20,0.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${uploadPct}%`, borderRadius: 99,
                  background: `linear-gradient(90deg, ${D.accent}, ${D.success})`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ fontSize: 12, color: uploadNote ? D.accent : D.textMuted, paddingTop: 6, textAlign: 'center' }}>
                {uploadNote || 'Stay on this page until the upload finishes — then clips render on the server even if you leave.'}
              </div>
            </div>
          ) : null}
        </div>

      </div>
    </div>
  )

  return null
}
