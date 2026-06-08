// ── VIDEO REPURPOSING DASHBOARD: Repurpose.jsx ──
// - Purpose: This page allows users to upload widescreen videos and configure layouts for mobile publishing.
// - Features: 
//   1. Drag-and-drop file upload area.
//   2. Background formatting selectors (solid colors, custom colors, blurred borders).
//   3. Responsive crop presets (9:16 vertical, 1:1 square, etc.).
//   4. Asynchronous FormData queries uploading raw video streams to Python.
// - Editing Tip: To change form labels or instructions, edit the text inside the `<h1>`, `<p>`, and section label fields below.

import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api/client'

// ── CANVAS BACKGROUND OPTIONS PRESETS ──
const BG_OPTS = [
  { id: 'black',  label: 'Black',  preview: '#0a0a0f' },
  { id: 'white',  label: 'White',  preview: '#ffffff' },
  { id: 'blur',   label: 'Blur',   preview: 'linear-gradient(135deg,#0a0a0f,#ff4d2e)' }, // Blur uses a gradient representation in settings page
  { id: 'custom', label: 'Custom', preview: null }, // Displays active color picker Hex on select
]

// ── ASPECT CROP PRESENTS ──
// - Maps ratio labels, descriptions, and Google icons.
const DEFAULT_RATIO = 'original'

// ── INTENSITY MODIFIERS ──
// - Determines how copyright-safe / heavily formatted the smart crop is.
const DEFAULT_INTENSITY = 'medium'

