import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, API_BASE } from './api/client'

export default function ExportPage() {
  const location = useLocation()
  const exportState = location.state || {}
  const [projects, setProjects] = useState([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (exportState.previewUrl) return
    api.get('/projects/library').then(({ data }) => setProjects(data.projects || [])).catch(() => {})
  }, [exportState.previewUrl])

  const latestClip = useMemo(() => {
    for (const project of projects) {
      const clip = project.clips?.[0]
      if (clip?.clip_url) return { ...clip, projectTitle: project.title }
    }
    return null
  }, [projects])

  const previewUrl = exportState.previewUrl || (latestClip?.clip_url ? `${API_BASE}${latestClip.clip_url}` : '')
  const downloadUrl = exportState.downloadUrl || previewUrl
  const downloadName = exportState.downloadName || `${latestClip?.clip_id || 'reclipper-export'}.mp4`
  const caption = exportState.caption || latestClip?.clip_caption || 'Generated Instagram caption will appear here after export.'
  const title = exportState.title || latestClip?.hook || latestClip?.projectTitle || 'Final export'

  const copyCaption = async () => {
    await navigator.clipboard.writeText(caption)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="export-workspace">
      <header className="export-header">
        <span className="eyebrow">Final export</span>
        <h1>{title}</h1>
        <p>Review the final video, download the asset, and copy the Instagram caption for fast reel publishing.</p>
      </header>

      {previewUrl ? (
        <section className="export-review-layout">
          <div className="export-video-column">
            <div className="export-player-shell">
              <video
                key={previewUrl}
                className="export-player"
                src={previewUrl}
                controls
                autoPlay
                playsInline
                preload="auto"
              />
            </div>
            <a className="export-download-btn" href={downloadUrl} download={downloadName}>
              <span className="material-symbols-outlined">download</span>
              Download Video
            </a>
          </div>

          <aside className="caption-panel">
            <div>
              <span className="eyebrow">Instagram caption</span>
              <h2>Ready to post</h2>
            </div>
            <p>{caption}</p>
            <button type="button" className="caption-copy-btn" onClick={copyCaption}>
              <span className="material-symbols-outlined">{copied ? 'check' : 'content_copy'}</span>
              {copied ? 'Copied' : 'Copy Caption'}
            </button>
          </aside>
        </section>
      ) : (
        <section className="export-empty">
          <span className="material-symbols-outlined">movie_off</span>
          <h2>No finalized clip yet</h2>
          <p>Finalize a clip in the editor to open the dedicated export review page.</p>
          <Link className="btn btn-solid-white" to="/projects">Open Projects</Link>
        </section>
      )}
    </div>
  )
}
