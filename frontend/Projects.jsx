// â”€â”€ PROJECTS MANAGER BOARD: Projects.jsx â”€â”€
// - Purpose: This is your projects folder library dashboard page.
// - Features: 
//   1. Displays completed and active background processing clips side-by-side using Bento Grids.
//   2. Calculates math scaling between small preview displays (720px high) and high-res MP4 video output (1920px high).
//   3. Builds transparent title hook PNG overlay images on-the-fly inside the browser using HTML5 Canvas.
//   4. Supports multi-selection checkboxes for batch bulk-deletion.
// - Editing Tip: If you want to customize titles, warning descriptions in the delete dialog, or search box placeholders, look at the returned JSX layout at the bottom of this file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, API_BASE, resolveUrl } from './api/client'

// â”€â”€ PREVIEW CANVAS CONSTANTS (COORDINATES SYSTEM) â”€â”€
// - Purpose: Defines strict size boundaries for the mobile simulator mockups on this page.
const STAGE_W = 405             // Width of the mobile preview simulator stage
const STAGE_H = 720             // Height of the mobile preview simulator stage
const EXPORT_H = 1920           // Standard high-def vertical video height
const EXPORT_SCALE = EXPORT_H / STAGE_H // Scaler multiplier (~2.66x) to upscale coordinates for FFmpeg exports
const DEFAULT_CROP_RATIO = 'original'
// ── These constants MUST match frontend/editor.jsx so the card preview and the
//    editor preview lay out overlay text identically. ──
const PREVIEW_VERTICAL_SHIFT = 39     // Vertical adjustment pixels to position the video inside the frame
const EXACT_CROP_VERTICAL_SHIFT = 34  // Vertical shift used for the "Exact" (original) ratio
const VIDEO_SIDE_MARGIN_RATIO = 0.07  // Left/right margin the video box keeps inside the stage (must match editor.jsx)
const TEXT_VIDEO_GAP = 14             // Distance in pixels between the text overlay box and the video card
const OVERLAY_FONT_SIZE = 20          // Editor default font size (renderedFontSize) for overlay text
const OVERLAY_TEXT_WIDTH_PERCENT = 96 // Editor default text width as a % of the video width
const EXACT_CROP_RATIO = 'Exact'      // Sentinel label for the source/original aspect ratio

// Overlay-text font stack — MUST match editor.jsx's OVERLAY_FONT_STACK so the
// card preview and the editor preview render text identically. The bundled
// "SFProDisplayWeb" (see @font-face in index.css) comes first so it looks the
// same on every device, not just Apple hardware.
const OVERLAY_FONT_STACK = '"SFProDisplayWeb", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

// HELPER: Keeps any number strictly locked between a minimum and maximum value
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// HELPER: Picks a readable overlay text color for a given canvas background.
// - White background -> black text; custom color -> black/white by luminance; otherwise white.
function overlayTextColor(bgType, bgColor) {
  if (bgType === 'white') return '#000000'
  if (bgType === 'custom') {
    const hex = String(bgColor || '#000000').replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16) || 0
    const g = parseInt(hex.slice(2, 4), 16) || 0
    const b = parseInt(hex.slice(4, 6), 16) || 0
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.6 ? '#000000' : '#ffffff'
  }
  return '#ffffff'
}

// â”€â”€ UTILITY DATA FORMATTERS â”€â”€