// ── DESIGN SYSTEM THEME TOKENS ──
const D = {
  card:       '#1a1a24',
  cardBorder: 'rgba(42,42,58,0.8)',
  cardHover:  '#22222e',
  text:       '#ffffff',
  textSoft:   '#8888aa',
  textMuted:  '#55556a',
  accent:     '#ff4d2e',
  accentGlow: 'rgba(255,77,46,0.12)',
  accentBorder:'rgba(255,77,46,0.35)',
  success:    '#2dd4bf',
  radius:     12,
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

  // Settings customizer states
  const [bgType, setBgType] = useState('black')
  const [bgCustomColor, setBgCustomColor] = useState('#111827')
  const [blurOpacity, setBlurOpacity] = useState(0.5)
  const [overlayMode, setOverlayMode] = useState('generated')
  const [originalOverlay, setOriginalOverlay] = useState('')
  const ratio = DEFAULT_RATIO
  const intensity = DEFAULT_INTENSITY

  // ── WORKFLOW LOGIC ──

  const handleFileSelect = f => {
    // Purpose: Invoked when a file is checked or dropped. Caches file and opens settings page.
    if (!f) return
    setFile(f)
    setPhase('settings')
  }

  const startProcessing = async () => {
    // Purpose: packages layout selections into a Multipart Form request and posts to FastAPI.
    setError('')
    setSubmitting(true)
    
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
    
    try {
      // Calls V2 backend endpoint
      await api.post('/api/v2/repurpose', fd)
      setPhase('queued') // Show success checkmarks
      // Redirects user back to Projects folder dashboard after 2.8 seconds
      setTimeout(() => nav('/projects'), 2800)
    } catch (e) {
      setError(e?.response?.data?.detail ?? e.message)
      setSubmitting(false)
    }
  }

  const reset = () => { 
    // Restores original blank upload form state
    setPhase('input')
    setFile(null)
    setError('')
    setSubmitting(false) 
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
          🎬 Clips are being generated!
        </h2>
        <p style={{ margin: '0 0 8px', fontSize: 15, color: D.textSoft, lineHeight: 1.75 }}>
          Your video is processing in the background.<br />
          <strong style={{ color: D.text }}>You can safely leave — no need to wait!</strong>
        </p>
        <p style={{ margin: '0 0 28px', fontSize: 13, color: D.textMuted }}>
          Head to <strong style={{ color: D.textSoft }}>Projects</strong> — clips appear there when ready.
        </p>

        {/* Sliding rainbow progress loader bar */}
        <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden', marginBottom: 28 }}>
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
            <p className="proj-subheading">Turn any video into viral short-form clips. Fire &amp; forget — no need to stay on the page.</p>
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
            background: dragOver ? D.accentGlow : 'rgba(255,255,255,0.05)',
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

        {/* Feature benefits list cards columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
            <p className="proj-subheading">Choose your format, then hit Generate — you can leave the page immediately after.</p>
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

        {/* Selected file confirmation bar: Shows name, and file size dynamically calculated in MB. */}
        <div style={{
          ...darkCard({ padding: '11px 18px', borderColor: 'rgba(45,212,191,0.28)', background: 'rgba(45,212,191,0.08)' }),
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 10
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: D.success, fontVariationSettings: "'FILL' 1", flexShrink: 0 }}>check_circle</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: D.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file?.name}</span>
          <span style={{ fontSize: 12, color: D.textMuted, flexShrink: 0 }}>
            {file?.size ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ''}
          </span>
        </div>

        {/* Fire & forget safety alert box */}
        <div style={{
          ...darkCard({ padding: '10px 18px', borderColor: 'rgba(255,90,61,0.28)', background: 'rgba(255,90,61,0.08)' }),
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 20
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 17, color: D.accent, fontVariationSettings: "'FILL' 1", flexShrink: 0 }}>rocket_launch</span>
          <span style={{ fontSize: 13, color: D.textSoft }}>
            <strong style={{ color: D.text }}>Fire &amp; forget:</strong> Hit Generate, then close this tab. Clips appear in Projects when ready.
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
                return (
                  <button key={o.id} type="button" onClick={() => setBgType(o.id)} style={optBtn(bgType === o.id)}>
                    {/* Small rounded preview box colored dynamically */}
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      background: preview, border: `1px solid ${D.cardBorder}`, display: 'inline-block',
                    }} />
                    {o.label}
                  </button>
                )
              })}
            </div>

            {/* Custom color picker panel (Only visible when Custom background is checked) */}
            {bgType === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: 14, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: `1px solid ${D.cardBorder}` }}>
                <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 8, background: bgCustomColor, border: `1px solid ${D.cardBorder}`, cursor: 'pointer' }} onClick={() => document.getElementById('rp-color-input').click()} />
                  <input
                    id="rp-color-input"
                    type="color"
                    value={bgCustomColor}
                    onChange={e => setBgCustomColor(e.target.value)}
                    aria-label="Canvas background color"
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: D.text, marginBottom: 4 }}>Canvas color</div>
                  <input
                    type="text"
                    value={bgCustomColor}
                    onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setBgCustomColor(e.target.value) }}
                    maxLength={7}
                    style={{ fontSize: 12, fontFamily: 'monospace', color: D.textMuted, background: 'transparent', border: `1px solid ${D.cardBorder}`, borderRadius: 6, padding: '3px 8px', width: 90, outline: 'none' }}
                  />
                </div>
              </div>
            )}

            {/* Blurred strength range slider input (Only visible when Blur background is checked) */}
            {bgType === 'blur' && (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: `1px solid ${D.cardBorder}` }}>
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

          {/* 2. OVERLAY TEXT MODE */}
          <div style={{ marginBottom: 28 }}>
            <div style={sectionLabel}>Default Overlay Text</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              <button type="button" onClick={() => setOverlayMode('generated')} style={optBtn(overlayMode === 'generated')}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                AI Generated
              </button>
              <button type="button" onClick={() => setOverlayMode('original')} style={optBtn(overlayMode === 'original')}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>text_fields</span>
                Original
              </button>
              <button type="button" onClick={() => setOverlayMode('exact')} style={optBtn(overlayMode === 'exact')}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>content_copy</span>
                Exact Overlay
              </button>
            </div>
            {(overlayMode === 'original' || overlayMode === 'exact') && (
              <div style={{ padding: 14, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: `1px solid ${D.cardBorder}` }}>
                <div style={{ fontSize: 12, color: D.textMuted, marginBottom: 8 }}>
                  {overlayMode === 'exact'
                    ? 'Type the exact text shown on the input video — no AI overlays will be generated, only this exact text is used.'
                    : 'Type the original overlay text from the video'}
                </div>
                <textarea
                  rows={2}
                  value={originalOverlay}
                  onChange={e => setOriginalOverlay(e.target.value)}
                  placeholder="e.g. POV: you just realized…"
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'none',
                    background: D.card, border: `1px solid ${D.cardBorder}`, borderRadius: 8,
                    color: D.text, fontSize: 13, padding: '10px 12px', outline: 'none',
                    fontFamily: 'inherit', lineHeight: 1.5,
                  }}
                />
              </div>
            )}
            {overlayMode === 'generated' && (
              <div style={{ fontSize: 12, color: D.textMuted, padding: '8px 0' }}>
                AI will pick the most relatable hook from the 20 generated overlays as default.
              </div>
            )}
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
              <><span className="material-symbols-outlined anim-spin" style={{ fontSize: 20 }}>progress_activity</span> Creating Project…</>
            ) : (
              <><span className="material-symbols-outlined" style={{ fontSize: 20 }}>rocket_launch</span> Generate Clips →</>
            )}
          </button>
        </div>

      </div>
    </div>
  )

  return null
}
