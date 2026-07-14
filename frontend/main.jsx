// ── REACT STARTUP ENTRY SCRIPT: main.jsx ──
// - Purpose: Tells React to take control of the blank <div id="root"> element in index.html and inject the <App /> component.
// - Editing Tip: This file rarely needs edits. It configures the browser routing and imports the global styling sheet.

import React from 'react'
import { createRoot } from 'react-dom/client'
// ROUTING WRAPPER: Enables moving between different pages (like /dashboard, /tool, /profile) without reloading the page.
import { BrowserRouter } from 'react-router-dom'
// ROOT COMPONENT: App.jsx acts as the mainframe shell holding all the sub-pages together.
import App from './App.jsx'
// GLOBAL STYLESHEET: index.css contains all layout designs, glassmorphism borders, fonts, colors, and responsive sizes.
import './index.css'

// MOUNTING: Finds the "root" div in your index.html and inserts our interactive web application inside it.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* BROWSER ROUTER: Keeps the address bar URL in sync with what React is showing on screen. */}
    <BrowserRouter>
      {/* APP SHELL: Loads the sidebar, main navigation, and all pages structure. */}
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

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
