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