function formatDate(iso) {
  // Purpose: Converts server timestamp dates (e.g. 2026-05-28...) into readable dates (e.g. "May 28, 2026")
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// HELPER: Cleans overlay text exactly like the editor (frontend/editor.jsx cleanOverlayText).
// Strips straight/curly quotes, collapses whitespace, and capitalizes the first letter so the
// card never shows the raw AI hook with leftover quotes/spacing.
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

// HELPER: Pixel-accurate line wrapping — identical logic to the editor's wrapText so the card
// breaks lines at the same place the editor preview does (instead of a naive character count).
function wrapText(value, maxWidth = 260, fontSize = OVERLAY_FONT_SIZE) {
  const text = cleanOverlayText(value)
  const words = text.split(' ').filter(Boolean)
  if (!words.length) return []

  const ctx = getOverlayMeasureContext()
  const safeMaxWidth = Math.max(80, Number(maxWidth) || 260)
  const safeFontSize = clamp(Number(fontSize) || OVERLAY_FONT_SIZE, 14, 64)
  const font = `400 ${safeFontSize}px ${OVERLAY_FONT_STACK}`
  if (ctx) ctx.font = font

  const measure = line => {
    if (ctx) return ctx.measureText(line).width
    return line.length * safeFontSize * 0.52
  }

  const lines = []
  let line = ''
  words.forEach(word => {
    const testLine = line ? `${line} ${word}` : word
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

// ASPECT RATIO SPECIFICATIONS DATABASE (matches editor.jsx RATIOS)
const RATIO_DIMS = {
  '3:2': [3, 2],
  '9:16': [9, 16],
  '2:3': [2, 3],
  '3:4': [3, 4],
  '16:9': [16, 9],
  '1:1': [1, 1],
  '4:5': [4, 5],
  '4:3': [4, 3],
  '21:9': [21, 9],
}

// Normalizes a raw ratio value to an editor-style label ('Exact', '9:16', …) or '' if unknown.
function normalizeRatio(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.toLowerCase() === 'original' || raw.toLowerCase() === 'exact') return EXACT_CROP_RATIO
  return RATIO_DIMS[raw] ? raw : ''
}

// Mirrors editor.jsx inferClipRatio: figures out which aspect ratio a clip was exported with.
function inferClipRatio(clip) {
  const candidates = [
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
  return EXACT_CROP_RATIO
}

// Used by the direct-download call — maps the inferred ratio back to the backend's expectation.
function getClipRatio(clip) {
  const ratio = inferClipRatio(clip)
  return ratio === EXACT_CROP_RATIO ? 'original' : ratio
}

function getExactCropRatio(clip) {
  const width = Number(clip?.canvas_w || clip?.crop_w || clip?.source_w || 0)
  const height = Number(clip?.canvas_h || clip?.crop_h || clip?.source_h || 0)
  if (width > 0 && height > 0) return { w: width, h: height }
  return { w: 3, h: 2 }
}

// Mirrors editor.jsx getPreviewBox: the video box keeps a fixed side margin and is vertically
// centered with a small shift, so the card and the editor place the video identically.
function getPreviewBox(clip) {
  const label = inferClipRatio(clip)
  const sourceRatio = label === EXACT_CROP_RATIO
    ? getExactCropRatio(clip)
    : (() => { const [w, h] = RATIO_DIMS[label] || [9, 16]; return { w, h } })()
  const verticalShift = label === EXACT_CROP_RATIO ? EXACT_CROP_VERTICAL_SHIFT : PREVIEW_VERTICAL_SHIFT
  const w = STAGE_W * (1 - VIDEO_SIDE_MARGIN_RATIO * 2)
  const h = w * (sourceRatio.h / sourceRatio.w)
  return {
    l: STAGE_W * VIDEO_SIDE_MARGIN_RATIO,
    t: (STAGE_H - h) / 2 + verticalShift,
    w,
    h,
  }
}

// Reads per-clip edits cached by the editor (localStorage), so the card reflects
// edits even before the backend persists editor_payload on the clip.
function cachedClipEdits(clip) {
  const id = clip?.clip_id
  if (!id || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(`rc_edits_${id}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function buildRepurposePreview(clip) {
  // Purpose: Packages the overlay layout using the SAME math as the editor's default (un-dragged)
  // view, so the card preview matches editor.jsx exactly: cleaned text, pixel-accurate wrapping,
  // fixed font size, and text anchored just above the video box.
  const edits = clip?.editor_payload || cachedClipEdits(clip) || {}
  const rawText = edits.custom_text
    ?? edits.customText
    ?? clip?.custom_text
    ?? clip?.overlay_texts?.[0]
    ?? clip?.hook
    ?? ''
  const text = cleanOverlayText(rawText)
  const videoBox = getPreviewBox(clip)
  const align = edits.textAlign ?? edits.text_align ?? clip?.text_align ?? 'left'

  const renderedFontSize = clamp(OVERLAY_FONT_SIZE, 14, 64)
  const textWidthRatio = clamp(OVERLAY_TEXT_WIDTH_PERCENT, 55, 96) / 100
  const textW = clamp(videoBox.w * textWidthRatio, 90, Math.max(90, videoBox.w - 8))
  const lines = wrapText(text, textW, renderedFontSize)

  const lineH = renderedFontSize * 1.25
  const lineGap = Math.round(renderedFontSize * 0.18)
  const textH = lines.length
    ? lines.length * lineH + Math.max(0, lines.length - 1) * lineGap
    : lineH

  // Anchor the block per alignment (mirrors editor.jsx): flush with the video's
  // left edge, centered, or flush with the video's right edge. The block width
  // is already capped to the video's width above, so it's never wider than (or
  // positioned outside) the cropped video regardless of alignment.
  const defaultTextX = align === 'left'
    ? videoBox.l
    : align === 'right'
      ? videoBox.l + videoBox.w - textW
      : videoBox.l + videoBox.w / 2 - textW / 2
  const defaultTextY = videoBox.t - TEXT_VIDEO_GAP - textH
  const textBox = {
    x: clamp(defaultTextX, 12, STAGE_W - textW - 12),
    y: clamp(defaultTextY, 12, STAGE_H - textH - 12),
    w: textW,
  }

  return { text, lines, videoBox, textBox, fontSize: renderedFontSize, align }
}

function makeOverlayImage({ lines, textBox, fontSize, textColor = '#ffffff', align = 'left' }) {
  // Purpose: Pure wizardry! Draws text hook overlays onto an invisible HTML5 canvas element inside the browser,
  // converts that canvas to a transparent PNG base64 string, and passes it to the Python server.
  // This ensures the exported video titles match the font spacing, line breaks, and positions you see on screen perfectly.
  if (!lines.length) return ''
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(STAGE_W * EXPORT_SCALE)
  canvas.height = EXPORT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const exportFontSize = fontSize * EXPORT_SCALE
  const exportBox = {
    x: textBox.x * EXPORT_SCALE,
    y: textBox.y * EXPORT_SCALE,
    w: textBox.w * EXPORT_SCALE,
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  // Font styling configuration
  ctx.font = `400 ${exportFontSize}px ${OVERLAY_FONT_STACK}`
  ctx.textBaseline = 'top'
  ctx.textAlign = align
  ctx.fillStyle = textColor

  const lineHeight = exportFontSize * 1.25
  const gap = Math.round(exportFontSize * 0.18)
  const x =
    align === 'left'
      ? exportBox.x
      : align === 'right'
        ? exportBox.x + exportBox.w
        : exportBox.x + exportBox.w / 2
  lines.forEach((line, index) => {
    ctx.fillText(line, x, exportBox.y + index * (lineHeight + gap))
  })

  return canvas.toDataURL('image/png')
}

// â”€â”€ PIPELINE STATE TEXT DICTIONARIES â”€â”€
// - Maps raw backend states to friendly, plain English statuses
const STATUS_LABEL = {
  queued: 'Queued',
  probing: 'Reading videoâ€¦',
  cropping: 'Croppingâ€¦',
  composing: 'Composingâ€¦',
  analyzing: 'Analyzingâ€¦',
  generating_ai: 'AI generating hooksâ€¦',
  rendering: 'Renderingâ€¦',
  finalizing: 'Finalizingâ€¦',
  done: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted',
}

// Color schemes matching background statuses (cyan light blue or pink-red for errors)
const STATUS_COLOR = {
  queued: '#5ce1e6',
  probing: '#5ce1e6',
  cropping: '#5ce1e6',
  composing: '#5ce1e6',
  analyzing: '#5ce1e6',
  generating_ai: '#5ce1e6',
  rendering: '#5ce1e6',
  finalizing: '#ff5a3d',
  done: '#5ce1e6',
  failed: '#ff5a3d',
  interrupted: '#ff5a3d',
}

function isRepurposeProject(project) {
  // Utility checking if project type was generated via Repurpose AI tools (contains '_rep' in database key)
  const projectId = String(project?.project_id || '').toLowerCase()
  const clips = Array.isArray(project?.clips) ? project.clips : []
  return (
    projectId.includes('_rep') ||
    clips.some(clip => {
      const source = String(clip?.analysis_source || clip?.clip_id || clip?.clip_url || '').toLowerCase()
      return source.includes('repurpose') || source.includes('repurposed')
    })
  )
}


// â”€â”€ SUB-COMPONENT 1: DELETE CONFIRMATION DIALOG MODAL â”€â”€
// - Purpose: Overlay card checking if you are sure you want to delete a project folder.
// - Editing Tip: Change text strings inside <h3> and <p> elements below if you want to alter safety warnings.

function DeleteModal({ project, onConfirm, onCancel }) {
  const [deleting, setDeleting] = useState(false)
  if (!project) return null

  const handleCancel = (e) => { if (e) e.stopPropagation(); onCancel() }
  
  // Triggers project deletion request to Python FastAPI server
  const handleDelete = async (e) => {
    if (e) e.stopPropagation()
    setDeleting(true)
    try {
      await api.delete(`/projects/${project.project_id}`)
      onConfirm(project.project_id) // Notify parent dashboard page
    } catch (err) {
      console.error('Delete failed:', err)
      setDeleting(false)
      onCancel()
    }
  }
  const handleBackdropClick = (e) => { if (e.target === e.currentTarget) onCancel() }

  return (
    /* Back drop blurred shading layer (styled via .modal-backdrop inside index.css) */
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      
      {/* Centered dialog container box (styled via .modal-dialog inside index.css) */}
      <div className="modal-dialog">
        
        {/* Red warning trashcan icon */}
        <div className="modal-icon">
          <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#ff5a3d' }}>delete_forever</span>
        </div>
        
        {/* Warning messages */}
        <h3 className="modal-title">Delete "{project.title || 'Untitled Project'}"?</h3>
        <p className="modal-desc">
          This will permanently delete the project, all its clips, and the uploaded video. This action cannot be undone.
        </p>
        
        {/* Cancel vs Delete buttons */}
        <div className="modal-actions">
          <button className="btn btn-glass btn-sm" type="button" onClick={handleCancel} disabled={deleting}>Cancel</button>
          
          <button 
            className="btn btn-sm" 
            type="button" 
            style={{ background: '#ff5a3d', color: '#0b0d10', border: 'none' }} 
            onClick={handleDelete} 
            disabled={deleting}
          >
            {deleting ? (
              <><span className="material-symbols-outlined anim-spin" style={{ fontSize: 16 }}>progress_activity</span> Deletingâ€¦</>
            ) : (
              <><span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span> Delete project</>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}


// â”€â”€ SUB-COMPONENT 2: PROCESSING / RENDERING LOADER METER CARD â”€â”€
// - Purpose: Renders progress status bars inside the Bento grid while a video is smart-cropping or generating hooks.
// - Visuals: Features circular spinning loaders, dynamic status update labels, and sliding gradient loading bars.

function ProcessingCard({ job, onComplete }) {
  const color = STATUS_COLOR[job.status] || '#5ce1e6'
  const label = STATUS_LABEL[job.status] || job.status
  const progress = job.progress ?? 0
  const failed = job.status === 'failed' || job.status === 'interrupted'
  const done = job.status === 'done'
  const fileName = job.file_name || `Job ${job.job_id}`

  // Triggers automatically when rendering completes (Done), closes card after 1.2 seconds.
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => onComplete?.(), 1200)
      return () => clearTimeout(t)
    }
  }, [done, onComplete])

  return (
    <article className="bento-card" style={{
      border: `1px solid ${failed ? 'rgba(255,90,61,0.3)' : 'rgba(92,225,230,0.28)'}`,
      background: failed
        ? 'rgba(255,90,61,0.06)'
        : done
          ? 'rgba(92,225,230,0.07)'
          : 'rgba(92,225,230,0.05)',
      cursor: 'default',
      position: 'relative',
      overflow: 'hidden',
    }}>
      
      {/* SHIMMER EFFECT LAYER: Shifting white light reflection across the cards when active. */}
      {!failed && !done && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent 0%, rgba(92,225,230,0.09) 50%, transparent 100%)',
          animation: 'proj-shimmer 2s ease-in-out infinite',
        }} />
      )}

      <div style={{ padding: '16px 16px 0' }}>
        
        {/* Status titles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          {!failed && !done && (
            <span className="material-symbols-outlined anim-spin" style={{ fontSize: 16, color }}>progress_activity</span>
          )}
          {done && (
            <span className="material-symbols-outlined" style={{ fontSize: 16, color, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          )}
          {failed && (
            <span className="material-symbols-outlined" style={{ fontSize: 16, color, fontVariationSettings: "'FILL' 1" }}>error</span>
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {failed ? 'Processing failed' : done ? 'Clips ready!' : 'Processingâ€¦'}
          </span>
        </div>

        {/* Uploaded Video Filename label */}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6, wordBreak: 'break-all', lineClamp: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {fileName}
        </div>

        {/* Informative status details */}
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 14 }}>
          {failed ? (job.error || 'An error occurred') : label}
        </div>

        {/* DYNAMIC PROGRESS METER BAR */}
        {!failed && (
          <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{
              height: '100%', borderRadius: 4, transition: 'width 0.6s ease',
              background: done
                ? 'linear-gradient(90deg, #5ce1e6, #ff5a3d)'
                : `linear-gradient(90deg, ${color}, #ff5a3d)`,
              width: done ? '100%' : `${Math.max(progress, 8)}%`,
            }} />
          </div>
        )}

        {/* Completion % indicator */}
        {!failed && !done && (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 14 }}>{progress}% complete</div>
        )}
      </div>

    </article>
  )
}


