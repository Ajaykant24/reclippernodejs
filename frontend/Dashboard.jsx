// ── WORKSPACE DASHBOARD VIEW: Dashboard.jsx ──
// - Purpose: The user's welcome landing screen when they sign in.
// - Features: Shows a personal greeting, total metrics of your library, active video render statuses, and quick action bookmarks.
// - Editing Tip: You can adjust the stat box names or list of quick bookmarks by looking inside the `<section>` elements below.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from './api/client'

export default function DashboardPage() {
  // STATE MANAGEMENT: Local memory variables to store data loaded from the backend.
  const [projects, setProjects] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true) // skeletons hold the layout until data lands

  // SESSION USER: Retrieves current user profile from cache to display personalized welcome message.
  const user = JSON.parse(localStorage.getItem('user') || '{}')

  // DATA FETCHING: Triggers automatically when this page is opened.
  // - Queries your personal library list (`/projects/library`) and any running background renders (`/api/v2/repurpose/jobs`).
  // - Runs both requests in parallel for faster load time
  useEffect(() => {
    Promise.all([
      api.get('/projects/library').then(({ data }) => setProjects(data.projects || [])).catch(() => {}),
      api.get('/api/v2/repurpose/jobs').then(({ data }) => setJobs(data.jobs || [])).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  // METRIC CALCULATIONS: Summarizes your library data.
  // 1. Clips: Summarizes the total number of short viral clips across all projects.
  const clips = projects.reduce((total, project) => total + (project.clips?.length || 0), 0)

  // 2. Active Jobs: Filters any video rendering job that is currently running (not done, failed, or cancelled).
  const activeJobs = jobs.filter(job => !['done', 'failed', 'interrupted'].includes(job.status)).length

  // 3. Ready clips: everything already exported/complete — a real stat, not a placeholder.
  const readyClips = projects.reduce(
    (total, project) => total + (project.clips?.filter(c => c.status !== 'failed').length || 0), 0)

  return (
    /* 
      PAGE BASE LAYER: Workspace layout wrapper.
      - Styled by .workspace-page (index.css).
    */
    <div className="workspace-page mobile-page mobile-dashboard-page">
      
      {/* 
        WELCOME HERO CONTAINER:
        - Displays your name and a short introduction next to a "New Clip" action button.
        - CSS styles: .workspace-hero
      */}
      <header className="workspace-hero mobile-page-hero">
        <div>
          <span className="eyebrow">Workspace</span>
          {/* Welcome headline (gathers user name dynamically, defaults to 'Creator') */}
          <h1>Good to see you, {user.name || 'Creator'}.</h1>
          <p>Track projects, renders, captions, and export-ready clips from one calm production surface.</p>
        </div>
        
        {/* ACTION BUTTON: Opens the upload / generator tool. Styled as a solid white large button. */}
        <Link className="btn btn-solid-white btn-lg" to="/tool">
          <span className="material-symbols-outlined">add_circle</span>
          New Clip
        </Link>
      </header>

      {/* 
        METRICS BAR SECTION:
        - Four cards displaying your workspace statistics.
        - Styled by .metric-grid and .premium-metrics in index.css.
      */}
      <section className="metric-grid premium-metrics mobile-metric-strip stagger">
        {loading ? (
          /* SKELETON TILES: hold the exact layout so numbers never "pop in" with a shift. */
          [0, 1, 2, 3].map(i => (
            <div key={i}>
              <strong><span className="skeleton" style={{ display: 'inline-block', width: 36, height: 26 }} /></strong>
              <span className="skeleton" style={{ display: 'inline-block', width: 88, height: 12 }} />
            </div>
          ))
        ) : (
          <>
            {/* Card 1: Total Projects Count */}
            <div className="anim-fade-up"><strong>{projects.length}</strong><span>Projects</span></div>
            {/* Card 2: Sum of Clips Generated */}
            <div className="anim-fade-up"><strong>{clips}</strong><span>Generated clips</span></div>
            {/* Card 3: Currently rendering queues */}
            <div className="anim-fade-up"><strong>{activeJobs}</strong><span>Active renders</span></div>
            {/* Card 4: Clips ready to post */}
            <div className="anim-fade-up"><strong>{readyClips}</strong><span>Ready to post</span></div>
          </>
        )}
      </section>

      {/* 
        QUICK ACTIONS BOARD:
        - Fast navigation shortcuts to crucial workspace areas.
        - Styled by .premium-workflow and .workflow-list in index.css.
      */}
      <section className="premium-workflow mobile-workflow-panel">
        <div>
          <span className="eyebrow">Next actions</span>
          <h2>Keep the posting line moving.</h2>
        </div>
        
        {/* BOOKMARK LINKS GRID: Links redirecting you to other pages. */}
        <div className="workflow-list">
          {/* Link 1: Launch generator */}
          <Link to="/tool"><span>Create a mobile-ready clip</span><b>Start</b></Link>
          {/* Link 2: View project folders */}
          <Link to="/projects"><span>Review generated projects</span><b>Open</b></Link>
          {/* Link 3: Adjust profile options */}
          <Link to="/profile"><span>Check workspace profile</span><b>Manage</b></Link>
        </div>
      </section>

    </div>
  )
}
