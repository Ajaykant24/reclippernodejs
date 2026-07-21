// ── REACT STARTUP ENTRY SCRIPT: main.jsx ──
// - Purpose: Tells React to take control of the blank <div id="root"> element in index.html and inject the <App /> component.
// - Editing Tip: This file rarely needs edits. It configures the browser routing and imports the global styling sheet.

import React from 'react'
import { createRoot } from 'react-dom/client'
// ROUTING WRAPPER: Enables moving between different pages (like /dashboard, /tool, /profile) without reloading the page.
import { BrowserRouter } from 'react-router-dom'
// ROOT COMPONENT: App.jsx acts as the mainframe shell holding all the sub-pages together.
import App from './App.jsx'
// SELF-HOSTED FONTS: bundled with the app instead of fetched from Google servers.
// Faster first paint, identical rendering on every network, no raw icon-name flash.
// (Icons use a 45KB subset font — see @font-face in index.css + public/fonts/.)
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
// Display font for headings — gives the brand its own voice next to Inter body text.
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/700.css'
// GLOBAL STYLESHEET: index.css contains all layout designs, glassmorphism borders, fonts, colors, and responsive sizes.
import './index.css'
import { tryRestoreSession } from './api/client'

// MOUNTING: Finds the "root" div in your index.html and inserts our interactive web application inside it.
function mount() {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {/* BROWSER ROUTER: Keeps the address bar URL in sync with what React is showing on screen. */}
      <BrowserRouter>
        {/* APP SHELL: Loads the sidebar, main navigation, and all pages structure. */}
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
}

// If this device already has a valid session, tryRestoreSession resolves
// immediately (no network call) and mounting proceeds with no visible delay.
// Only when logged out does it make one quick check against the backend's
// long-lived login cookie before mounting, so a session that survived on the
// server (even though localStorage got cleared/evicted) is restored silently
// instead of bouncing the user to sign-in.
tryRestoreSession().finally(mount)

// PWA: register the service worker so the app is installable to the home screen.
// Network-first (see public/sw.js) so deploys always show immediately — no stale cache.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Warm up the bundled overlay-text font (see @font-face in index.css) as early
// as possible, so canvas-based overlay previews (Projects cards) already have
// it loaded by the time they first render, instead of only fetching it lazily
// when an HTML element happens to use it.
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.load('400 32px "SFProDisplayWeb"').catch(() => {})
}