// â”€â”€ SUB-COMPONENT 3: LOADING PLACEHOLDER GHOST CARD â”€â”€
// - Purpose: Renders blurred pulsing structures on initial open, masking grid latency until databases load.
// - Styled by .bento-skeleton in index.css.

function BentoSkeleton() {
  return (
    <article className="bento-card bento-skeleton">
      <div className="bento-thumb bento-thumb-skeleton" />
      <div className="bento-body">
        <div className="sk-line" style={{ width: '68%', height: 14 }} />
        <div className="sk-line" style={{ width: '42%', height: 11, marginTop: 8 }} />
      </div>
    </article>
  )
}


// â”€â”€ SUB-COMPONENT 4: REUSABLE THUMBNAIL CONTAINER WITH VECTOR WAVE FALLBACK â”€â”€
// - Purpose: Renders standard project preview images.
// - Magic: If a thumbnail file is missing or backend offline, renders a highly stylized, moving vector wave animation SVG with glowing lines.

function BentoThumb({ src, title }) {
  const [err, setErr] = useState(false)
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="bento-thumb">
      {!loaded && !err && <div className="bento-thumb-skeleton" />}
      {src && !err ? (
        <img 
          src={src} 
          alt={title} 
          onLoad={() => setLoaded(true)} 
          onError={() => setErr(true)} 
          style={{ opacity: loaded ? 1 : 0, transition: 'opacity 300ms ease' }} 
        />
      ) : (
        /* Dynamic SVG wave backup layout (.bento-wave-fallback in index.css) */
        <div className="bento-wave-fallback" aria-hidden="true">
          <svg viewBox="0 0 240 135" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="wg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#5ce1e6" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#5ce1e6" stopOpacity="0.10" />
              </linearGradient>
            </defs>
            <rect width="240" height="135" fill="#111" />
            <rect width="240" height="135" fill="url(#wg)" />
            {/* Pulsing SVG wave tracks */}
            <path className="wave-path w1" d="M-20 80 Q60 40 140 80 Q220 120 300 80" stroke="rgba(92,225,230,0.22)" strokeWidth="1.5" fill="none" />
            <path className="wave-path w2" d="M-20 95 Q70 60 150 95 Q230 130 310 95" stroke="rgba(255,90,61,0.16)" strokeWidth="1.5" fill="none" />
            <path className="wave-path w3" d="M-20 65 Q50 30 130 65 Q210 100 290 65" stroke="rgba(92,225,230,0.12)" strokeWidth="1" fill="none" />
          </svg>
          <span className="material-symbols-outlined" style={{ position: 'absolute', fontSize: 28, color: 'rgba(255,255,255,0.12)', fontVariationSettings: "'FILL' 1" }}>movie</span>
        </div>
      )}
      <div className="bento-thumb-overlay" />
    </div>
  )
}


