// ── BACKEND CONNECTOR CLIENT: client.js ──
// - Purpose: Establishes a communication bridge between your web interface (frontend) and your Python server (backend).
// - How it works: It handles authentication headers (user session tracking) and formats friendly connection error alerts.
// - Editing Tip: If your backend server changes, update the Render URL below or set VITE_API_URL in "frontend/.env".

import axios from 'axios'

// SERVER BASE URL: The web address where your Python FastAPI server is running.
// - Falls back to the production backend if no environmental variable is set.
export const API_BASE = import.meta.env.VITE_API_URL || 'https://clippar.online/'

// CLIENT INSTANCE: Configures a reusable connector with the base address preset.
export const api = axios.create({
  baseURL: API_BASE,
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
}

// On load, re-affirm a valid stored session so the app treats it as long-lived.
// (Installing the app to the home screen keeps this from being evicted by iOS.)
try {
  const stored = localStorage.getItem(TOKEN_KEY)
  if (stored && !isValidToken(stored)) localStorage.removeItem(TOKEN_KEY)
} catch { /* storage unavailable */ }

// REQUEST SECURITY INTERCEPTOR: Automatically attaches your login session key (bearer token)
// to every query sent to the Python server, ensuring you only view your own projects.
api.interceptors.request.use((config) => {
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
