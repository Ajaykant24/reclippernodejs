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

// AUTH CHECK: A user is "logged in" only if a real session token is stored.
// (The API client falls back to a shared 'local-user' string, which must NOT count as logged in.)
function isAuthenticated() {
  const token = (localStorage.getItem('token') || '').trim()
  return token !== '' && token !== 'local-user'
}

// ROUTE GUARD: Wraps workspace pages so logged-out visitors are sent to sign up
// (create account first) instead of walking straight into the tool.
function RequireAuth({ children }) {
  const location = useLocation()
  if (!isAuthenticated()) {
    return <Navigate to="/signup" replace state={{ from: location.pathname }} />
  }
  return children
}

const workspaceNavItems = [
  { to: '/dashboard', icon: 'space_dashboard', label: 'Home' },
  { to: '/tool', icon: 'auto_awesome', label: 'Create' },
  { to: '/projects', icon: 'folder_open', label: 'Projects' },
  { to: '/pricing', icon: 'payments', label: 'Plans' },
  { to: '/profile', icon: 'account_circle', label: 'Profile' },
]

const routeTitles = {
  '/': 'Reclipper',
  '/signin': 'Sign in',
  '/signup': 'Create account',
  '/dashboard': 'Workspace',
  '/tool': 'Create clip',
  '/pricing': 'Plans',
  '/export': 'Export',
  '/profile': 'Profile',
  '/repurpose': 'Create clip',
  '/projects': 'Projects',
  '/studio': 'Create clip',
}

function Shell() {
  // ROUTING HELPERS: Tracks the current browser address and handles redirects.
  const location = useLocation()
  const navigate = useNavigate()
  
  // PUBLIC PAGES: Pages that do NOT show the left-hand navigation sidebar (e.g. landing page, login page).
  const publicRoutes = ['/', '/signin', '/signup']
  const isPublicRoute = publicRoutes.includes(location.pathname)
  const isHomeRoute = location.pathname === '/'
  const pageTitle = location.pathname.startsWith('/editor')
    ? (() => { try { return JSON.parse(localStorage.getItem('editClip') || '{}')?.hook || 'Editor' } catch { return 'Editor' } })()
    : routeTitles[location.pathname] || 'Reclipper'
  
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
    <div className={`app-shell${isPublicRoute ? ' public-shell' : ''}${location.pathname.startsWith('/editor') ? ' app-editor-shell' : ''}`}>
      
      {/* BACKGROUND GRAPHICS: Colorful dynamic floating water bubbles styled via .app-water in index.css. */}
      <div className="app-water app-water-a" />
      <div className="app-water app-water-b" />

      {!isHomeRoute ? (
        <header className="app-mobile-topbar">
          <button type="button" className="app-mobile-back" onClick={() => navigate(-1)} aria-label="Go back">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <strong>{pageTitle}</strong>
            <small>Reclipper</small>
          </div>
        </header>
      ) : null}

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
            {workspaceNavItems.map(item => (
              <NavLink key={item.to} to={item.to}>
                <span className="material-symbols-outlined">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
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
          
          {/* PUBLIC MARKETING PAGE */}
          <Route path="/pricing" element={<PricingPage />} />

          {/* WORKSPACE VIEWS — require a logged-in account */}
          <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="/tool" element={<RequireAuth><RepurposePage /></RequireAuth>} />
          <Route path="/export" element={<RequireAuth><ExportPage /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          <Route path="/repurpose" element={<RequireAuth><RepurposePage /></RequireAuth>} />
          <Route path="/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />

          {/* DYNAMIC EDITOR URL ROUTES: Matches specific clip and project IDs. */}
          <Route path="/editor/:clipId" element={<RequireAuth><Editor /></RequireAuth>} />
          <Route path="/editor/:projectId/:clipId" element={<RequireAuth><Editor /></RequireAuth>} />

          {/* BACKWARDS-COMPATIBILITY REDIRECTS: Maps legacy routes back to the main generator. */}
          <Route path="/studio" element={<RequireAuth><RepurposePage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* MOBILE BOTTOM NAVIGATION: Only visible on mobile via CSS (display:none on desktop) */}
      {!isPublicRoute ? (
        <div className="app-bottom-nav">
          <nav>
            {workspaceNavItems.map(item => (
              <NavLink key={`bottom-${item.to}`} to={item.to}>
                <span className="material-symbols-outlined">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      ) : null}

    </div>
  )
}

export default Shell