// â”€â”€ SUB-COMPONENT 5: STANDARD PROJECT BENTO CARD â”€â”€
// - Purpose: Renders standard Long-to-Short folders inside bento rows.
// - Features: Display clip amount badges, titles, calendars, select checkpoints, and fast delete clicks.

function BentoCard({ project, onOpen, onDelete, selectable = false, selected = false, onSelect }) {
  const clipCount = project.clips?.length || 0
  const firstThumb = project.clips?.[0]?.thumb_url
  const thumbSrc = firstThumb ? resolveUrl(firstThumb) : ''
  const handleOpen = () => {
    if (selectable) {
      onSelect?.(project.project_id)
    } else {
      onOpen()
    }
  }

  return (
    <article className={`bento-card${selectable ? ' project-selectable' : ''}${selected ? ' selected' : ''}`} tabIndex={0} role="button" aria-label={`${selectable ? selected ? 'Deselect' : 'Select' : 'Open'} ${project.title || 'Untitled Project'}`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleOpen() }}>
      
      {/* Checked checklist button (only visible during Select mode) */}
      {selectable ? (
        <button
          className="project-select-check"
          type="button"
          onClick={e => { e.stopPropagation(); onSelect?.(project.project_id) }}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${project.title || 'Untitled Project'}`}
          aria-pressed={selected}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{selected ? 'check_circle' : 'radio_button_unchecked'}</span>
        </button>
      ) : null}

      <div className="bento-card-click" onClick={handleOpen}>
        <BentoThumb src={thumbSrc} title={project.title || 'Project thumbnail'} />
        
        {/* Clips generated count badge bubble */}
        <div className="bento-badge-wrap">
          <span className="bento-clip-badge">
            <span className="bento-status-dot" />
            {clipCount} clip{clipCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Card info footer */}
        <div className="bento-body">
          <div className="bento-body-left">
            <h3 className="bento-title">{project.title || 'Untitled Project'}</h3>
            <p className="bento-meta">
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>calendar_today</span>
              {formatDate(project.created_at)}
            </p>
          </div>
          {/* Arrow forward arrow */}
          <div className="bento-arrow" aria-hidden="true">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
          </div>
        </div>
      </div>

      {/* Hover delete button (only visible when not in multi-selection mode) */}
      {!selectable ? (
        <button className="bento-delete-btn" onClick={e => { e.stopPropagation(); onDelete(project) }} title="Delete project" aria-label={`Delete ${project.title || 'Untitled Project'}`}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
        </button>
      ) : null}

    </article>
  )
}


// Ensures the bundled overlay font (see @font-face in index.css) has actually
// finished loading before the canvas overlay is drawn — main.jsx warms it up
// on app boot, but this catches the case where a card renders before that
// finishes (e.g. slow connection / cold cache).
function useOverlayFontReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.load('400 32px "SFProDisplayWeb"')
        .then(() => { if (!cancelled) setReady(true) })
        .catch(() => { if (!cancelled) setReady(true) })
    } else {
      setReady(true)
    }
    return () => { cancelled = true }
  }, [])
  return ready
}

// â”€â”€ SUB-COMPONENT 6: PREMIUM REPURPOSED AI VIDEO MINI-STAGE CARD â”€â”€
// - Purpose: Renders specialized AI 9:16 layout boxes.
// - Magic: Instead of a flat thumbnail image, it renders an live streaming `<video>` element!
//   - Hovers play: When you move your cursor over this card, it automatically plays the clip muted, giving you an instant dynamic feed review.
//   - HTML5 overlay: Draws the generated AI hook title on top of the live video stream, previewing exactly how the exported mobile post will look.

function RepurposeProjectCard({ project, onEdit, onDelete, selectable = false, selected = false, onSelect }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const clip = project.clips?.[0] || {}
  const clipUrl = clip.clip_url ? resolveUrl(clip.clip_url) : ''
  const title = clip.hook || project.title || 'Repurposed clip'
  const [videoReady, setVideoReady] = useState(false)
  const blurBgRef = useRef(null)
  const bgType = clip.background_type || 'black'
  const bgColor = bgType === 'white' ? '#ffffff' : bgType === 'custom' ? (clip.background_color || '#111827') : '#0a0a0f'

  useEffect(() => {
    setVideoReady(false)
  }, [clipUrl])
  
  // Combines coordinates logic and builds overlay PNG data
  const preview = useMemo(() => buildRepurposePreview(clip), [clip])
  const textColor = overlayTextColor(bgType, bgColor)
  const fontReady = useOverlayFontReady()
  const overlayImage = useMemo(() => makeOverlayImage({
    lines: preview.lines,
    textBox: preview.textBox,
    fontSize: preview.fontSize,
    textColor,
    align: preview.align,
  }), [preview, textColor, fontReady])

  // Triggers immediate download of the clip. Calls FastAPI overlay builder `/export/preview`
  const handleDownload = async () => {
    if (!clip?.clip_id || downloading) return
    setDownloadError('')
    try {
      setDownloading(true)
      const savedRatio = getClipRatio(clip)
      const response = await api.post(
        '/export/preview',
        {
          clip_id: clip.clip_id,
          ratio: savedRatio === 'original' ? DEFAULT_CROP_RATIO : savedRatio,
          bg_type: clip.background_type || 'black',
          bg_custom_color: clip.background_color || '#111827',
          blur_strength: Math.round(Number(clip.blur_opacity ?? 0.5) * 100),
          custom_text: preview.text,
          text_hidden: false,
          text_align: preview.align,
          text_style: 'plain',
          text_color: '#ffffff',
          font_size: preview.fontSize,
          video_transform: {
            scale: 1, ox: 0, oy: 0,
            x: preview.videoBox.l, y: preview.videoBox.t,
            w: preview.videoBox.w, h: preview.videoBox.h,
          },
          text_transform: preview.textBox,
          overlay_image: overlayImage,
          enable_captions: false,
          caption_style: '1_word',
        },
      )

      // Downloads compiled video directly in browser using blob for reliability
      const fileUrl = resolveUrl(response.data.url)
      const downloadName = response.data.filename || `${clip.clip_id}-export.mp4`

      // Fetch the file as a blob to avoid browser download dialogs
      const fileResponse = await fetch(fileUrl)
      const blob = await fileResponse.blob()

      // Create download link from blob
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = downloadName
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()

      // Cleanup
      setTimeout(() => {
        document.body.removeChild(link)
        URL.revokeObjectURL(blobUrl)
      }, 1000)
    } catch (err) {
      // Extract the most useful error detail from the server response
      const serverDetail = err?.response?.data?.detail
      const isNotFound = err?.response?.status === 404 || (typeof serverDetail === 'string' && serverDetail.toLowerCase().includes('not found'))
      const msg = isNotFound
        ? 'Clip file no longer available on the server. Please regenerate this clip.'
        : (typeof serverDetail === 'string' ? serverDetail : null)
          ?? err?.message
          ?? 'Export failed. Please try again.'
      setDownloadError(msg)
      // Auto-dismiss the error after 5 seconds
      setTimeout(() => setDownloadError(''), 5000)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <article className={`repurpose-project-card${selectable ? ' project-selectable' : ''}${selected ? ' selected' : ''}`}>
      
      {/* Checked checkbox (Visible in multi-select mode) */}
      {selectable ? (
        <button
          className="project-select-check"
          type="button"
          onClick={e => { e.stopPropagation(); onSelect?.(project.project_id) }}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${title}`}
          aria-pressed={selected}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{selected ? 'check_circle' : 'radio_button_unchecked'}</span>
        </button>
      ) : null}

      {/* 
        PREVIEW PHONE BOX FRAME:
        - Simulates a mobile phone display (.repurpose-project-preview in index.css).
        - Renders a black backing stage (.repurpose-card-canvas) with the scaled foreground <video> player and logo overlays inside it.
      */}
      <div className="repurpose-project-preview">
        <div className="repurpose-card-canvas" style={{ background: bgType === 'blur' ? '#0a0a0f' : bgColor }}>

          {/* Blurred background video fill (only when the chosen background is Blur). */}
          {bgType === 'blur' && clipUrl ? (
            <video
              ref={blurBgRef}
              className="repurpose-card-blur-bg"
              src={clipUrl}
              muted
              playsInline
              loop
              preload="metadata"
              style={{
                // Match the editor preview / export blur: strength * 26 px, darkened to ~0.655 luminance.
                filter: `blur(${clamp(Number(clip.blur_opacity ?? 0.5), 0, 1) * 26}px) brightness(0.655)`,
              }}
            />
          ) : null}

          {/* Main video streaming box wrapper. Dynamic positioning styles are mapped from calculations. */}
          <div
            className="repurpose-card-video-box"
            style={{
              left: `${(preview.videoBox.l / STAGE_W) * 100}%`,
              top: `${(preview.videoBox.t / STAGE_H) * 100}%`,
              width: `${(preview.videoBox.w / STAGE_W) * 100}%`,
              height: `${(preview.videoBox.h / STAGE_H) * 100}%`,
              opacity: videoReady ? 1 : 0,
            }}
          >
            {clipUrl ? (
              /* 
                DYNAMIC STREAM PLAYBACK MOUSE-HOVERS:
                - Gathers stream from clips/ URL.
                - onMouseEnter: Triggers automatic playback when user hovers their mouse.
                - onMouseLeave: Pauses and returns video to starting frame (time = 0) when cursor exits card.
              */
              <video
                src={clipUrl}
                muted
                playsInline
                loop
                preload="metadata"
                onLoadedData={() => setVideoReady(true)}
                onCanPlay={() => setVideoReady(true)}
                onError={() => setVideoReady(true)}
                onMouseEnter={event => {
                  event.currentTarget.play().catch(() => {})
                  const bg = blurBgRef.current
                  if (bg) {
                    bg.currentTime = event.currentTarget.currentTime
                    bg.play().catch(() => {})
                  }
                }}
                onMouseLeave={event => {
                  event.currentTarget.pause()
                  event.currentTarget.currentTime = 0
                  const bg = blurBgRef.current
                  if (bg) {
                    bg.pause()
                    bg.currentTime = 0
                  }
                }}
              />
            ) : (
              <div className="repurpose-project-preview-empty">
                <span className="material-symbols-outlined">movie</span>
              </div>
            )}
          </div>

          {/* Canvas-generated overlay text title hook layer (sitting on top of the video player) */}
          {overlayImage ? (
            <img className="repurpose-card-overlay-image" src={overlayImage} alt="" aria-hidden="true" />
          ) : null}

        </div>
        
        {/* Mobile ratio badge */}
        <span className="repurpose-project-badge">9:16 preview</span>
      </div>

      {/* Card controls and description footer */}
      <div className="repurpose-project-body">
        <h3 className="bento-title">{title}</h3>
        <p className="bento-meta">
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>calendar_today</span>
          {formatDate(project.created_at)}
        </p>        {/* Inline export error (shown when clip file is missing, e.g. wiped by Render restart) */}
        {downloadError && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 6,
            padding: '8px 10px', borderRadius: 7, marginBottom: 8,
            background: 'rgba(255, 90, 61, 0.1)',
            border: '1px solid rgba(255, 90, 61, 0.35)',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#ff5a3d', flexShrink: 0, marginTop: 1 }}>error</span>
            <span style={{ fontSize: 11, color: '#ff5a3d', lineHeight: 1.4 }}>{downloadError}</span>
          </div>
        )}

        {/* Buttons (Download and Edit) */}
        <div className="repurpose-project-actions">
          {/* Download button: Renders heavy export via FastAPI on click */}
          <button className="btn btn-glass btn-sm" type="button" onClick={selectable ? () => onSelect?.(project.project_id) : handleDownload} disabled={!selectable && (downloading || !clip?.clip_id)}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{selectable ? selected ? 'check_circle' : 'radio_button_unchecked' : 'download'}</span>
            {selectable ? selected ? 'Selected' : 'Select' : downloading ? 'Exporting' : 'Download'}
          </button>
          
          {/* Edit button: Navigates user to the advanced timeline video editor */}
          <button className="btn btn-solid-white btn-sm" type="button" onClick={selectable ? () => onSelect?.(project.project_id) : () => onEdit(project, clip)}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{selectable ? 'close' : 'edit'}</span>
            {selectable ? selected ? 'Deselect' : 'Pick' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Hover delete trash icon (only visible when not in select mode) */}
      {!selectable ? (
        <button className="bento-delete-btn" onClick={e => { e.stopPropagation(); onDelete(project) }} title="Delete project" aria-label={`Delete ${project.title || 'Untitled Project'}`}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
        </button>
      ) : null}

    </article>
  )
}


