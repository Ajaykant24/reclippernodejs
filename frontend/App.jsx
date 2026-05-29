// ── GLOBAL LAYOUT & NAVIGATION CONTROLLER: App.jsx ──
// - Purpose: Houses the main dashboard layout shell, the sidebar navigation, and defines the links (URLs) to all sub-pages.
// - Editing Tip: If you want to rename or rearrange links in the left-hand sidebar, look inside the `<aside className="app-sidebar">` block.

import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

// SUB-PAGES IMPORT: Brings in each separate view so the router can display them.
import DashboardPage from './Dashboard.jsx'
import ExportPage from './Export.jsx'
import HomePage from './Home.jsx'
import Editor from './editor.jsx'
import PricingPage from './Pricing.jsx'
import ProfilePage from './Profile.jsx'
import ProjectsPage from './Projects.jsx'
import RepurposePage from './Repurpose.jsx'
import SignInPage from './SignIn.jsx'
import SignUpPage from './SignUp.jsx'

function Shell() {
  // ROUTING HELPERS: Tracks the current browser address and handles redirects.
  const location = useLocation()
  const navigate = useNavigate()
  
  // PUBLIC PAGES: Pages that do NOT show the left-hand navigation sidebar (e.g. landing page, login page).
  const publicRoutes = ['/', '/signin', '/signup', '/pricing']
  const isPublicRoute = publicRoutes.includes(location.pathname)
  
  // SESSION USER: Retrieves current logged-in user profile details from the browser cache.
  const user = JSON.parse(localStorage.getItem('user') || '{}')

  // SESSION DESTRUCTION: Clears your session key and returns you to the landing page.
  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/')
  }

  return (
    /* 
      LAYOUT CONTAINER: The outermost wrapper for the app.
      - Styled by .app-shell (index.css). Splits screen into two parts: a 248px left sidebar, and a flexible right-side main panel.
      - Styled by .public-shell on public pages, which expands the viewport to 100% full screen.
    */
    <div className={`app-shell${isPublicRoute ? ' public-shell' : ''}`}>
      
      {/* BACKGROUND GRAPHICS: Colorful dynamic floating water bubbles styled via .app-water in index.css. */}
      <div className="app-water app-water-a" />
      <div className="app-water app-water-b" />

      {/* SIDEBAR: Only visible to logged-in users on private workspace paths. */}
      {!isPublicRoute ? (
        <aside className="app-sidebar">
          
          {/* BRAND HEAD: Sidebar Brand Icon & App Title.
              - Icon: movie_filter (Material symbol icon)
              - Text: Bold "Reclipper" title (styled by .app-brand strong) and "creator suite" (styled by .app-brand small)
          */}
          <div className="app-brand">
            <span className="app-brand-mark material-symbols-outlined">movie_filter</span>
            <span>
              <strong>Reclipper</strong>
              <small>creator suite</small>
            </span>
          </div>

          {/* 
            NAVIGATION MENUS: Left-hand sidebar links.
            - To change a link name or icon, change the span texts inside each NavLink block.
            - Icons are loaded from Google's Material symbols.
          */}
          <nav className="app-nav">
            <NavLink to="/dashboard">
              <span className="material-symbols-outlined">space_dashboard</span>
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/tool">
              <span className="material-symbols-outlined">auto_awesome</span>
              <span>Tool</span>
            </NavLink>
            <NavLink to="/projects">
              <span className="material-symbols-outlined">folder_open</span>
              <span>Projects</span>
            </NavLink>
            <NavLink to="/pricing">
              <span className="material-symbols-outlined">payments</span>
              <span>Pricing</span>
            </NavLink>
            <NavLink to="/profile">
              <span className="material-symbols-outlined">account_circle</span>
              <span>Profile</span>
            </NavLink>
          </nav>

          {/* USER PROFILE BOX & LOGOUT: Positioned at the bottom of the sidebar. */}
          <div className="app-user-panel">
            <div>
              {/* Displays User Name (defaults to 'Reclipper User') and Email (defaults to 'local workspace') */}
              <strong>{user.name || 'Reclipper User'}</strong>
              <small>{user.email || 'local workspace'}</small>
            </div>
            
            {/* LOGOUT BUTTON: Styled in pinkish/red inside index.css (.app-logout-btn) */}
            <button type="button" onClick={logout} className="app-logout-btn">
              <span className="material-symbols-outlined">logout</span>
              Logout
            </button>
          </div>

        </aside>
      ) : null}

      {/* 
        MAIN CONTENT VIEWPORT: Renders different sub-pages based on what the browser URL address is.
        - Styled by .app-main in index.css (flex taking up remaining horizontal space).
      */}
      <main className="app-main">
        <Routes>
          {/* LANDING PAGE: / (homepage) */}
          <Route path="/" element={<HomePage />} />
          
          {/* USER SESSION VIEWS */}
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          
          {/* WORKSPACE VIEWS */}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tool" element={<RepurposePage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/repurpose" element={<RepurposePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          
          {/* DYNAMIC EDITOR URL ROUTES: Matches specific clip and project IDs. */}
          <Route path="/editor/:clipId" element={<Editor />} />
          <Route path="/editor/:projectId/:clipId" element={<Editor />} />
          
          {/* BACKWARDS-COMPATIBILITY REDIRECTS: Maps legacy routes back to the main generator. */}
          <Route path="/studio" element={<RepurposePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

    </div>
  )
}

export default Shell
