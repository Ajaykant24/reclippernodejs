// ── BACKEND CONNECTOR CLIENT: client.js ──
// - Purpose: Establishes a communication bridge between your web interface (frontend) and your Python server (backend).
// - How it works: It handles authentication headers (user session tracking) and formats friendly connection error alerts.
// - Editing Tip: If your backend server changes, update the Render URL below or set VITE_API_URL in "frontend/.env".

import axios from 'axios'

// SERVER BASE URL: The web address where your Python FastAPI server is running.
// - Falls back to the production backend if no environmental variable is set.
export const API_BASE = 'https://147.93.171.121'

// CLIENT INSTANCE: Configures a reusable connector with the base address preset.
// withCredentials lets the browser send/receive the long-lived rc_token cookie
// (set by the backend on login) alongside the bearer token — the cookie is what
// survives a closed app/tab even if localStorage gets cleared/evicted.
export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
})

/**
 * Safely resolve a clip/thumb/export URL to a full absolute URL.
 * - If `path` is already an absolute URL (e.g. Cloudinary CDN https://res.cloudinary.com/...),
 *   it is returned as-is — no double-prepending.
 * - Otherwise, prepends API_BASE (handles legacy /clips/filename.mp4 paths from local Render disk).
 */
export function resolveUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}${path}`
}

// ── SESSION HELPERS ──
// Keeping users logged in: the session token is stored in localStorage, which
// persists across app restarts. These helpers make sure we NEVER store a bad
// token (which would silently break the session / look like a random logout).

const TOKEN_KEY = 'token'
const USER_KEY = 'user'
const LAST_ACTIVE_KEY = 'lastActiveAt'
// Rolling inactivity window: any use of the app resets this clock. Only truly
// walking away for this long logs someone out — daily/regular use never does.
const INACTIVITY_LIMIT_MS = 6 * 24 * 60 * 60 * 1000 // 6 days

function isValidToken(token) {
  return typeof token === 'string'
    && token.trim() !== ''
    && token !== 'undefined'
    && token !== 'null'
    && token !== 'local-user'
}

// Persist a login session. Throws if the server didn't return a usable token,
// so callers surface a clear error instead of storing a broken session.
export function saveSession(session) {
  const token = session && session.token
  if (!isValidToken(token)) {
    throw new Error('Login failed: the server did not return a valid session. Please try again.')
  }
  localStorage.setItem(TOKEN_KEY, token)
  if (session.user) localStorage.setItem(USER_KEY, JSON.stringify(session.user))
  // Fresh login = fully active — starts the 6-day inactivity clock from now.
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
}

export function getToken() {
  const token = localStorage.getItem(TOKEN_KEY)
  return isValidToken(token) ? token : ''
}

export function isAuthenticated() {
  return getToken() !== ''
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(LAST_ACTIVE_KEY)
  // Best-effort: also clear the long-lived server cookie (an HttpOnly cookie
  // can't be removed from JS directly). Without this, a cleared session —
  // manual logout OR the 6-day inactivity auto-logout — would just get
  // silently revived by tryRestoreSession() on the next app open. Older,
  // not-yet-rebuilt backends 404 here, which is fine to ignore.
  api.post('/auth/logout').catch(() => {})
}

// Rolling inactivity check: any real use of the app resets the clock, so daily
// (or even weekly-ish) use keeps someone logged in forever. Only actually
// walking away for INACTIVITY_LIMIT_MS logs them out — once, on their next
// visit or API call. Safe to call often; it's cheap and a no-op when logged out.
// Wrapped in try/catch: a storage exception here (private-browsing quota limits,
// storage disabled, etc.) must never break an API call or look like a logout.
export function checkAndTrackActivity() {
  try {
    if (!isAuthenticated()) return
    const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0)
    const now = Date.now()
    if (lastActive && now - lastActive > INACTIVITY_LIMIT_MS) {
      clearSession()
      const publicPaths = ['/', '/signin', '/signup']
      if (typeof window !== 'undefined' && !publicPaths.includes(window.location.pathname)) {
        window.location.href = '/signin?expired=1'
      }
      return
    }
    localStorage.setItem(LAST_ACTIVE_KEY, String(now))
  } catch { /* storage unavailable/blocked — never let this break a request */ }
}

// Silent session revival: if this device has no valid local token (e.g. it was
// closed and reopened and localStorage got cleared/evicted, or this is a fresh
// browser context), ask the backend whether its long-lived rc_token cookie is
// still valid. If so, restore the session without asking the user to sign in
// again — the cookie survives exactly the situations localStorage doesn't.
// Safe against an older, not-yet-rebuilt backend: a 404/network error here is
// swallowed and the app just behaves as it does today (falls through to sign-in).
export async function tryRestoreSession() {
  if (isAuthenticated()) return // fast path — already logged in, no network call needed
  try {
    const { data } = await api.get('/auth/session')
    if (data && data.token) saveSession(data)
  } catch { /* no valid cookie, offline, or backend not yet updated — stay logged out */ }
}

// On load, re-affirm a valid stored session so the app treats it as long-lived.
// (Installing the app to the home screen keeps this from being evicted by iOS.)
try {
  const stored = localStorage.getItem(TOKEN_KEY)
  if (stored && !isValidToken(stored)) localStorage.removeItem(TOKEN_KEY)
  checkAndTrackActivity() // catches a stale session the moment the app opens
} catch { /* storage unavailable */ }

// REQUEST SECURITY INTERCEPTOR: Automatically attaches your login session key (bearer token)
// to every query sent to the Python server, ensuring you only view your own projects.
api.interceptors.request.use((config) => {
  checkAndTrackActivity() // every API call both enforces and refreshes the rolling window
  // Retrieves token from browser storage (default to 'local-user' for demo mode)
  const token = localStorage.getItem('token') || 'local-user'
  config.headers.Authorization = `Bearer ${token}`
  return config
})

// CONNECTION ERROR HELPER: Intercepts server responses. If the Python server is off,
// it prints a helpful warning in plain English telling you to start the FastAPI server.
api.interceptors.response.use(
  response => response,
  error => {
    if (error?.message === 'Network Error') {
      error.message = `Cannot reach backend at ${API_BASE}. Make sure the backend is running: cd backend && npm start`
    }
    return Promise.reject(error)
  },
)