// â”€â”€ SUB-COMPONENT 7: DASHED "ADD NEW PROJECT" CARD BENTO â”€â”€
// - Purpose: Dashed placeholder card allowing users to easily launch the creation wizards.
// - Styled by .bento-new and .bento-new-inner in index.css.

function NewProjectCard({ onClick, label = 'New Project', sub = 'Start from a URL or upload', icon = 'add' }) {
  return (
    <article className="bento-card bento-new" onClick={onClick} tabIndex={0} role="button" aria-label="Create new project"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}>
      <div className="bento-new-inner">
        {/* Plus / Transform Material Icon */}
        <div className="bento-new-icon">
          <span className="material-symbols-outlined" style={{ fontSize: 24, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
        </div>
        <p className="bento-new-label">{label}</p>
        <p className="bento-new-sub">{sub}</p>
      </div>
    </article>
  )
}


// â”€â”€ PRIMARY CONTROLLER COMPONENT: PROJECTS PAGE VIEW â”€â”€

export default function ProjectsPage() {
  const navigate = useNavigate()
  
  // STATE MANAGEMENT VARIABLES:
  const [projects, setProjects] = useState([])                 // Stores all loaded project folders
  const [loading, setLoading] = useState(true)                  // Tracks initialization spinner loader
  const [search, setSearch] = useState('')                      // Tracks input text inside filter search box
  const [deleteTarget, setDeleteTarget] = useState(null)        // Active project object flagged for deletion modal
  const [activeJobs, setActiveJobs] = useState([])              // Array of background rendering tasks currently running
  const [activeType, setActiveType] = useState('repurpose')     // Switch state tab active ('repurpose' vs 'long')
  const [selectMode, setSelectMode] = useState(false)            // Enables checkbox multi-select mode
  const [selectedProjectIds, setSelectedProjectIds] = useState(() => new Set()) // Set containing multi-checked project IDs
  const [bulkDeleting, setBulkDeleting] = useState(false)        // Tracks bulk deletion request status
  const pollRef = useRef(null)

  // 1. QUERY PROJECTS FROM SERVER
  const loadProjects = useCallback(async () => {
    try {
      const response = await api.get('/projects/library')
      const serverProjects = response.data?.projects || []
      // Never overwrite a non-empty local list with an empty server response —
      // empty could mean a disk/storage hiccup, not that the user has no clips.
      setProjects(prev => serverProjects.length > 0 ? serverProjects : prev)
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }, [])

  // 2. QUERY ACTIVE BACKGROUND RENDERS
  const loadJobs = useCallback(async () => {
    try {
      const { data } = await api.get('/api/v2/repurpose/jobs')
      // Keeps only active jobs (filters finished, failed, or cancelled jobs)
      const jobs = (data?.jobs || []).filter(j => j.status !== 'done' && j.status !== 'failed' && j.status !== 'interrupted')
      setActiveJobs(jobs)
      return jobs
    } catch {
      return []
    }
  }, [])

  // Initialization lifecycle hook: Runs queries automatically on first boot (in parallel for speed)
  useEffect(() => {
    Promise.all([loadProjects(), loadJobs()])
  }, [loadProjects, loadJobs])

  // 3. BACKGROUND SCHEDULER POLLING:
  // - If any rendering jobs are active, polls the backend server every 3 seconds for progress meter % updates.
  // - Refreshes the project folders list automatically as soon as any render successfully completes!
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)

    if (activeJobs.length > 0) {
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get('/api/v2/repurpose/jobs')
          const all = data?.jobs || []
          const stillActive = all.filter(j => j.status !== 'done' && j.status !== 'failed' && j.status !== 'interrupted')
          setActiveJobs(stillActive)
          const justDone = all.filter(j => j.status === 'done')
          
          if (justDone.length > 0) {
            loadProjects() // Refresh list since a new video is ready
          }
          if (stillActive.length === 0) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        } catch {/* silent fail */}
      }, 3000)
    }

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeJobs.length, loadProjects])

  // Single project deletion confirm handler
  const handleDeleteConfirm = useCallback((projectId) => {
    setProjects(prev => prev.filter(p => p.project_id !== projectId))
    setDeleteTarget(null)
  }, [])

  // 4. REAL-TIME SEARCH TEXT FILTER:
  // - Triggers instantly as you type inside the search bar. Filters titles matching search queries.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? projects.filter(p => String(p.title || '').toLowerCase().includes(q)) : projects
  }, [projects, search])

  // Categorizes projects between Repurpose (clips) vs Long-to-short formats
  const repurposeProjects = useMemo(() => filtered.filter(isRepurposeProject), [filtered])
  const longToShortProjects = useMemo(() => filtered.filter(project => !isRepurposeProject(project)), [filtered])
  
  // Resolves currently visible projects based on active selected tab
  const activeProjects = activeType === 'repurpose' ? repurposeProjects : longToShortProjects
  const activeProjectIds = useMemo(() => activeProjects.map(project => project.project_id), [activeProjects])
  const selectedCount = selectedProjectIds.size
  const allVisibleSelected = activeProjectIds.length > 0 && activeProjectIds.every(projectId => selectedProjectIds.has(projectId))

  const hasActiveJobs = activeJobs.length > 0

  // Toggles select checks mode on or off
  const toggleSelectMode = () => {
    setSelectMode(prev => {
      const next = !prev
      if (!next) setSelectedProjectIds(new Set()) // Empty checkbox set on cancel
      return next
    })
  }

  // Toggles selection check on a single bento card
  const toggleProjectSelection = projectId => {
    setSelectedProjectIds(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  // Checks or unchecks all visible items inside the grid
  const toggleSelectAllVisible = () => {
    setSelectedProjectIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        activeProjectIds.forEach(projectId => next.delete(projectId))
      } else {
        activeProjectIds.forEach(projectId => next.add(projectId))
      }
      return next
    })
  }

  // BATCH/BULK DELETION: Calls FastAPI bulk delete endpoint `/projects/bulk-delete` with all selected IDs
  const deleteSelectedProjects = async () => {
    const ids = Array.from(selectedProjectIds)
    if (!ids.length || bulkDeleting) return
    setBulkDeleting(true)
    try {
      const { data } = await api.post('/projects/bulk-delete', { project_ids: ids })
      const deletedIds = Array.isArray(data?.deleted) ? data.deleted : []
      // Updates local library list
      setProjects(prev => prev.filter(project => !deletedIds.includes(project.project_id)))
      setSelectedProjectIds(prev => {
        const next = new Set(prev)
        deletedIds.forEach(projectId => next.delete(projectId))
        return next
      })
      if (deletedIds.length) setSelectMode(false)
    } catch (err) {
      console.error('Bulk delete failed:', err)
    } finally {
      setBulkDeleting(false)
    }
  }

  // ADVANCED EDITOR OPENER: Launches advanced video timeline stage.
  // - Caches timeline lists in localStorage browser storage so changes stay persistent.
  const openRepurposeEditor = (project, clip) => {
    if (!clip?.clip_id) return
    const clips = project.clips || []
    localStorage.setItem('editClip', JSON.stringify(clip))
    localStorage.setItem('editClipList', JSON.stringify(clips))
    localStorage.setItem('editClipProjectId', project.project_id)
    navigate(`/editor/${clip.clip_id}`, {
      state: {
        bgType: clip.background_type || 'black',
        bgColor: clip.background_color || '#111827',
        blurOpacity: clip.blur_opacity ?? 0.5,
      },
    })
  }

  return (
    <div className="proj-page mobile-page mobile-projects-page">

      {/* â”€â”€ SECTION A: PAGE HEADER & CONTROLS â”€â”€ */}
      <div className="proj-header mobile-page-hero">
        <div>
          <h1 className="proj-heading">Projects</h1>
          {/* Library status description (Calculates length, mentions auto-delete timer) */}
          <p className="proj-subheading">
            {loading ? 'Loading your projectsâ€¦' : `${projects.length} project${projects.length !== 1 ? 's' : ''} Â· auto-deleted after 30 days`}
          </p>
        </div>

        {/* 
          ACTIONS BAR:
          1. Filter Search bar (with Google search icon inside).
          2. Multi-selection trigger toggle.
          3. Glowing "New Project" launcher button (.dk-action-btn in index.css).
        */}
        <div className="proj-header-actions">
          <div className="proj-search-wrap">
            <span className="material-symbols-outlined proj-search-icon" style={{ fontSize: 15 }}>search</span>
            <input 
              className="proj-search" 
              placeholder="Filter projectsâ€¦" 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>
          
          {/* Checkbox selector mode click */}
          <button className={`btn btn-glass btn-sm project-select-mode-btn${selectMode ? ' active' : ''}`} type="button" onClick={toggleSelectMode} disabled={loading || projects.length === 0}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{selectMode ? 'close' : 'select_check_box'}</span>
            {selectMode ? 'Cancel Select' : 'Select Projects'}
          </button>
          
          {/* New Project launch shortcut */}
          <button className="dk-action-btn" onClick={() => navigate('/repurpose')}>
            <span className="material-symbols-outlined" style={{ fontSize: 15, fontVariationSettings: "'FILL' 1" }}>add</span>
            New Project
          </button>
        </div>
      </div>


      {/* â”€â”€ SECTION B: ACTIVE RENDER JOBS NOTICE BANNER â”€â”€
          - Cyan-blue colored alert panel that slides open if a background render is active.
      */}
      {hasActiveJobs && (
        <div style={{
          marginBottom: 20,
          padding: '14px 20px',
          borderRadius: 8,
          background: 'rgba(92,225,230,0.08)',
          border: '1px solid rgba(92,225,230,0.28)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span className="material-symbols-outlined anim-spin" style={{ fontSize: 20, color: '#5ce1e6' }}>progress_activity</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {activeJobs.length} clip generation{activeJobs.length > 1 ? 's' : ''} in progress
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Processing in the background â€” this page refreshes automatically when done.
            </div>
          </div>
        </div>
      )}


      {/* â”€â”€ SECTION C: DETAILED STATISTICS METRIC BAR â”€â”€
          - Horizontal table summarising total counts, clip breakdowns, and auto-delete settings.
          - Styled by .proj-stats inside index.css.
      */}
      {!loading && projects.length > 0 && (
        <div className="proj-stats">
          <div className="proj-stat">
            <span className="proj-stat-value">{projects.length}</span>
            <span className="proj-stat-label">Total Projects</span>
          </div>
          <div className="proj-stat-divider" />
          <div className="proj-stat">
            <span className="proj-stat-value">{projects.filter(isRepurposeProject).length}</span>
            <span className="proj-stat-label">Repurpose</span>
          </div>
          <div className="proj-stat-divider" />
          <div className="proj-stat">
            <span className="proj-stat-value">{projects.filter(project => !isRepurposeProject(project)).length}</span>
            <span className="proj-stat-label">Long-to-Short</span>
          </div>
          <div className="proj-stat-divider" />
          <div className="proj-stat">
            <span className="proj-stat-value">{projects.reduce((acc, p) => acc + (p.clips?.length || 0), 0)}</span>
            <span className="proj-stat-label">Clips Generated</span>
          </div>
          <div className="proj-stat-divider" />
          <div className="proj-stat">
            <span className="proj-stat-value" style={{ color: '#fbbf24' }}>30 days</span>
            <span className="proj-stat-label">Auto-delete</span>
          </div>
        </div>
      )}


      {/* â”€â”€ SECTION D: PROJECT TYPE SEGMENTED TAB SWITCHES & BULK ACTIONS â”€â”€
          - Segmented tabs allowing you to toggle between Repurpose (meme clips) vs Long-to-short dashboards.
          - Multi-delete controls appear next to the tabs if multi-select mode is turned on.
      */}
      {!loading && (
        <div className="project-toolbar">
          {/* Bulk check list controls (Only visible during Select mode) */}
          {selectMode ? (
            <div className="project-bulk-actions">
              {/* Select/Unselect visible projects inside the current tab */}
              <button className="btn btn-glass btn-sm" type="button" onClick={toggleSelectAllVisible} disabled={activeProjectIds.length === 0}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{allVisibleSelected ? 'check_box' : 'select_all'}</span>
                {allVisibleSelected ? 'Clear Visible' : 'Select Visible'}
              </button>
              
              {/* Red batch delete button (shows amount checked inside braces, e.g. "Delete Selected (3)") */}
              <button className="btn btn-danger btn-sm" type="button" onClick={deleteSelectedProjects} disabled={selectedCount === 0 || bulkDeleting}>
                <span className={`material-symbols-outlined${bulkDeleting ? ' anim-spin' : ''}`} style={{ fontSize: 16 }}>{bulkDeleting ? 'progress_activity' : 'delete'}</span>
                {bulkDeleting ? 'Deleting...' : `Delete Selected${selectedCount ? ` (${selectedCount})` : ''}`}
              </button>
            </div>
          ) : null}

        </div>
      )}


      {/* â”€â”€ SECTION E: CORE BENTO PROJECTS GRID â”€â”€
          - Renders 3 grid states:
            1. Loading: Shows grey pulsing card placeholders (.bento-skeleton).
            2. Empty library placeholder (.bento-empty) with big folder icons.
            3. Active board grid rendering active rendering meters and finished project folders.
      */}
      {loading ? (
        /* LOADING GRID */
        <div className="bento-grid">
          {Array.from({ length: 6 }).map((_, i) => <BentoSkeleton key={i} />)}
        </div>
      ) : activeProjects.length === 0 && !(activeType === 'repurpose' && hasActiveJobs) ? (
        /* EMPTY DASHBOARD VIEWPORT */
        <div className="bento-empty">
          <div className="bento-empty-icon">
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: 'rgba(255,255,255,0.18)' }}>
              {search ? 'search_off' : 'folder_open'}
            </span>
          </div>
          <h2 className="bento-empty-title">{search ? 'No matches found' : activeType === 'repurpose' ? 'No repurpose projects yet' : 'No long-to-short clips yet'}</h2>
          <p className="bento-empty-sub">
            {search ? 'Try a different keyword.' : activeType === 'repurpose' ? 'Transform an existing video into a meme-style clip.' : 'Generate short clips from a full video.'}
          </p>
          {/* Quick wizard launcher shortcut */}
          <button className="dk-action-btn" onClick={() => { if (search) setSearch(''); else navigate(activeType === 'repurpose' ? '/repurpose' : '/studio') }}>
            {search ? 'Clear filter' : activeType === 'repurpose' ? 'New Repurpose' : 'New Long-to-Short'}
          </button>
        </div>
      ) : activeType === 'repurpose' ? (
        /* ACTIVE REPURPOSE GRID: Displays active rendering tasks and completed meme stages with video previews. */
        <div className="repurpose-project-grid">
          
          {/* RENDERING PROGRESS LOADER CARDS */}
          {activeJobs.map(job => (
            <ProcessingCard
              key={job.job_id}
              job={job}
              onComplete={loadProjects}
            />
          ))}
          
          {/* REPURPOSE MEME PROJECTS FEED */}
          {repurposeProjects.map(project => (
            <RepurposeProjectCard
              key={project.project_id}
              project={project}
              onEdit={openRepurposeEditor}
              onDelete={setDeleteTarget}
              selectable={selectMode}
              selected={selectedProjectIds.has(project.project_id)}
              onSelect={toggleProjectSelection}
            />
          ))}
          
          {/* QUICK "NEW PROJECT" CARD: Placed at the tail of completed cards (Only visible when not bulk selecting) */}
          {!selectMode ? (
            <NewProjectCard
              onClick={() => navigate('/repurpose')}
              label="New Repurpose"
              sub="Transform an existing clip"
              icon="transform"
            />
          ) : null}

        </div>
      ) : (
        /* STANDARD LONG-TO-SHORT BENTO GRID folders dashboard */
        <div className="bento-grid">
          
          {longToShortProjects.map(project => (
            <BentoCard
              key={project.project_id}
              project={project}
              onOpen={() => navigate(`/projects/${project.project_id}`)}
              onDelete={setDeleteTarget}
              selectable={selectMode}
              selected={selectedProjectIds.has(project.project_id)}
              onSelect={toggleProjectSelection}
            />
          ))}
          
          {/* QUICK "NEW LONG-TO-SHORT" CARD PLACEHOLDER */}
          {!selectMode ? (
            <NewProjectCard
              onClick={() => navigate('/studio')}
              label="New Long-to-Short"
              sub="Upload or paste a long video"
              icon="movie"
            />
          ) : null}

        </div>
      )}


      {/* â”€â”€ SECTION F: POPUP MODAL WRAPPERS â”€â”€ */}
      <DeleteModal 
        project={deleteTarget} 
        onConfirm={handleDeleteConfirm} 
        onCancel={() => setDeleteTarget(null)} 
      />

      {/* Shimmer animation keyframes style wrapper */}
      <style>{`
        @keyframes proj-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}

