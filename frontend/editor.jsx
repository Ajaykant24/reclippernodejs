// ── ADVANCED TIMELINE VIDEO EDITOR: editor.jsx ──
// - Purpose: This is your high-impact video editor board.
// - Key Roles:
//   1. Provides an interactive 9:16 mobile mock preview canvas with active snapping alignment guidelines.
//   2. Supports drag-and-drop mouse movements to reposition foreground video layers, text hooks, logo watermarks, or subtitles.
//   3. Configures solid or blurred backgrounds, volume boosts beyond 100% via the browser's Web Audio API, and subtitle templates.
//   4. Package selections and fires standard export render calls.
// - Editing Tip: To change tab names, font options, or text styles in the editor sidebar, look under the constants and JSX returns below.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, API_BASE, resolveUrl } from './api/client'

// ── CANVAS STAGE SIZE METRICS ──
const STAGE_W = 405
const STAGE_H = 720
const EXPORT_H = 1920
const EXPORT_SCALE = EXPORT_H / STAGE_H
const EXACT_CROP_RATIO = 'Exact'
const DEFAULT_OUTPUT_RATIO = EXACT_CROP_RATIO
const PREVIEW_VERTICAL_SHIFT = 39
const DEFAULT_WORDS_PER_LINE = 4
const TEXT_VIDEO_GAP = 14
const SUBTITLE_VIDEO_GAP = 10
const EXACT_CROP_VERTICAL_SHIFT = 34
const VIDEO_SIDE_MARGIN_RATIO = 0.07

// Overlay-text font stack. The bundled "SFProDisplayWeb" (see @font-face in
// index.css) is listed first so overlay text looks identical on every device,
// instead of only rendering as true SF Pro on Apple hardware.
const OVERLAY_FONT_STACK = '"SFProDisplayWeb", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

// ── Presets Lists Database ──
const RATIOS = [
  { label: '3:2', w: 3, h: 2 },
  { label: '9:16', w: 9, h: 16 },
  { label: '2:3', w: 2, h: 3 },
  { label: '3:4', w: 3, h: 4 },
  { label: '16:9', w: 16, h: 9 },
  { label: '1:1', w: 1, h: 1 },
  { label: '4:5', w: 4, h: 5 },
  { label: '4:3', w: 4, h: 3 },
  { label: '21:9', w: 21, h: 9 },
]

const BG_OPTIONS = [
  { id: 'black', label: 'Black' },
  { id: 'white', label: 'White' },
  { id: 'blur', label: 'Blur Video' },
  { id: 'custom', label: 'Custom' },
]

const TABS = [
  { id: 'overlay', label: 'Overlay', icon: 'title' },
  { id: 'subtitles', label: 'Subtitles', icon: 'subtitles' },
  { id: 'canvas', label: 'Ratio', icon: 'aspect_ratio' },
  { id: 'background', label: 'Background', icon: 'wallpaper' },
  { id: 'igcaption', label: 'Caption', icon: 'tag' },
  { id: 'logo', label: 'Logo', icon: 'branding_watermark' },
]

const BACKGROUND_COLORS = [
  { label: 'Black', value: '#0f1116' },
  { label: 'White', value: '#ffffff' },
  { label: 'Midnight', value: '#111827' },
  { label: 'Charcoal', value: '#22252c' },
  { label: 'Graphite', value: '#3b3f46' },
  { label: 'Lime', value: '#a0d83e' },
  { label: 'Aqua', value: '#5ce1e6' },
  { label: 'Orange', value: '#ff9700' },
  { label: 'Red', value: '#ff3b30' },
  { label: 'Blue', value: '#2f80ed' },
]

const CAPTION_FONTS = [
  { label: 'Arial Bold', value: 'Arial' },
  { label: 'Impact', value: 'Impact' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Montserrat', value: 'Montserrat' },
  { label: 'Poppins', value: 'Poppins' },
]

// SUBTITLE STYLE TEMPLATE PRESETS
const CAPTION_TEMPLATES = [
  { id: 'mc_glow', name: 'MC Glow', badge: 'New', tone: 'lime', exportStyle: 'highlight', fontSize: 34, primary: '#ffffff', emphasis: '#a0d83e', spotlight: '#a0d83e', box: false, uppercase: true, tags: ['Bold', 'Glow'] },
  { id: 'mc_abdaal', name: 'MC Abdaal', tone: 'paper', exportStyle: 'box', fontSize: 30, primary: '#050505', emphasis: '#050505', spotlight: '#ffffff', box: true, uppercase: false, tags: ['Clean', 'Box'] },
  { id: 'mc_shadow', name: 'MC Shadow', badge: 'New', tone: 'orange', exportStyle: 'highlight', fontSize: 32, primary: '#ffffff', emphasis: '#ff9700', spotlight: '#000000', box: false, uppercase: true, tags: ['Bold', 'Shadow'] },
  { id: 'mc_clean', name: 'MC Clean', tone: 'clean', exportStyle: '1_word', fontSize: 28, primary: '#ffffff', emphasis: '#ffffff', spotlight: '#000000', box: false, uppercase: false, tags: ['Minimal'] },
  { id: 'mc_aqua', name: 'MC Aqua', tone: 'aqua', exportStyle: 'highlight', fontSize: 32, primary: '#ffffff', emphasis: '#5ce1e6', spotlight: '#000000', box: false, uppercase: true, tags: ['Bold'] },
  { id: 'mc_dark_box', name: 'MC Dark Box', tone: 'dark-box', exportStyle: 'box', fontSize: 28, primary: '#ffffff', emphasis: '#ffffff', spotlight: '#000000', box: true, uppercase: false, tags: ['Box'] },
  { id: 'mc_red', name: 'MC Red Pop', tone: 'red', exportStyle: 'highlight', fontSize: 32, primary: '#ffffff', emphasis: '#ff3b30', spotlight: '#000000', box: false, uppercase: true, tags: ['Pop'] },
]

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function isDarkHexColor(value) {
  // Evaluates if custom hex background colors are dark, to automatically adjust overlay contrast.
  const hex = String(value || '').replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return ((r * 299 + g * 587 + b * 114) / 1000) < 90
}

function makeOverlayImage({ lines, textBox, fontSize, color, align, style, shadow, logoImg, logoLeft, logoTop, logoSize }) {
  // Generates transparent watermark PNG overlays inside browser canvas, matching editorial designs on screen.
  if (!lines?.length && !logoImg) return ''

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(STAGE_W * EXPORT_SCALE)
  canvas.height = EXPORT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 1. Logo Watermark rendering layer
  if (logoImg) {
    try {
      const exportLogoLeft = logoLeft * EXPORT_SCALE
      const exportLogoTop = logoTop * EXPORT_SCALE
      const exportLogoSize = logoSize * EXPORT_SCALE
      ctx.drawImage(logoImg, exportLogoLeft, exportLogoTop, exportLogoSize, exportLogoSize)
    } catch (err) {
      console.warn("Failed to draw logo on export canvas:", err)
    }
  }

  // 2. Custom text hook overlay rendering layer
  const exportFontSize = fontSize * EXPORT_SCALE
  ctx.font = `400 ${exportFontSize}px ${OVERLAY_FONT_STACK}`
  ctx.textBaseline = 'top'
  ctx.textAlign = align
  ctx.fillStyle = color

  if (shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = 8 * EXPORT_SCALE
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 2 * EXPORT_SCALE
  }

  const lineHeight = exportFontSize * 1.25
  const gap = Math.round(exportFontSize * 0.18)
  const exportBox = {
    x: textBox.x * EXPORT_SCALE,
    y: textBox.y * EXPORT_SCALE,
    w: textBox.w * EXPORT_SCALE,
  }
  const x =
    align === 'left'
      ? exportBox.x
      : align === 'right'
        ? exportBox.x + exportBox.w
        : exportBox.x + exportBox.w / 2

  lines.forEach((line, index) => {
    const y = exportBox.y + index * (lineHeight + gap)
    // Box style wraps title text inside a solid semi-transparent rectangle
    if (style === 'box') {
      const metrics = ctx.measureText(line)
      const boxPaddingX = 10 * EXPORT_SCALE
      const boxPaddingY = 5 * EXPORT_SCALE
      const boxW = metrics.width + boxPaddingX * 2
      const boxH = lineHeight + boxPaddingY * 2
      const boxX = align === 'left' ? x - boxPaddingX : align === 'right' ? x - boxW + boxPaddingX : x - boxW / 2
      ctx.save()
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = 'rgba(10, 15, 25, 0.76)'
      ctx.fillRect(boxX, y - boxPaddingY, boxW, boxH)
      ctx.restore()
      ctx.fillStyle = color
    }
    ctx.fillText(line, x, y)
  })

  return canvas.toDataURL('image/png')
}

function assetUrl(path) {
  return resolveUrl(path)
}

function readStoredJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function getClipIdValue(item) {
  return item?.clip_id || item?.id || null
}

function normalizeRatio(value) {
  const raw = String(value || '').trim()
  if (raw.toLowerCase() === 'original' || raw.toLowerCase() === 'exact') return EXACT_CROP_RATIO
  return RATIOS.some(item => item.label === raw) ? raw : ''
}

function inferClipRatio(clip, routeState = {}) {
  const candidates = [
    routeState.cropRatio,
    routeState.crop_ratio,
    routeState.outputRatio,
    routeState.output_ratio,
    clip?.crop_ratio,
    clip?.cropRatio,
    clip?.output_ratio,
    clip?.outputRatio,
    clip?.editor_payload?.crop_ratio,
    clip?.editor_payload?.cropRatio,
    clip?.editor_payload?.output_ratio,
    clip?.editor_payload?.outputRatio,
  ]

  for (const candidate of candidates) {
    const ratio = normalizeRatio(candidate)
    if (ratio) return ratio
  }

  return DEFAULT_OUTPUT_RATIO
}

function getExactCropRatio(clip) {
  const width = Number(clip?.canvas_w || clip?.crop_w || clip?.source_w || 0)
  const height = Number(clip?.canvas_h || clip?.crop_h || clip?.source_h || 0)
  if (width > 0 && height > 0) return { w: width, h: height }
  return { w: 3, h: 2 }
}

// Per-clip local cache of editor edits. Lets edits survive export -> back to
// Projects -> reopen on the SAME device even before the backend (which stores
// editor_payload on the clip) is rebuilt. Server editor_payload always wins.
function editsCacheKey(clipId) {
  return `rc_edits_${clipId}`
}

function loadCachedEdits(clipId) {
  if (!clipId || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(editsCacheKey(clipId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveCachedEdits(clipId, payload) {
  if (!clipId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(editsCacheKey(clipId), JSON.stringify(payload))
  } catch { /* storage full/unavailable */ }
}

// Attaches locally-cached edits as clip.editor_payload when the clip has none
// from the server, so the existing restore logic works unchanged.
function withCachedEdits(clip) {
  if (!clip) return clip
  if (clip.editor_payload) return clip
  const cached = loadCachedEdits(getClipIdValue(clip))
  return cached ? { ...clip, editor_payload: cached } : clip
}

function buildEditorState(targetClipId) {
  const storedClip = readStoredJson('editClip')
  const storedClipList = readStoredJson('editClipList', [])
  const legacyData = readStoredJson('memeclips-data', {})
  const legacyClips = Array.isArray(legacyData?.clips) ? legacyData.clips : []
  const clipList = (Array.isArray(storedClipList) && storedClipList.length ? storedClipList : legacyClips).filter(Boolean)

  let clip = null
  if (targetClipId) {
    clip = clipList.find(item => getClipIdValue(item) === targetClipId) || null
  }
  if (!clip && storedClip) clip = storedClip
  if (!clip && clipList.length) clip = clipList[0]

  clip = withCachedEdits(clip)

  const clipId = getClipIdValue(clip)
  const clipIndex = clipId ? clipList.findIndex(item => getClipIdValue(item) === clipId) : -1
  return { clip, clipList, clipIndex }
}

function formatTime(seconds) {
  // Converts raw timestamp seconds (e.g. 74.2) into human-friendly playback time strings (e.g. "1:14")
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = String(Math.floor(seconds) % 60).padStart(2, '0')
  return `${m}:${s}`
}

function cleanOverlayText(value) {
  const cleaned = String(value || '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return ''
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function getOverlayMeasureContext() {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  return canvas.getContext('2d')
}

function wrapText(value, maxWidth = 260, fontSize = 20) {
  const text = cleanOverlayText(value)
  const words = text.split(' ').filter(Boolean)
  if (!words.length) return []

  const ctx = getOverlayMeasureContext()
  const safeMaxWidth = Math.max(80, Number(maxWidth) || 260)
  const safeFontSize = clamp(Number(fontSize) || 20, 14, 64)
  const font = `400 ${safeFontSize}px ${OVERLAY_FONT_STACK}`

  if (ctx) {
    ctx.font = font
  }

  const measure = line => {
    if (ctx) return ctx.measureText(line).width
    return line.length * safeFontSize * 0.52
  }

  const lines = []
  let line = ''

  words.forEach(word => {
    const testLine = line ? `${line} ${word}` : word

    // Width-only logic: keep adding words until the rendered line reaches cropped-video text width.
    // Font size can change freely; wrapping always follows the real measured pixel width.
    if (measure(testLine) <= safeMaxWidth) {
      line = testLine
      return
    }

    if (line) {
      lines.push(line)
      line = ''
    }

    if (measure(word) <= safeMaxWidth) {
      line = word
      return
    }

    // Very long single words are split only as a safety fallback.
    let chunk = ''
    Array.from(word).forEach(char => {
      const testChunk = `${chunk}${char}`
      if (measure(testChunk) <= safeMaxWidth) {
        chunk = testChunk
      } else {
        if (chunk) lines.push(chunk)
        chunk = char
      }
    })
    line = chunk
  })

  if (line) lines.push(line)

  return lines
}

function getPreviewBox(label, clip) {
  const makeBox = (sourceRatio, verticalShift = PREVIEW_VERTICAL_SHIFT) => {
    const w = STAGE_W * (1 - VIDEO_SIDE_MARGIN_RATIO * 2)
    const h = w * (sourceRatio.h / sourceRatio.w)
    return {
      l: STAGE_W * VIDEO_SIDE_MARGIN_RATIO,
      t: (STAGE_H - h) / 2 + verticalShift,
      w,
      h,
    }
  }

  if (label === EXACT_CROP_RATIO) {
    return makeBox(getExactCropRatio(clip), EXACT_CROP_VERTICAL_SHIFT)
  }

  const ratio = RATIOS.find(item => item.label === label) || RATIOS[0]
  return makeBox(ratio)
}

// Shared palette + in-app color picker (circles + hex). Replaces native
// <input type="color"> so the phone's OS color dialog never opens.
const SWATCH_COLORS = ['#ffffff', '#000000', '#ff5a3d', '#ffd60a', '#a0d83e', '#5ce1e6', '#2f80ed', '#ff3b30', '#ff9700', '#111827']

function ColorSwatchRow({ value, onChange, colors = SWATCH_COLORS }) {
  const current = String(value || '').toLowerCase()
  return (
    <div className="swatch-row">
      {colors.map(c => (
        <button
          key={c}
          type="button"
          aria-label={c}
          title={c}
          onClick={() => onChange(c)}
          className={`swatch${current === c.toLowerCase() ? ' active' : ''}`}
          style={{ background: c }}
        />
      ))}
      <label className="swatch-hex">
        <span className="swatch-hex-dot" style={{ background: value }} />
        <input
          type="text"
          value={value}
          maxLength={7}
          onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value) }}
        />
      </label>
    </div>
  )
}

function AlignButton({ active, icon, onClick }) {
  return (
    <button type="button" className={`btn btn-sm ${active ? 'btn-solid-white' : 'btn-glass'}`} onClick={onClick}>
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
        {icon}
      </span>
    </button>
  )
}

export default function Editor() {
  const navigate = useNavigate()
  const { clipId } = useParams()

  // ── HOOKED DOCUMENT REFERENCE POINTERS ──
  const videoRef = useRef(null)         // Active foreground video HTML player
  const bgVideoRef = useRef(null)       // Background video player (plays blurred underneath)
  const logoInputRef = useRef(null)     // Invisible logo image upload click trigger
  const stageRef = useRef(null)         // Absolute stage container div
  const sheetDragRef = useRef(null)     // Mobile settings sheet drag tracker

  // Drag coordinates references
  const videoDragRef = useRef(null)
  const textDragRef = useRef(null)

  // ── EDITOR CONTROLS STATES ──
  const [editorState, setEditorState] = useState(() => buildEditorState(clipId))
  const clip = editorState.clip
  const clipList = editorState.clipList
  const clipIndex = editorState.clipIndex
  const prevClip = clipIndex > 0 ? clipList[clipIndex - 1] : null
  const nextClip = clipIndex >= 0 && clipIndex < clipList.length - 1 ? clipList[clipIndex + 1] : null

  const location = useLocation()
  const routeState = useMemo(() => location.state || {}, [location.state])

  // SAVED EDITS: when a clip was edited before, the backend stores every setting in
  // clip.editor_payload. Each state below restores from it (falling back to defaults),
  // so reopening a project shows the exact edited version instead of the raw generation.
  const ep = clip?.editor_payload || {}

  const [tab, setTab] = useState('overlay') // Currently active customizer sidebar tab
  const [mobileSheet, setMobileSheet] = useState('mid')
  // Mobile bottom-sheet: which tool panel is open (null = closed, showing just the
  // big preview + bottom toolbar, like the CapCut/Captions reference).
  const [panelOpen, setPanelOpen] = useState(false)
  const openTool = useCallback(id => { setTab(id); setPanelOpen(true) }, [])
  const [ratio, setRatio] = useState(() => inferClipRatio(clip, routeState))
  const [bgType, setBgType] = useState(ep.bgType ?? routeState.bgType ?? 'black')
  const [bgCustomColor, setBgCustomColor] = useState(ep.bgCustomColor ?? routeState.bgColor ?? '#111827')
  const [blurStrength, setBlurStrength] = useState(ep.blurStrength ?? (routeState.blurOpacity !== undefined ? Math.round(routeState.blurOpacity * 100) : 42))

  // Subtitles States
  const [enableCaptions, setEnableCaptions] = useState(ep.enableCaptions ?? false)
  const [captionStyle, setCaptionStyle] = useState(ep.captionStyle ?? '1_word')
  const [captionText, setCaptionText] = useState(ep.captionText ?? '')
  const [captionCopied, setCaptionCopied] = useState(false)
  const [captionTemplateId, setCaptionTemplateId] = useState(ep.captionTemplateId ?? 'mc_glow')
  const [captionSearch, setCaptionSearch] = useState('')
  const [captionFont, setCaptionFont] = useState(ep.captionFont ?? 'Arial')
  const [captionFontSize, setCaptionFontSize] = useState(ep.captionFontSize ?? 15)
  const [captionPrimaryColor, setCaptionPrimaryColor] = useState(ep.captionPrimaryColor ?? '#ffffff')
  const [captionEmphasisColor, setCaptionEmphasisColor] = useState(ep.captionEmphasisColor ?? '#a0d83e')
  const [captionSpotlightColor, setCaptionSpotlightColor] = useState(ep.captionSpotlightColor ?? '#a0d83e')
  const [captionBox, setCaptionBox] = useState(ep.captionBox ?? false)
  const [captionUppercase, setCaptionUppercase] = useState(ep.captionUppercase ?? false)
  const [captionOffsetX, setCaptionOffsetX] = useState(ep.captionOffsetX ?? 0)
  const [captionOffsetY, setCaptionOffsetY] = useState(ep.captionOffsetY ?? 0)
  const [captionDragPos, setCaptionDragPos] = useState(ep.captionDragPos ?? null)
  const [captionWords, setCaptionWords] = useState([])
  const [captionLoading, setCaptionLoading] = useState(false)

  // Custom text hook overlays states
  const [customText, setCustomText] = useState(ep.customText ?? clip?.overlay_texts?.[0] ?? clip?.hook ?? '')
  const [textHidden, setTextHidden] = useState(ep.textHidden ?? false)
  const [textAlign, setTextAlign] = useState(ep.textAlign ?? clip?.text_align ?? 'left')
  const [textStyle, setTextStyle] = useState(ep.textStyle ?? 'plain')
  const [textColor, setTextColor] = useState(ep.textColor ?? '#ffffff')
  const [fontSize, setFontSize] = useState(ep.fontSize ?? 20)
  const [textWidthPercent, setTextWidthPercent] = useState(ep.textWidthPercent ?? 96)
  const [textOffsetX, setTextOffsetX] = useState(ep.textOffsetX ?? 0)
  const [textOffsetY, setTextOffsetY] = useState(ep.textOffsetY ?? 0)

  // Layout transform coordinates
  const [vtx, setVtx] = useState(ep.vtx ?? { ox: 0, oy: 0, scale: 1 })
  const [videoDragPos, setVideoDragPos] = useState(ep.videoDragPos ?? null)
  const [textDragPos, setTextDragPos] = useState(ep.textDragPos ?? null)
  const [snapLines, setSnapLines] = useState({ h: false, v: false }) // Alignment snapped guidelines trigger
  // UI-only (not persisted): collapses the AI-suggested-hooks list so users reach
  // Alignment/Style/Color/Size without scrolling past a long list by default.
  const [showAiHooks, setShowAiHooks] = useState(false)

  // Custom logo states
  const [logo, setLogo] = useState(ep.logo ?? null)
  const [logoScale, setLogoScale] = useState(ep.logoScale ?? 1)
  const [logoX, setLogoX] = useState(ep.logoX ?? 0)
  const [logoY, setLogoY] = useState(ep.logoY ?? 0)

  // Playback control states
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(ep.volume ?? 1)
  const [exporting, setExporting] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [foregroundPlaying, setForegroundPlaying] = useState(false)

  const revealVideoAfterFramePaint = () => {
    const reveal = () => setVideoReady(true)
    requestAnimationFrame(() => requestAnimationFrame(reveal))
  }

  const syncBackgroundVideoToMain = useCallback((force = false) => {
    const main = videoRef.current
    const bg = bgVideoRef.current
    if (!main || !bg) return

    const mainDuration = Number(main.duration || 0)
    const bgDuration = Number(bg.duration || 0)
    let targetTime = main.currentTime || 0

    if (mainDuration > 0 && bgDuration > 0 && Math.abs(mainDuration - bgDuration) > 0.25) {
      const progress = clamp(targetTime / mainDuration, 0, 1)
      targetTime = progress * bgDuration
    }

    if (Number.isFinite(targetTime) && (force || Math.abs((bg.currentTime || 0) - targetTime) > 0.05)) {
      try {
        bg.currentTime = clamp(targetTime, 0, Math.max(0, bgDuration - 0.05) || targetTime)
      } catch {
        // Browser may block currentTime changes until metadata is ready. Next sync will catch it.
      }
    }
  }, [])

  // Volume boosts refs (Audio Booster)
  const audioCtxRef = useRef(null)
  const gainNodeRef = useRef(null)
  const sourceNodeRef = useRef(null)

  // Dynamic screen sizes listeners
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  // Measured size of the preview pane container. The stage is fitted to THIS box
  // (via ResizeObserver below) rather than window.innerHeight, so the video preview
  // never jitters/resizes when the mobile address bar or keyboard shows/hides.
  const previewPaneRef = useRef(null)
  const [paneSize, setPaneSize] = useState(null)

  const ratioOptions = useMemo(() => [{ label: EXACT_CROP_RATIO }, ...RATIOS], [])
  const pb = useMemo(() => getPreviewBox(ratio, clip), [clip, ratio])

  // DYNAMIC COMPONENT RESIZER MATH: fits the 9:16 stage inside the preview pane.
  const stageScale = useMemo(() => {
    const isMobilePreview = windowSize.w <= 768
    // Cap the mobile preview so the 9:16 canvas sits as a framed card with margins
    // (not full-bleed edge-to-edge).
    const maxScale = windowSize.w >= 1024 ? 1.05 : isMobilePreview ? 0.74 : 1.06
    const minScale = isMobilePreview ? 0.30 : 0.6
    // Reserve vertical room inside the pane for the playback bar + gaps + padding,
    // and a little horizontal padding, so the stage sits comfortably.
    const reservedY = 78
    const padX = 24
    let availW, availH
    if (paneSize && paneSize.w > 0 && paneSize.h > 0) {
      availW = paneSize.w - padX
      availH = paneSize.h - reservedY
    } else {
      // First-paint fallback before the ResizeObserver reports (avoids a flash).
      availW = windowSize.w - (windowSize.w >= 1024 ? 640 : 34)
      availH = (isMobilePreview ? windowSize.h * 0.7 : windowSize.h - 190)
    }
    const widthFit = availW / STAGE_W
    const heightFit = availH / STAGE_H
    return Math.max(minScale, Math.min(maxScale, Math.min(widthFit, heightFit)))
  }, [paneSize, windowSize.w, windowSize.h])

  const stageWidth = STAGE_W * stageScale
  const stageHeight = STAGE_H * stageScale
  const previewPanelWidth = stageWidth + 8

  // Zoom is always uniform (a single scale factor) — this is what prevents the
  // video from ever looking stretched/squeezed. Width and height must change
  // TOGETHER when zooming, never independently.
  let vw = clamp(pb.w * vtx.scale, 90, STAGE_W)
  let vh = clamp(pb.h * vtx.scale, 90, STAGE_H)

  // Resolved positioning (free-drag positioning overrides standard presets)
  let vl = videoDragPos
    ? clamp(videoDragPos.x, -vw + 30, STAGE_W - 30)
    : clamp(pb.l + vtx.ox, -vw + 30, STAGE_W - 30)
  let vt = videoDragPos
    ? clamp(videoDragPos.y, -vh + 30, STAGE_H - 30)
    : clamp(pb.t + vtx.oy, -vh + 30, STAGE_H - 30)

  // ── CROP FRAME ──
  const cropInsets = vtx.cropInsets ?? { l: 0, t: 0, r: 0, b: 0 }
  const MIN_FRAME_SIZE = 40
  const insetL = clamp(cropInsets.l ?? 0, 0, Math.max(0, vw - MIN_FRAME_SIZE))
  const insetT = clamp(cropInsets.t ?? 0, 0, Math.max(0, vh - MIN_FRAME_SIZE))
  const insetR = clamp(cropInsets.r ?? 0, 0, Math.max(0, vw - MIN_FRAME_SIZE - insetL))
  const insetB = clamp(cropInsets.b ?? 0, 0, Math.max(0, vh - MIN_FRAME_SIZE - insetT))
  const frameL = vl + insetL
  const frameT = vt + insetT
  const frameW = vw - insetL - insetR
  const frameH = vh - insetT - insetB

  // ── CROP-AWARE ZOOM & PAN CONSTRAINTS ──
  // When an active crop exists, re-constrain zoom/pan to frame bounds instead of stage bounds
  const hasCrop = cropInsets && (cropInsets.l > 0 || cropInsets.t > 0 || cropInsets.r > 0 || cropInsets.b > 0)
  if (hasCrop && frameW > 0 && frameH > 0) {
    // Constrain zoom to stay within frame
    vw = clamp(pb.w * vtx.scale, 90, frameW)
    vh = clamp(pb.h * vtx.scale, 90, frameH)
    // Recalculate frame bounds after zoom change
    const newInsetL = clamp(cropInsets.l ?? 0, 0, Math.max(0, vw - MIN_FRAME_SIZE))
    const newInsetT = clamp(cropInsets.t ?? 0, 0, Math.max(0, vh - MIN_FRAME_SIZE))
    const newFrameL = vl + newInsetL
    const newFrameT = vt + newInsetT
    const newFrameW = vw - newInsetL - clamp(cropInsets.r ?? 0, 0, Math.max(0, vw - MIN_FRAME_SIZE - newInsetL))
    const newFrameH = vh - newInsetT - clamp(cropInsets.b ?? 0, 0, Math.max(0, vh - MIN_FRAME_SIZE - newInsetT))
    // Constrain pan to keep entire video box within frame bounds
    vl = videoDragPos
      ? clamp(videoDragPos.x, newFrameL - vw + 30, newFrameL + newFrameW - 30)
      : clamp(pb.l + vtx.ox, newFrameL - vw + 30, newFrameL + newFrameW - 30)
    vt = videoDragPos
      ? clamp(videoDragPos.y, newFrameT - vh + 30, newFrameT + newFrameH - 30)
      : clamp(pb.t + vtx.oy, newFrameT - vh + 30, newFrameT + newFrameH - 30)
  }

  const videoLeft = vl
  const videoTop = vt
  const videoWidth = vw
  const videoHeight = vh

  const renderedFontSize = clamp(fontSize, 14, 64)
  const textWidthRatio = clamp(textWidthPercent, 55, 96) / 100
  // Keep the overlay text width within the cropped video width so it never spills past the video.
  const textBlockW = clamp(frameW * textWidthRatio, 90, Math.max(90, frameW - 8))
  const lines = useMemo(() => wrapText(customText, textBlockW, renderedFontSize), [customText, textBlockW, renderedFontSize])

  const lineH = renderedFontSize * 1.25
  const lineGap = Math.round(renderedFontSize * 0.18)
  const textBlockHeight = lines.length
    ? lines.length * lineH + Math.max(0, lines.length - 1) * lineGap
    : lineH

  // Coordinates calculators for title overlays
  // Overlay stays reference-anchored to the cropped video frame.
  // More lines grow upward, so line 2/3 never cover the video.
  // The text block's horizontal anchor follows the chosen alignment: flush with
  // the frame's left edge, centered, or flush with the frame's right edge. The
  // block width is already capped to the frame's width above, so it's never
  // wider than (or positioned outside) the cropped frame regardless of align.
  const defaultTextX = textAlign === 'left'
    ? frameL
    : textAlign === 'right'
      ? frameL + frameW - textBlockW
      : frameL + frameW / 2 - textBlockW / 2
  const defaultTextY = frameT - TEXT_VIDEO_GAP - textBlockHeight
  const baseTextX = textDragPos ? textDragPos.x : defaultTextX
  const baseTextY = textDragPos ? textDragPos.y : defaultTextY
  const textX = clamp(baseTextX + textOffsetX, 12, STAGE_W - textBlockW - 12)
  const textY = clamp(baseTextY + textOffsetY, 12, STAGE_H - textBlockHeight - 12)
  const ttx = { x: textX, y: textY, w: textBlockW }

  // Coordinates calculators for subtitles
  const captionBoxW = clamp(frameW * 0.88, 170, STAGE_W - 24)
  const captionBlockHeight = captionFontSize * 1.35
  const defaultCaptionX = frameL + frameW / 2 - captionBoxW / 2
  const defaultCaptionY = frameT + frameH - captionBlockHeight - SUBTITLE_VIDEO_GAP
  const captionX = clamp((captionDragPos ? captionDragPos.x : defaultCaptionX) + captionOffsetX, 12, STAGE_W - captionBoxW - 12)
  const captionY = clamp((captionDragPos ? captionDragPos.y : defaultCaptionY) + captionOffsetY, 12, STAGE_H - captionBlockHeight - 12)
  const captionTransform = { x: captionX, y: captionY, w: captionBoxW }

  // Real-time subtitle word synchronizer
  const liveCaptionWords = useMemo(() => (
    captionWords.filter(item => item?.word && Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end)))
  ), [captionWords])

  const activeCaptionText = useMemo(() => {
    // Purpose: Keeps subtitles strictly aligned with video player currentTime, showing matching words on screen in real-time.
    if (!liveCaptionWords.length) return ''
    const timedIndex = liveCaptionWords.findIndex(item => currentTime >= Number(item.start || 0) && currentTime <= Number(item.end || 0))
    if (timedIndex < 0) return ''
    const count = captionStyle === '2_word' ? 2 : 1
    const words = liveCaptionWords.slice(timedIndex, timedIndex + count).map(item => item?.word).filter(Boolean).join(' ')
    return captionUppercase ? words.toUpperCase() : words
  }, [captionStyle, captionUppercase, currentTime, liveCaptionWords])

  const logoSize = Math.round(56 * logoScale)
  const logoLeft = clamp(logoX, 0, STAGE_W - logoSize)
  const logoTop = clamp(logoY, 0, STAGE_H - logoSize)

  const clipUrl = clip ? assetUrl(clip.clip_url) : ''
  const shouldShadowText = bgType === 'blur' && textStyle === 'plain' && !isDarkHexColor(textColor)

  const stageBg =
    bgType === 'black'
      ? '#0f1116'
      : bgType === 'white'
        ? '#ffffff'
        : bgType === 'custom'
          ? bgCustomColor
          : '#0f1116'

  const toggleMobileSheet = useCallback(() => {
    setMobileSheet(prev => (prev === 'full' ? 'mid' : prev === 'peek' ? 'mid' : 'full'))
  }, [])

  const handleSheetKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleMobileSheet()
  }, [toggleMobileSheet])

  const startMobileSheetDrag = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const startY = event.clientY
    const modes = ['peek', 'mid', 'full']
    const startMode = mobileSheet
    const startIndex = Math.max(0, modes.indexOf(startMode))
    sheetDragRef.current = { startY, startMode }

    const modeForDelta = delta => {
      if (delta < -56) return modes[Math.min(modes.length - 1, startIndex + 1)]
      if (delta > 56) return modes[Math.max(0, startIndex - 1)]
      return startMode
    }

    const handleMove = moveEvent => {
      if (moveEvent.cancelable) moveEvent.preventDefault()
      setMobileSheet(modeForDelta(moveEvent.clientY - startY))
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      sheetDragRef.current = null
    }

    const handleUp = upEvent => {
      const delta = upEvent.clientY - startY
      if (Math.abs(delta) < 10) {
        toggleMobileSheet()
      } else {
        setMobileSheet(modeForDelta(delta))
      }
      cleanup()
    }

    const handleCancel = () => {
      setMobileSheet(startMode)
      cleanup()
    }

    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
  }, [mobileSheet, toggleMobileSheet])

  const goBack = () => {
    const projectId = localStorage.getItem('editClipProjectId')
    if (window.history.length > 1) {
      navigate(-1)
    } else if (projectId) {
      navigate(`/projects/${projectId}`)
    } else {
      navigate('/projects')
    }
  }

  const openClip = target => {
    if (!target) return
    localStorage.setItem('editClip', JSON.stringify(target))
    localStorage.setItem('editClipList', JSON.stringify(clipList))
    navigate(`/editor/${getClipIdValue(target)}`)
  }

  // Window resizing helper. On mobile we IGNORE height-only changes (the address
  // bar / keyboard toggling) so the stage never jitters; we only care about width
  // (and orientation, which changes width). Desktop tracks both.
  useEffect(() => {
    const onResize = () => {
      setWindowSize(prev => {
        const w = window.innerWidth
        const h = window.innerHeight
        const isMobile = w <= 768
        // Ignore small height-only wiggles on mobile (address bar). Big height jumps
        // (orientation) also change width, so those still pass through.
        if (isMobile && w === prev.w && Math.abs(h - prev.h) < 160) return prev
        return { w, h }
      })
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  // Measure the preview pane and fit the stage to it (stable against address-bar noise).
  useEffect(() => {
    const el = previewPaneRef.current
    if (!el) return undefined
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setPaneSize(prev => {
        const w = Math.round(rect.width)
        const h = Math.round(rect.height)
        if (prev && Math.abs(prev.w - w) < 2 && Math.abs(prev.h - h) < 2) return prev
        return { w, h }
      })
    }
    measure()
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return () => { if (ro) ro.disconnect() }
  }, [])

  // Initialization/Reload watcher
  useEffect(() => {
    const nextState = buildEditorState(clipId)
    setEditorState(nextState)
    // Restore every saved edit from the clip's editor_payload (falls back to defaults
    // / the raw generation when a clip has never been edited).
    const nep = nextState.clip?.editor_payload || {}
    setRatio(inferClipRatio(nextState.clip, routeState))
    setBgType(nep.bgType ?? routeState.bgType ?? nextState.clip?.background_type ?? 'black')
    setBgCustomColor(nep.bgCustomColor ?? routeState.bgColor ?? nextState.clip?.background_color ?? '#111827')
    setBlurStrength(nep.blurStrength ?? (routeState.blurOpacity !== undefined ? Math.round(routeState.blurOpacity * 100) : 42))
    setVtx(nep.vtx ?? { ox: 0, oy: 0, scale: 1 })
    setTextDragPos(nep.textDragPos ?? null)
    setVideoDragPos(nep.videoDragPos ?? null)
    setCustomText(nep.customText ?? nextState.clip?.overlay_texts?.[0] ?? nextState.clip?.hook ?? '')
    setTextHidden(nep.textHidden ?? false)
    setTextAlign(nep.textAlign ?? nextState.clip?.text_align ?? 'left')
    setTextStyle(nep.textStyle ?? 'plain')
    setTextColor(nep.textColor ?? '#ffffff')
    setFontSize(nep.fontSize ?? 20)
    setTextWidthPercent(nep.textWidthPercent ?? 96)
    setTextOffsetX(nep.textOffsetX ?? 0)
    setTextOffsetY(nep.textOffsetY ?? 0)
    setVolume(nep.volume ?? 1)
    setLogo(nep.logo ?? null)
    setLogoScale(nep.logoScale ?? 1)
    setLogoX(nep.logoX ?? 0)
    setLogoY(nep.logoY ?? 0)
    setEnableCaptions(nep.enableCaptions ?? false)
    setCaptionStyle(nep.captionStyle ?? '1_word')
    setCaptionTemplateId(nep.captionTemplateId ?? 'mc_glow')
    setCaptionFont(nep.captionFont ?? 'Arial')
    setCaptionFontSize(nep.captionFontSize ?? 15)
    setCaptionPrimaryColor(nep.captionPrimaryColor ?? '#ffffff')
    setCaptionEmphasisColor(nep.captionEmphasisColor ?? '#a0d83e')
    setCaptionSpotlightColor(nep.captionSpotlightColor ?? '#a0d83e')
    setCaptionBox(nep.captionBox ?? false)
    setCaptionUppercase(nep.captionUppercase ?? false)
    setCaptionOffsetX(nep.captionOffsetX ?? 0)
    setCaptionOffsetY(nep.captionOffsetY ?? 0)
    setCaptionDragPos(nep.captionDragPos ?? null)
    setCaptionText(nep.captionText ?? nextState.clip?.clip_caption ?? '')
    setPlaying(false)
    setCurrentTime(0)
    setVideoReady(false)
    setForegroundPlaying(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
    if (bgVideoRef.current) {
      bgVideoRef.current.pause()
      bgVideoRef.current.currentTime = 0
    }
  }, [clipId, routeState])

  // Resets drag overrides on ratio change
  const prevPbRef = useRef(pb)
  useEffect(() => {
    setTextDragPos(null)
    setVideoDragPos(null)
    prevPbRef.current = pb
  }, [ratio])

  useEffect(() => {
    if (!logo) return
    setLogoX(pb.l + pb.w - 72)
    setLogoY(pb.t + pb.h - 72)
  }, [logo, pb.h, pb.l, pb.t, pb.w])

  useEffect(() => {
    if (bgType === 'white') {
      setTextColor('#111827')
    } else if (textColor === '#111827') {
      setTextColor('#ffffff')
    }
  }, [bgType])

  // ── AUDIBLE WEB BOOSTER VOLUME WORKFLOWS (WEB AUDIO API) ──
  // - Purpose: Allows increasing audio volume beyond 100% (boosts up to 200%) directly inside browser elements.
  const initAudioContext = () => {
    if (!videoRef.current || audioCtxRef.current) return
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return

      const ctx = new AudioContext()
      const gain = ctx.createGain()
      const source = ctx.createMediaElementSource(videoRef.current)
      source.connect(gain)
      gain.connect(ctx.destination)

      audioCtxRef.current = ctx
      gainNodeRef.current = gain
      sourceNodeRef.current = source
    } catch (e) {
      console.warn("Failed to initialize Web Audio API for volume boost:", e)
    }
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    if (volume > 1.0) {
      if (!audioCtxRef.current) {
        initAudioContext()
      }
      if (audioCtxRef.current && gainNodeRef.current) {
        if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume()
        }
        v.volume = 1.0
        gainNodeRef.current.gain.value = volume // Sets amplified gain
      } else {
        v.volume = clamp(volume, 0, 1)
      }
    } else {
      v.volume = volume
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = 1.0
      }
    }

    if (bgVideoRef.current) bgVideoRef.current.volume = 0
  }, [volume])

  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => { })
      }
    }
  }, [])

  // ── SUBTITLE TIMINGS QUERY ──
  useEffect(() => {
    if (!enableCaptions || !clip) return
    const targetClipId = getClipIdValue(clip)
    if (!targetClipId) return
    let alive = true
    setCaptionLoading(true)
    api.get(`/clips/${targetClipId}/captions`)
      .then(response => {
        if (!alive) return
        const words = Array.isArray(response.data?.words) ? response.data.words : []
        setCaptionWords(words.filter(item => item?.word))
      })
      .catch(() => {
        if (alive) setCaptionWords([])
      })
      .finally(() => {
        if (alive) setCaptionLoading(false)
      })
    return () => {
      alive = false
    }
  }, [clip, enableCaptions])

  // Playback sync watcher: foreground cropped video is the master, blurred background is only a slave layer.
  useEffect(() => {
    const main = videoRef.current
    const bg = bgVideoRef.current
    if (!main) return

    if (!playing) {
      main.pause()
      bg?.pause()
      setForegroundPlaying(false)
      return
    }

    let cancelled = false

    const startPlayback = async () => {
      try {
        setForegroundPlaying(false)

        if (bg) {
          bg.pause()
          syncBackgroundVideoToMain(true)
        }

        if (audioCtxRef.current?.state === 'suspended') {
          audioCtxRef.current.resume()
        }

        await main.play()
        if (cancelled) return

        const startBackgroundAfterForegroundFrame = () => {
          if (cancelled) return
          setForegroundPlaying(true)

          if (bg && bgType === 'blur') {
            syncBackgroundVideoToMain(true)
            bg.play().catch(() => { })
          }
        }

        if (typeof main.requestVideoFrameCallback === 'function') {
          main.requestVideoFrameCallback(startBackgroundAfterForegroundFrame)
        } else {
          requestAnimationFrame(() => requestAnimationFrame(startBackgroundAfterForegroundFrame))
        }
      } catch {
        if (!cancelled) {
          setPlaying(false)
          setForegroundPlaying(false)
        }
      }
    }

    startPlayback()

    return () => {
      cancelled = true
    }
  }, [bgType, playing, syncBackgroundVideoToMain])

  useEffect(() => {
    if (bgType !== 'blur') return
    const main = videoRef.current
    const bg = bgVideoRef.current
    if (!main || !bg) return

    const sync = () => {
      syncBackgroundVideoToMain()
    }

    const hideBackgroundUntilForegroundContinues = () => {
      setForegroundPlaying(false)
      bg.pause()
      syncBackgroundVideoToMain(true)
    }

    const showBackgroundAfterForegroundContinues = () => {
      setForegroundPlaying(true)
      syncBackgroundVideoToMain(true)
      if (playing) bg.play().catch(() => { })
    }

    main.addEventListener('timeupdate', sync)
    main.addEventListener('seeked', sync)
    main.addEventListener('seeking', hideBackgroundUntilForegroundContinues)
    main.addEventListener('waiting', hideBackgroundUntilForegroundContinues)
    main.addEventListener('playing', showBackgroundAfterForegroundContinues)

    return () => {
      main.removeEventListener('timeupdate', sync)
      main.removeEventListener('seeked', sync)
      main.removeEventListener('seeking', hideBackgroundUntilForegroundContinues)
      main.removeEventListener('waiting', hideBackgroundUntilForegroundContinues)
      main.removeEventListener('playing', showBackgroundAfterForegroundContinues)
    }
  }, [bgType, playing, syncBackgroundVideoToMain])


  // ── MOUSE MOUSE-DOWN DRAG HANDLERS (THE SNAP ENGINE) ──
  // - SNAP_THRESHOLD: Snapping range in pixels.
  // - Center Snap: If center of coordinates aligns close to page center (within 8px), pulls it to perfect alignment and flashes a blue guideline.
  const SNAP_THRESHOLD = 8

  // Shared pointer-drag binder. Pointer Events unify mouse, touch, and pen in one
  // API (PointerEvent has the same clientX/clientY as MouseEvent), so this single
  // helper is what makes every draggable element in the editor work with a finger
  // on mobile, not just a mouse cursor on desktop. Pointer capture keeps tracking
  // the same finger/cursor even if it moves fast or briefly leaves the element.
  const bindPointerDrag = useCallback((e, onMove, onUp) => {
    const pointerId = e.pointerId
    const target = e.currentTarget
    try { target.setPointerCapture?.(pointerId) } catch { /* unsupported */ }

    const move = (mv) => {
      if (mv.pointerId !== pointerId) return
      onMove(mv)
    }
    const up = (mv) => {
      if (mv.pointerId !== pointerId) return
      try { target.releasePointerCapture?.(pointerId) } catch { /* unsupported */ }
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      onUp()
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
  }, [])

  // Tracks whether a 2-finger pinch is currently controlling the video box, so a
  // lingering single-finger drag from the first touch becomes a no-op while the
  // pinch (started by the 2nd finger) takes over.
  const pinchActiveRef = useRef(false)
  const pinchStateRef = useRef(null)

  const startVideoDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setTab('canvas')
    const startX = e.clientX
    const startY = e.clientY
    const initL = vl
    const initT = vt

    bindPointerDrag(e, (mv) => {
      if (pinchActiveRef.current) return
      const dx = (mv.clientX - startX) / stageScale
      const dy = (mv.clientY - startY) / stageScale
      let nx = initL + dx
      let ny = initT + dy

      const rawCx = nx + vw / 2
      const rawCy = ny + vh / 2
      const snapV = Math.abs(rawCx - STAGE_W / 2) < SNAP_THRESHOLD
      const snapH = Math.abs(rawCy - STAGE_H / 2) < SNAP_THRESHOLD

      if (snapV) nx = STAGE_W / 2 - vw / 2
      if (snapH) ny = STAGE_H / 2 - vh / 2

      setVideoDragPos({ x: nx, y: ny })
      setSnapLines({ v: snapV, h: snapH })
    }, () => {
      setSnapLines({ h: false, v: false })
    })
  }, [vl, vt, vw, vh, stageScale, bindPointerDrag])

  // 2-finger pinch-to-zoom on the video box. Kept as native touch events (rather
  // than Pointer Events) because detecting "exactly 2 fingers" is directly given
  // by `e.touches.length`, whereas Pointer Events report one pointer per event and
  // would need extra bookkeeping to arrive at the same information.
  const handleVideoTouchStart = useCallback((e) => {
    if (e.touches.length !== 2) return
    e.preventDefault()
    pinchActiveRef.current = true
    setVideoDragPos(null) // hand position control over to vtx for the rest of the gesture
    const [t1, t2] = e.touches
    pinchStateRef.current = {
      startDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
      baseScale: vtx.scale,
      baseVl: vl,
      baseVt: vt,
      baseVw: vw,
      baseVh: vh,
    }
  }, [vtx.scale, vl, vt, vw, vh])

  const handleVideoTouchMove = useCallback((e) => {
    if (!pinchActiveRef.current || e.touches.length < 2) return
    e.preventDefault()
    const state = pinchStateRef.current
    if (!state || !state.startDist) return
    const [t1, t2] = e.touches
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    const ratio = dist / state.startDist
    // Uniform zoom only — never independent per axis, so the video can never
    // look stretched/squeezed while pinching.
    const scale = clamp(state.baseScale * ratio, 0.5, 2.6)
    // Zoom around the box's own center (simple, predictable — matches how pinch
    // zoom behaves in most photo/video editors).
    const centerX = state.baseVl + state.baseVw / 2
    const centerY = state.baseVt + state.baseVh / 2
    const newVw = pb.w * scale
    const newVh = pb.h * scale
    setVtx(prev => ({
      ...prev,
      scale,
      ox: (centerX - newVw / 2) - pb.l,
      oy: (centerY - newVh / 2) - pb.t,
    }))
  }, [pb.w, pb.h, pb.l, pb.t])

  const handleVideoTouchEnd = useCallback((e) => {
    if (e.touches.length < 2) {
      pinchActiveRef.current = false
      pinchStateRef.current = null
    }
  }, [])

  // Corner/edge crop-resize handles. dirX in {null,'e','w'} and dirY in
  // {null,'n','s'} pick which edge(s) this handle moves — e.g. the top-right
  // corner handle passes dirX='e', dirY='n'; the bottom-mid edge handle passes
  // dirX=null, dirY='s'. This is a REAL crop: it only ever changes cropInsets
  // (the mask), never vtx.scale/ox/oy — the video itself never resizes, so it
  // can never look stretched or squeezed. Dragging a handle just reveals or
  // hides more of the video that's already there, exactly like a normal crop
  // tool (Photos/Instagram-style), independently per corner and per side.
  const startCropResize = useCallback((dirX, dirY, e) => {
    e.preventDefault()
    e.stopPropagation()
    setTab('canvas')
    const startX = e.clientX
    const startY = e.clientY
    const baseInsetL = insetL
    const baseInsetT = insetT
    const baseInsetR = insetR
    const baseInsetB = insetB

    bindPointerDrag(e, (mv) => {
      const dx = (mv.clientX - startX) / stageScale
      const dy = (mv.clientY - startY) / stageScale

      let newInsetL = baseInsetL
      let newInsetR = baseInsetR
      if (dirX === 'w') newInsetL = clamp(baseInsetL + dx, 0, Math.max(0, videoWidth - MIN_FRAME_SIZE - baseInsetR))
      else if (dirX === 'e') newInsetR = clamp(baseInsetR - dx, 0, Math.max(0, videoWidth - MIN_FRAME_SIZE - baseInsetL))

      let newInsetT = baseInsetT
      let newInsetB = baseInsetB
      if (dirY === 'n') newInsetT = clamp(baseInsetT + dy, 0, Math.max(0, videoHeight - MIN_FRAME_SIZE - baseInsetB))
      else if (dirY === 's') newInsetB = clamp(baseInsetB - dy, 0, Math.max(0, videoHeight - MIN_FRAME_SIZE - baseInsetT))

      setVtx(prev => ({
        ...prev,
        cropInsets: { l: newInsetL, t: newInsetT, r: newInsetR, b: newInsetB },
      }))
    }, () => {})
  }, [insetL, insetT, insetR, insetB, videoWidth, videoHeight, stageScale, bindPointerDrag])

  const startTextDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setTab('overlay')
    const startX = e.clientX
    const startY = e.clientY
    const initX = ttx.x
    const initY = ttx.y

    bindPointerDrag(e, (mv) => {
      const dx = (mv.clientX - startX) / stageScale
      const dy = (mv.clientY - startY) / stageScale
      let nx = initX + dx
      let ny = initY + dy

      const rawCx = nx + ttx.w / 2
      const rawCy = ny + textBlockHeight / 2
      const snapV = Math.abs(rawCx - STAGE_W / 2) < SNAP_THRESHOLD
      const snapH = Math.abs(rawCy - textBlockHeight / 2) < SNAP_THRESHOLD // Snapping guidelines trigger

      if (snapV) nx = STAGE_W / 2 - ttx.w / 2

      setTextDragPos({ x: nx, y: ny })
      setSnapLines({ v: snapV, h: false })
    }, () => {
      setSnapLines({ h: false, v: false })
    })
  }, [ttx.x, ttx.y, ttx.w, textBlockHeight, stageScale, bindPointerDrag])

  const startCaptionDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setTab('subtitles')
    const startX = e.clientX
    const startY = e.clientY
    const initX = captionTransform.x
    const initY = captionTransform.y

    bindPointerDrag(e, (mv) => {
      const dx = (mv.clientX - startX) / stageScale
      const dy = (mv.clientY - startY) / stageScale
      let nx = initX + dx
      let ny = initY + dy

      const rawCx = nx + captionTransform.w / 2
      const rawCy = ny + captionBlockHeight / 2
      const snapV = Math.abs(rawCx - STAGE_W / 2) < SNAP_THRESHOLD

      if (snapV) nx = STAGE_W / 2 - captionTransform.w / 2

      setCaptionDragPos({ x: nx, y: ny })
      setSnapLines({ v: snapV, h: false })
    }, () => {
      setSnapLines({ h: false, v: false })
    })
  }, [captionBlockHeight, captionTransform.w, captionTransform.x, captionTransform.y, stageScale, bindPointerDrag])

  const startLogoDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setTab('logo')
    const startX = e.clientX
    const startY = e.clientY
    const initX = logoLeft
    const initY = logoTop

    bindPointerDrag(e, (mv) => {
      const dx = (mv.clientX - startX) / stageScale
      const dy = (mv.clientY - startY) / stageScale
      let nx = initX + dx
      let ny = initY + dy

      const rawCx = nx + logoSize / 2
      const snapV = Math.abs(rawCx - STAGE_W / 2) < SNAP_THRESHOLD

      if (snapV) nx = STAGE_W / 2 - logoSize / 2

      setLogoX(Math.round(clamp(nx, 0, STAGE_W - logoSize)))
      setLogoY(Math.round(clamp(ny, 0, STAGE_H - logoSize)))
      setSnapLines({ v: snapV, h: false })
    }, () => {
      setSnapLines({ h: false, v: false })
    })
  }, [logoLeft, logoTop, logoSize, stageScale, bindPointerDrag])

  const applyCaptionTemplate = template => {
    setCaptionTemplateId(template.id)
    setCaptionStyle(template.exportStyle)
    setCaptionFontSize(template.fontSize)
    setCaptionPrimaryColor(template.primary)
    setCaptionEmphasisColor(template.emphasis)
    setCaptionSpotlightColor(template.spotlight)
    setCaptionBox(template.box)
    setCaptionUppercase(template.uppercase)
    setEnableCaptions(true)
  }

  const handleSeek = event => {
    if (!duration || !videoRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const pct = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    videoRef.current.currentTime = pct * duration
  }

  // ── FINAL RENDERING EXPORTER TRIGGER ──
  const handleExport = async () => {
    if (!clipUrl || !clip) return
    try {
      setExporting(true)
      const logoImgElement = document.querySelector('img[alt="Brand logo"]')

      // Make sure the bundled overlay font has actually finished loading before
      // burning text into the canvas — otherwise the very first export on a cold
      // page load could silently fall back to a system font.
      if (document.fonts) {
        try { await document.fonts.load(`400 ${renderedFontSize * EXPORT_SCALE}px "SFProDisplayWeb"`) } catch { /* falls back to font stack */ }
      }

      // Packs layout variables and compiles the watermark overlay PNG base64 string
      const overlayImage = makeOverlayImage({
        lines: textHidden ? [] : lines,
        textBox: ttx,
        fontSize: renderedFontSize,
        color: textColor,
        align: textAlign,
        style: textStyle,
        shadow: shouldShadowText,
        logoImg: logoImgElement,
        logoLeft: logoLeft,
        logoTop: logoTop,
        logoSize: logoSize,
      })

      // Full editor state saved onto the clip so reopening restores every edit.
      const editorPayloadData = {
        ratio,
        bgType,
        bgCustomColor,
        blurStrength,
        customText,
        textHidden,
        textAlign,
        textStyle,
        textColor,
        fontSize,
        textWidthPercent,
        textOffsetX,
        textOffsetY,
        vtx,
        videoDragPos,
        textDragPos,
        logo: typeof logo === 'string' ? logo : null,
        logoScale,
        logoX,
        logoY,
        volume,
        enableCaptions,
        captionStyle,
        captionText,
        captionTemplateId,
        captionFont,
        captionFontSize,
        captionPrimaryColor,
        captionEmphasisColor,
        captionSpotlightColor,
        captionBox,
        captionUppercase,
        captionOffsetX,
        captionOffsetY,
        captionDragPos,
      }

      // Sends completed details to Python server `/export/preview`
      const response = await api.post(
        '/export/preview',
        {
          clip_id: getClipIdValue(clip),
          ratio: ratio === EXACT_CROP_RATIO ? 'original' : ratio,
          bg_type: bgType,
          bg_custom_color: bgCustomColor,
          blur_strength: blurStrength,
          custom_text: cleanOverlayText(customText),
          text_hidden: textHidden,
          text_align: textAlign,
          text_style: textStyle,
          text_color: textColor,
          font_size: renderedFontSize,
          volume,
          // x/y/w/h = the visible CROPPED frame (what actually shows on the canvas).
          // mediaW/mediaH/insetL/insetT describe the full-size (uncropped, zoomed)
          // video box and where the frame sits inside it, so the backend can
          // replicate the crop with a second, non-rescaling crop step — never
          // stretching the video to fit the frame's shape.
          video_transform: {
            ...vtx,
            x: frameL,
            y: frameT,
            w: frameW,
            h: frameH,
            mediaW: videoWidth,
            mediaH: videoHeight,
            insetL,
            insetT,
          },
          text_transform: ttx,
          overlay_image: overlayImage,
          enable_captions: enableCaptions,
          caption_style: captionStyle,
          caption_transform: captionTransform,
          caption_settings: {
            template: 'simple',
            timing_mode: captionStyle === '2_word' ? 'two_word' : 'word',
            font: captionFont,
            font_size: captionFontSize,
            primary_color: captionPrimaryColor,
            emphasis_color: captionEmphasisColor,
            spotlight_color: captionSpotlightColor,
            box: captionBox,
            uppercase: captionUppercase,
          },
          editor_payload: editorPayloadData,
        },
      )

      // Keep localStorage in sync so reopening the clip in the same session (before
      // Projects refetches) also shows the saved edits.
      try {
        const thisClipId = getClipIdValue(clip)
        // Per-clip cache: survives Projects refetch + reopen even without the backend.
        saveCachedEdits(thisClipId, editorPayloadData)
        const storedClip = JSON.parse(localStorage.getItem('editClip') || 'null')
        if (storedClip && getClipIdValue(storedClip) === thisClipId) {
          localStorage.setItem('editClip', JSON.stringify({ ...storedClip, editor_payload: editorPayloadData }))
        }
        const storedList = JSON.parse(localStorage.getItem('editClipList') || '[]')
        if (Array.isArray(storedList)) {
          const nextList = storedList.map(item =>
            getClipIdValue(item) === thisClipId ? { ...item, editor_payload: editorPayloadData } : item,
          )
          localStorage.setItem('editClipList', JSON.stringify(nextList))
        }
      } catch {}

      // Successfully rendered! Navigates to ExportPage view
      const exportedUrl = resolveUrl(response.data.url)
      const downloadName = response.data.filename || `clip-export.mp4`
      const clipNumber = clipIndex >= 0 ? clipIndex + 1 : 1

      navigate('/export', {
        state: {
          previewUrl: exportedUrl,
          downloadUrl: exportedUrl,
          downloadName,
          caption: captionText || clip?.clip_caption || '',
          title: clip?.hook || `Clip ${clipNumber}`,
          source: 'editor',
        },
      })
    } catch (error) {
      window.alert(error?.message || 'Could not export this clip.')
    } finally {
      setExporting(false)
    }
  }

  // Safety fallback if no clip was specified in routing parameters
  if (!clip) {
    return (
      <div className="page page-compact">
        <section className="glass-thin section-pad stack" style={{ alignItems: 'center', textAlign: 'center', padding: 32 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 42, color: 'var(--text-muted)' }}>
            movie_off
          </span>
          <h1 style={{ margin: 0, fontSize: 19 }}>No clip selected</h1>
          <p style={{ margin: 0, color: 'var(--text-soft)' }}>Open a clip from Projects or Studio first.</p>
          <button className="btn btn-solid-white" onClick={() => navigate('/projects')}>
            Go to Projects
          </button>
        </section>
      </div>
    )
  }

  const wideControls = tab === 'overlay' || tab === 'subtitles' || tab === 'canvas'
  const controlPaneClass = `editor-control-pane${wideControls ? ' editor-control-pane-wide' : ''} editor-mobile-sheet-${mobileSheet}${panelOpen ? ' sheet-open' : ''}`
  const activeTool = TABS.find(item => item.id === tab)

  return (
    <div className="editor-page mobile-page mobile-editor-page">

      {/* ── SECTION A: TOP BAR — close · quality · export ── */}
      <header className="editor-topbar-v2">
        <button type="button" className="editor-top-close" onClick={goBack} aria-label="Close editor">
          <span className="material-symbols-outlined">close</span>
        </button>
        <div className="editor-top-right">
          <span className="editor-quality-pill">HD</span>
          <button
            type="button"
            className="editor-top-export"
            disabled={exporting || !clipUrl}
            onClick={handleExport}
          >
            {exporting ? (
              <span className="material-symbols-outlined anim-spin" style={{ fontSize: 16 }}>progress_activity</span>
            ) : null}
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>

      {/* ── SECTION B: EDIT LAYOUT ── */}
      <div className="editor-layout">

        {/* LEFT COLUMN: The live visual mockup canvas stage player */}
        <section ref={previewPaneRef} className="editor-preview-pane" style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
          <div className="glass-strong editor-preview-shell" style={{ width: previewPanelWidth, maxWidth: '100%', position: 'relative' }}>
            <div className="editor-stage-shell" style={{ width: stageWidth }}>
              <div className="editor-stage-wrap" style={{ width: stageWidth, height: stageHeight }}>
                <div className="editor-stage-frame" style={{ width: stageWidth, height: stageHeight }}>

                  {/* THE ABSOLUTE STAGE VIEWER CANVAS: Styled in HSL/iOS variables (.app-water bubbles, margins, colors) */}
                  <div
                    ref={stageRef}
                    onMouseDown={() => setTab('background')}
                    style={{
                      position: 'relative',
                      width: STAGE_W,
                      height: STAGE_H,
                      transform: `scale(${stageScale})`,
                      transformOrigin: 'top left',
                      background: stageBg,
                      borderRadius: 24,
                      border: '1px solid rgba(255, 255, 255, 0.09)',
                      boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.03)',
                      overflow: 'hidden',
                    }}
                  >

                    {/* CENTER SNAPPING GRAPHICAL LINES (appears when element centers snap within 8px) */}
                    {snapLines.v && (
                      <div style={{
                        position: 'absolute', left: STAGE_W / 2, top: 0, width: 1, height: '100%',
                        background: 'rgba(99,202,255,0.85)', zIndex: 100, pointerEvents: 'none',
                        borderLeft: '1.5px dashed rgba(99,202,255,0.9)',
                      }} />
                    )}
                    {snapLines.h && (
                      <div style={{
                        position: 'absolute', top: STAGE_H / 2, left: 0, height: 1, width: '100%',
                        background: 'rgba(99,202,255,0.85)', zIndex: 100, pointerEvents: 'none',
                        borderTop: '1.5px dashed rgba(99,202,255,0.9)',
                      }} />
                    )}

                    {/* BLURRED BACKGROUND VIDEO PREVIEWER */}
                    {bgType === 'blur' && videoReady ? (
                      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: (!playing || foregroundPlaying) ? 1 : 0, zIndex: 0 }}>
                        <video
                          ref={bgVideoRef}
                          src={clipUrl}
                          muted
                          playsInline
                          loop
                          preload="auto"
                          crossOrigin="anonymous"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            transform: 'scale(1.18)',
                            filter: `blur(${Math.round((blurStrength / 100) * 26)}px) brightness(0.84)`,
                            pointerEvents: 'none',
                          }}
                        />
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(8, 13, 20, 0.22)' }} />
                      </div>
                    ) : null}

                    {/* CROP FRAME (the mask) — sized/positioned by the 8 handles below.
                        Pointer Events give mouse + single-finger touch drag-to-move; the
                        touch handlers add 2-finger pinch-to-zoom. touchAction:'none' stops
                        the browser's own scroll/zoom gestures from stealing the touch. */}
                    <div
                      onPointerDown={e => startVideoDrag(e)}
                      onTouchStart={handleVideoTouchStart}
                      onTouchMove={handleVideoTouchMove}
                      onTouchEnd={handleVideoTouchEnd}
                      onTouchCancel={handleVideoTouchEnd}
                      style={{
                        position: 'absolute',
                        left: frameL,
                        top: frameT,
                        width: frameW,
                        height: frameH,
                        overflow: 'hidden',
                        borderRadius: 0,
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        background: '#05070c',
                        boxShadow: '0 20px 44px rgba(0, 0, 0, 0.34)',
                        cursor: 'grab',
                        opacity: 1,
                        zIndex: 10,
                        touchAction: 'none',
                      }}
                    >
                      {/* MEDIA — the video's own box. Its size/zoom is driven ONLY by
                          vtx.scale (uniform), never by the crop insets, so it can never
                          look stretched/squeezed. The crop frame's overflow:hidden simply
                          masks whatever part of this box falls outside the frame. */}
                      <div
                        style={{
                          position: 'absolute',
                          left: videoLeft - frameL,
                          top: videoTop - frameT,
                          width: videoWidth,
                          height: videoHeight,
                        }}
                      >
                        <video
                          ref={videoRef}
                          src={clipUrl}
                          playsInline
                          loop
                          preload="auto"
                          crossOrigin="anonymous"
                          onLoadedData={revealVideoAfterFramePaint}
                          onCanPlay={revealVideoAfterFramePaint}
                          onLoadedMetadata={event => {
                            setDuration(event.target.duration || 0)
                            setCurrentTime(0)
                          }}
                          onTimeUpdate={event => setCurrentTime(event.target.currentTime)}
                          onPlaying={() => setForegroundPlaying(true)}
                          onWaiting={() => setForegroundPlaying(false)}
                          onSeeking={() => setForegroundPlaying(false)}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            pointerEvents: 'none',
                            opacity: videoReady ? 1 : 0,
                            display: 'block',
                          }}
                        />
                      </div>
                    </div>

                    {/* CROP HANDLES — 4 corners + 4 edges, each independently draggable
                        (dirX/dirY pick which edge(s) that handle moves). Positioned on the
                        FRAME's corners/edges (not the video's), since the frame is what
                        actually gets cropped. Works with touch the same as mouse (Pointer
                        Events via startCropResize). */}
                    {[
                      { id: 'nw', dirX: 'w', dirY: 'n', x: frameL, y: frameT, cursor: 'nwse-resize' },
                      { id: 'n', dirX: null, dirY: 'n', x: frameL + frameW / 2, y: frameT, cursor: 'ns-resize' },
                      { id: 'ne', dirX: 'e', dirY: 'n', x: frameL + frameW, y: frameT, cursor: 'nesw-resize' },
                      { id: 'e', dirX: 'e', dirY: null, x: frameL + frameW, y: frameT + frameH / 2, cursor: 'ew-resize' },
                      { id: 'se', dirX: 'e', dirY: 's', x: frameL + frameW, y: frameT + frameH, cursor: 'nwse-resize' },
                      { id: 's', dirX: null, dirY: 's', x: frameL + frameW / 2, y: frameT + frameH, cursor: 'ns-resize' },
                      { id: 'sw', dirX: 'w', dirY: 's', x: frameL, y: frameT + frameH, cursor: 'nesw-resize' },
                      { id: 'w', dirX: 'w', dirY: null, x: frameL, y: frameT + frameH / 2, cursor: 'ew-resize' },
                    ].map(handle => (
                      <div
                        key={handle.id}
                        onPointerDown={e => startCropResize(handle.dirX, handle.dirY, e)}
                        style={{
                          position: 'absolute',
                          left: handle.x - 14,
                          top: handle.y - 14,
                          width: 28,
                          height: 28,
                          zIndex: 15,
                          cursor: handle.cursor,
                          touchAction: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <span style={{
                          width: 11,
                          height: 11,
                          borderRadius: 3,
                          background: '#fff',
                          border: '1.5px solid rgba(0, 0, 0, 0.55)',
                          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.4)',
                        }} />
                      </div>
                    ))}

                    {/* DRAGGABLE TITLE OVERLAY TEXT BLOCK */}
                    {!textHidden ? (
                      <div
                        onPointerDown={e => startTextDrag(e)}
                        style={{
                          position: 'absolute',
                          left: ttx.x,
                          top: ttx.y,
                          width: ttx.w,
                          textAlign,
                          zIndex: 20,
                          cursor: 'grab',
                          userSelect: 'none',
                          padding: '4px 0',
                          touchAction: 'none',
                        }}
                      >
                        {lines.map((line, index) => (
                          <div
                            key={`${line}-${index}`}
                            style={{
                              width: '100%',
                              textAlign,
                              marginBottom: index < lines.length - 1 ? lineGap : 0,
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-block',
                                maxWidth: '100%',
                                padding: textStyle === 'box' ? '5px 10px' : 0,
                                borderRadius: textStyle === 'box' ? 6 : 0,
                                background: textStyle === 'box' ? 'rgba(10, 15, 25, 0.76)' : 'transparent',
                                color: textColor,
                                fontFamily: OVERLAY_FONT_STACK,
                                fontWeight: 400,
                                fontSize: renderedFontSize,
                                lineHeight: 1.25,
                                whiteSpace: 'nowrap',
                                textShadow: shouldShadowText ? '0 2px 8px rgba(0, 0, 0, 0.8)' : 'none',
                              }}
                            >
                              {line}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* DRAGGABLE REAL-TIME SUBTITLE BOX */}
                    {enableCaptions && activeCaptionText ? (
                      <div
                        className="caption-live-preview"
                        onPointerDown={startCaptionDrag}
                        style={{
                          left: captionTransform.x,
                          top: captionTransform.y,
                          width: captionTransform.w,
                          minHeight: captionBlockHeight,
                          touchAction: 'none',
                          '--caption-primary': captionPrimaryColor,
                          '--caption-emphasis': captionPrimaryColor,
                          '--caption-spotlight': captionPrimaryColor,
                          '--caption-size': `${captionFontSize}px`,
                          '--caption-font': captionFont,
                        }}
                      >
                        <span className="caption-sample-main">
                          {activeCaptionText}
                        </span>
                      </div>
                    ) : null}

                    {/* DRAGGABLE WATERMARK LOGO */}
                    {logo ? (
                      <img
                        src={logo}
                        alt="Brand logo"
                        onPointerDown={startLogoDrag}
                        style={{
                          position: 'absolute',
                          left: logoLeft,
                          top: logoTop,
                          width: logoSize,
                          height: logoSize,
                          objectFit: 'contain',
                          filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.65))',
                          zIndex: 25,
                          cursor: 'grab',
                          userSelect: 'none',
                          touchAction: 'none',
                        }}
                      />
                    ) : null}

                  </div>

                </div>
              </div>
            </div>

            {/* TIMELINE MEDIA CONTROLS BAR */}
            <div className="glass-thin editor-playbar" style={{ width: stageWidth, flexDirection: 'column', gap: 6, padding: '8px 12px' }}>

              {/* Row 1: Play + progress + time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <button type="button" className="btn btn-solid-white btn-sm" style={{ flexShrink: 0 }} onClick={() => setPlaying(prev => !prev)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                    {playing ? 'pause' : 'play_arrow'}
                  </span>
                </button>

                <div className="editor-progress" style={{ flex: 1 }}>
                  <div className="editor-time-row">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <div className="editor-progress-track" onClick={handleSeek}>
                    <div className="editor-progress-fill" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>

              {/* Row 2: Volume */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--text-soft)', flexShrink: 0 }}>
                  {volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
                </span>
                <input
                  type="range"
                  className="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={volume}
                  onChange={event => setVolume(parseFloat(event.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 11, width: 34, textAlign: 'right', flexShrink: 0, fontWeight: volume > 1.0 ? 700 : 500, color: volume > 1.0 ? '#a0d83e' : 'var(--text-soft)' }}>
                  {Math.round(volume * 100)}%
                </span>
              </div>
            </div>


          </div>
        </section>


        {/* RIGHT COLUMN: The editor dashboard panel switches tab forms */}
        <aside className={controlPaneClass}>

          {/* MOBILE SHEET HEADER: title of the open tool + Done to close the sheet. */}
          <div className="editor-sheet-head">
            <span className="editor-sheet-title">
              {activeTool ? <span className="material-symbols-outlined">{activeTool.icon}</span> : null}
              {activeTool?.label || 'Edit'}
            </span>
            <button type="button" className="editor-sheet-done" onClick={() => setPanelOpen(false)}>
              Done
            </button>
          </div>

          {/* DESKTOP TAB HEADER (hidden on mobile — mobile uses the bottom toolbar) */}
          <section className="editor-card editor-desktop-tabs">
            <div className="editor-tab-list">
              {TABS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`editor-tab${tab === item.id ? ' active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  <span className="material-symbols-outlined">{item.icon}</span>
                  <span className="editor-tab-label">{item.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ACTIVE TOOL SETTINGS PANEL CARDS */}
          <section className={`editor-card editor-tool-card${wideControls ? ' editor-card-wide' : ''}`}>

            {/* TAB 1: OVERLAY CUSTOMIZER (text hook headers) */}
            {tab === 'overlay' ? (
              <div className="editor-dual-panel">

                {/* Column A: Text values */}
                <div className="editor-panel-column">
                  <label className="editor-field">
                    <span className="text-label">Overlay text</span>
                    <textarea className="glass-input" rows={2} style={{ minHeight: 52, resize: 'none' }} value={customText} onChange={event => setCustomText(event.target.value)} />
                  </label>

                  {/* Apply the exact overlay text that was on the original input video */}
                  {clip?.original_overlay ? (
                    <button
                      className="btn btn-glass btn-sm"
                      style={{ textAlign: 'left', whiteSpace: 'normal', padding: '8px 12px' }}
                      onClick={() => setCustomText(cleanOverlayText(clip.original_overlay))}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 15, marginRight: 6 }}>restore</span>
                      Use original input text
                    </button>
                  ) : null}

                  {/* AI hook helpers picker — collapsed by default so Alignment/Style/Color/
                      Size (below, or in Column B) are reachable without scrolling past this list. */}
                  {clip?.overlay_texts?.length > 1 && (
                    <div className="editor-field stack">
                      <button
                        type="button"
                        className="btn btn-glass btn-sm"
                        style={{ justifyContent: 'space-between', width: '100%' }}
                        onClick={() => setShowAiHooks(v => !v)}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span>
                          AI Suggested Hooks ({clip.overlay_texts.length})
                        </span>
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          {showAiHooks ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                      {showAiHooks && (
                        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4, paddingBottom: 4 }}>
                          {clip.overlay_texts.map((txt, i) => (
                            <button key={i} className="btn btn-glass btn-sm" style={{ textAlign: 'left', whiteSpace: 'normal', padding: '8px 12px' }} onClick={() => setCustomText(cleanOverlayText(txt))}>
                              "{txt}"
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="row-wrap" style={{ marginTop: 8 }}>
                    <label className="row" style={{ gap: 6 }}>
                      <input type="checkbox" checked={textHidden} onChange={event => setTextHidden(event.target.checked)} />
                      <span className="text-label">Hide overlay text</span>
                    </label>
                  </div>
                </div>

                {/* Column B: Design values (align, styles, colors, size, offsets sliders) */}
                <div className="editor-panel-column">
                  <h4 style={{ margin: 0, fontSize: 14 }}>Overlay Styling</h4>

                  <div className="editor-field">
                    <span className="text-label">Alignment</span>
                    <div className="row-wrap">
                      <AlignButton active={textAlign === 'left'} icon="format_align_left" onClick={() => setTextAlign('left')} />
                      <AlignButton active={textAlign === 'center'} icon="format_align_center" onClick={() => setTextAlign('center')} />
                      <AlignButton active={textAlign === 'right'} icon="format_align_right" onClick={() => setTextAlign('right')} />
                    </div>
                  </div>

                  <div className="editor-inline-field">
                    <label className="editor-field">
                      <span className="text-label">Style</span>
                      <select className="glass-input" value={textStyle} onChange={event => setTextStyle(event.target.value)}>
                        <option value="plain">Plain</option>
                        <option value="box">Box</option>
                      </select>
                    </label>

                    <label className="editor-field">
                      <span className="text-label">Color</span>
                      <ColorSwatchRow value={textColor} onChange={setTextColor} />
                    </label>
                  </div>

                  <label className="editor-field">
                    <span className="text-label">Size</span>
                    <input type="range" className="range" min="14" max="64" value={fontSize} onChange={event => setFontSize(parseInt(event.target.value, 10))} />
                    <span className="editor-value">{fontSize}px</span>
                  </label>

                  <label className="editor-field">
                    <span className="text-label">Text width</span>
                    <input type="range" className="range" min="55" max="96" value={textWidthPercent} onChange={event => setTextWidthPercent(parseInt(event.target.value, 10))} />
                    <span className="editor-value">{textWidthPercent}%</span>
                  </label>

                  <label className="editor-field">
                    <span className="text-label">Horizontal offset</span>
                    <input type="range" className="range" min="-120" max="120" value={textOffsetX} onChange={event => setTextOffsetX(parseInt(event.target.value, 10))} />
                  </label>

                  <label className="editor-field">
                    <span className="text-label">Vertical offset</span>
                    <input type="range" className="range" min="-180" max="260" value={textOffsetY} onChange={event => setTextOffsetY(parseInt(event.target.value, 10))} />
                  </label>
                </div>

              </div>
            ) : null}

            {/* TAB 2: SUBTITLES CUSTOMIZER */}
            {tab === 'subtitles' ? (
              <div className="editor-form">

                {/* Column A: Activators & preview */}
                <div className="editor-panel-column">
                  <label className="row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={enableCaptions} onChange={event => setEnableCaptions(event.target.checked)} />
                    <span className="text-label">Enable subtitles</span>
                  </label>

                  <div className="caption-simple-preview">
                    <span
                      style={{
                        color: captionPrimaryColor,
                        fontFamily: `${captionFont}, Arial, sans-serif`,
                        fontSize: captionFontSize,
                      }}
                    >
                      {activeCaptionText || 'Caption preview'}
                    </span>
                  </div>
                </div>

                {/* Column B: Styles modifiers (font style, speed timing, sizes, offsets sliders) */}
                <div className="editor-panel-column">
                  <div className="caption-style-panel">
                    <div className="caption-realtime-status">
                      {captionLoading ? 'Loading real word timings...' : liveCaptionWords.length ? 'Using real speaker word timings.' : 'No synced vocal timings found yet.'}
                    </div>

                    <label className="editor-field">
                      <span className="text-label">Font</span>
                      <select className="glass-input" value={captionFont} onChange={event => setCaptionFont(event.target.value)} style={{ color: 'var(--text)' }}>
                        {CAPTION_FONTS.map(font => (
                          <option key={font.value} style={{ color: 'black' }} value={font.value}>{font.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="editor-field">
                      <span className="text-label">Export timing</span>
                      <select className="glass-input" value={captionStyle} onChange={event => setCaptionStyle(event.target.value)} style={{ color: 'var(--text)' }}>
                        <option style={{ color: 'black' }} value="1_word">Word by word</option>
                        <option style={{ color: 'black' }} value="2_word">2 words</option>
                      </select>
                    </label>

                    <label className="editor-field">
                      <span className="text-label">Text color</span>
                      <ColorSwatchRow value={captionPrimaryColor} onChange={setCaptionPrimaryColor} />
                    </label>

                    <label className="editor-field">
                      <span className="text-label">Font size</span>
                      <input type="range" className="range" min="12" max="56" value={captionFontSize} onChange={event => setCaptionFontSize(parseInt(event.target.value, 10))} />
                      <span className="editor-value">{captionFontSize}px</span>
                    </label>

                    <label className="editor-field">
                      <span className="text-label">Horizontal offset</span>
                      <input type="range" className="range" min="-140" max="140" value={captionOffsetX} onChange={event => setCaptionOffsetX(parseInt(event.target.value, 10))} />
                    </label>

                    <label className="editor-field">
                      <span className="text-label">Vertical offset</span>
                      <input type="range" className="range" min="-220" max="220" value={captionOffsetY} onChange={event => setCaptionOffsetY(parseInt(event.target.value, 10))} />
                    </label>

                    <button type="button" className="btn btn-accent" onClick={() => setEnableCaptions(false)}>
                      Turn off subtitles
                    </button>
                  </div>
                </div>

              </div>
            ) : null}

            {/* TAB 3: RATIO & CROP CONTROLLER */}
            {tab === 'canvas' ? (
              <div className="editor-dual-panel">

                {/* Column A: presets selection */}
                <div className="editor-panel-column">
                  <div className="editor-field">
                    <span className="text-label">Video crop ratio</span>
                    <div className="row-wrap">
                      {ratioOptions.map(item => (
                        <button key={item.label} type="button" className={`btn btn-sm ${ratio === item.label ? 'btn-solid-white' : 'btn-glass'}`} onClick={() => setRatio(item.label)}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="subtle" style={{ fontSize: 12 }}>
                    Ratio controls resize the video frame. Background colors are in the Background tab.
                  </div>
                </div>

                {/* Column B: Manual transformation scales sliders */}
                <div className="editor-panel-column">
                  <label className="editor-field">
                    <span className="text-label">Video scale</span>
                    <input
                      type="range" className="range" min="0.5" max="2.6" step="0.01"
                      value={vtx.scale}
                      onChange={event => setVtx(prev => ({ ...prev, scale: parseFloat(event.target.value) }))}
                    />
                    <span className="editor-value">{Math.round(vtx.scale * 100)}%</span>
                  </label>

                  <label className="editor-field">
                    <span className="text-label">Video horizontal offset</span>
                    <input type="range" className="range" min="-180" max="180" value={vtx.ox} onChange={event => setVtx(prev => ({ ...prev, ox: parseInt(event.target.value, 10) }))} />
                  </label>

                  <label className="editor-field">
                    <span className="text-label">Video vertical offset</span>
                    <input type="range" className="range" min="-220" max="220" value={vtx.oy} onChange={event => setVtx(prev => ({ ...prev, oy: parseInt(event.target.value, 10) }))} />
                  </label>

                  <button type="button" className="btn btn-glass btn-sm" onClick={() => setVtx({ ox: 0, oy: 0, scale: 1 })}>
                    Reset video transform
                  </button>

                  {(insetL > 0 || insetT > 0 || insetR > 0 || insetB > 0) && (
                    <button
                      type="button"
                      className="btn btn-glass btn-sm"
                      onClick={() => setVtx(prev => ({ ...prev, cropInsets: { l: 0, t: 0, r: 0, b: 0 } }))}
                    >
                      Reset crop
                    </button>
                  )}
                </div>

              </div>
            ) : null}

            {/* TAB 4: CANVAS STAGING BACKGROUND OPTIONS */}
            {tab === 'background' ? (
              <div className="editor-form">

                {/* Background style buttons */}
                <div className="editor-field">
                  <span className="text-label">Background mode</span>
                  <div className="row-wrap">
                    {BG_OPTIONS.map(item => (
                      <button key={item.id} type="button" className={`btn btn-sm ${bgType === item.id ? 'btn-solid-white' : 'btn-glass'}`} onClick={() => setBgType(item.id)}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preset background swatches grid selector */}
                <div className="editor-field">
                  <span className="text-label">Background colors</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {BACKGROUND_COLORS.map(color => {
                      const active = bgType === 'custom' && bgCustomColor.toLowerCase() === color.value
                      return (
                        <button
                          key={color.value}
                          type="button"
                          title={color.label}
                          onClick={() => { setBgType('custom'); setBgCustomColor(color.value) }}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: color.value,
                            border: active ? '2.5px solid #fff' : '2px solid rgba(255,255,255,0.15)',
                            boxShadow: active ? '0 0 0 2px rgba(255,255,255,0.5)' : 'none',
                            cursor: 'pointer',
                            padding: 0,
                            flexShrink: 0,
                            transition: 'transform 0.15s, box-shadow 0.15s',
                          }}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* Custom Color color-input */}
                {bgType === 'custom' ? (
                  <label className="editor-field">
                    <span className="text-label">Custom background color</span>
                    <ColorSwatchRow value={bgCustomColor} onChange={setBgCustomColor} />
                  </label>
                ) : null}

                {/* Gaussian Blur Strength slider */}
                {bgType === 'blur' ? (
                  <label className="editor-field">
                    <span className="text-label">Blur strength</span>
                    <input type="range" className="range" min="0" max="100" value={blurStrength} onChange={event => setBlurStrength(parseInt(event.target.value, 10))} />
                    <span className="editor-value">{blurStrength}%</span>
                  </label>
                ) : null}

              </div>
            ) : null}

            {/* TAB 5: IG CAPTION */}
            {tab === 'igcaption' ? (
              <div className="editor-form">
                <div className="row-wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-label">Instagram Caption</span>
                  <button
                    type="button"
                    className="btn btn-glass btn-sm"
                    style={{ gap: 4 }}
                    onClick={() => {
                      if (!captionText) return
                      navigator.clipboard.writeText(captionText).then(() => {
                        setCaptionCopied(true)
                        setTimeout(() => setCaptionCopied(false), 2000)
                      })
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      {captionCopied ? 'check' : 'content_copy'}
                    </span>
                    {captionCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <textarea
                  className="glass-input editor-caption"
                  value={captionText || 'Caption will appear here after processing.'}
                  onChange={e => setCaptionText(e.target.value)}
                  rows={10}
                  style={{ resize: 'vertical', minHeight: 180, lineHeight: 1.6, fontSize: 13 }}
                />
              </div>
            ) : null}

            {/* TAB 6: BRANDING LOGO UPLOADER */}
            {tab === 'logo' ? (
              <div className="editor-form">

                {/* Logo file selection click */}
                <button type="button" className="btn btn-glass" onClick={() => logoInputRef.current?.click()}>
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>upload</span>
                  {logo ? 'Replace logo' : 'Upload logo'}
                </button>

                {/* Hidden input accepts image file formats */}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={event => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    const objectUrl = URL.createObjectURL(file)
                    setLogo(objectUrl)
                    setLogoScale(1)
                  }}
                />

                {/* Active logo layout details */}
                {logo ? (
                  <>
                    <div className="row" style={{ gap: 10 }}>
                      <img src={logo} alt="Uploaded logo" style={{ width: 56, height: 56, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 6, background: '#fff' }} />
                      <span className="subtle" style={{ fontSize: 12 }}>
                        Keep logos simple for readability in short-form feeds.
                      </span>
                    </div>

                    {/* Logo Size slider */}
                    <label className="editor-field">
                      <span className="text-label">Logo size</span>
                      <input type="range" className="range" min="0.3" max="4" step="0.05" value={logoScale} onChange={event => setLogoScale(parseFloat(event.target.value))} />
                      <span className="editor-value">{Math.round(logoScale * 100)}%</span>
                    </label>

                    {/* Logo coordinate x slider */}
                    <label className="editor-field">
                      <span className="text-label">Logo horizontal position</span>
                      <input type="range" className="range" min="0" max={STAGE_W - logoSize} value={logoLeft} onChange={event => setLogoX(parseInt(event.target.value, 10))} />
                    </label>

                    {/* Logo coordinate y slider */}
                    <label className="editor-field">
                      <span className="text-label">Logo vertical position</span>
                      <input type="range" className="range" min="0" max={STAGE_H - logoSize} value={logoTop} onChange={event => setLogoY(parseInt(event.target.value, 10))} />
                    </label>

                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setLogo(null)
                        setLogoScale(1)
                      }}
                    >
                      Remove logo
                    </button>
                  </>
                ) : (
                  <div className="subtle" style={{ fontSize: 12 }}>
                    No logo uploaded.
                  </div>
                )}
              </div>
            ) : null}

          </section>


        </aside>

        {/* Tap-away backdrop shown behind the open tool sheet (mobile). */}
        {panelOpen ? <div className="editor-sheet-backdrop" onClick={() => setPanelOpen(false)} /> : null}

        {/* MOBILE BOTTOM TOOLBAR — tap a tool to slide up its panel (reference style). */}
        <nav className="editor-toolbar">
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`editor-toolbar-btn${panelOpen && tab === item.id ? ' active' : ''}`}
              onClick={() => openTool(item.id)}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="editor-toolbar-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

    </div>
  )
}
