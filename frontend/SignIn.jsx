// ── CREATOR SIGN IN PAGE: SignIn.jsx ──
// - Purpose: Allows existing users or demo testers to login to their workspace.
// - Features: Glassmorphism inputs (Email, Password), inline error boxes, submit spinner triggers, and a fast demo shortcut login.
// - Editing Tip: To change the login prompt text, edit the `<h1>` and `<p>` strings inside the card.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, saveSession as persistSession } from './api/client'

export default function SignInPage() {
  const navigate = useNavigate()
  
  // STATE MANAGEMENT: Local memory variables to track inputs, error states, and loading spinners.
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // SESSION CACHER: Safely stores the session token + user (guards bad tokens),
  // then redirects you to /dashboard.
  const saveSession = session => {
    persistSession(session)
    navigate('/dashboard')
  }

  // STANDARD FORM SUBMIT CALLBACK:
  // - Triggers when you click "Sign In".
  // - Sends an API request (`/auth/signin`) to the FastAPI backend.
  const submit = async event => {
    event.preventDefault() // Prevents page from doing a hard reload
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/signin', form)
      saveSession(data)
    } catch (err) {
      // Captures error message sent by FastAPI backend or displays fallback message
      setError(err?.response?.data?.detail || err.message || 'Sign in failed.')
    } finally {
      setLoading(false)
    }
  }

  // DEMO SHORTCUT CALLBACK:
  // - Triggers when you click "Try Demo" button.
  // - Automatically logs you in with a pre-configured local account so you don't have to create one.
  const demo = async () => {
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/demo')
      saveSession(data)
    } catch (err) {
      setError(err?.message || 'Demo sign-in failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    /* 
      AUTH BASE LAYER: Centered authentication viewport wrapper.
      - Styled by .auth-shell (index.css).
    */
    <div className="auth-shell mobile-page mobile-auth-page">
      
      {/* 
        AUTH CARD WRAPPER:
        - The centered container holding the form elements.
        - Styled by .auth-card in index.css (glass borders, box shadows).
      */}
      <section className="auth-card mobile-auth-card">
        <span className="eyebrow">Welcome back</span>
        <h1>Sign in to Reclipper</h1>
        <p>Continue to your projects, editor, export review, and caption workflow.</p>

        {/* ERROR MESSAGE ALERT PANEL: Only visible if a login failure occurs. */}
        {error ? <div className="error-box">{error}</div> : null}

        {/* LOGIN INPUTS FORM: Uses flexbox stack spacing (.stack in index.css). */}
        <form className="stack" onSubmit={submit}>
          
          {/* Email input field */}
          <label className="stack" style={{ gap: 6 }}>
            <span className="text-label">Email</span>
            {/* Input is styled via .glass-input in index.css (dark semi-transparent box) */}
            <input 
              className="glass-input" 
              type="email" 
              required 
              value={form.email} 
              onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))} 
            />
          </label>
          
          {/* Password input field */}
          <label className="stack" style={{ gap: 6 }}>
            <span className="text-label">Password</span>
            <input 
              className="glass-input" 
              type="password" 
              required 
              value={form.password} 
              onChange={event => setForm(prev => ({ ...prev, password: event.target.value }))} 
            />
          </label>
          
          {/* SUBMIT BUTTON: Solid white button, disabled during pending request state */}
          <button className="btn btn-solid-white btn-lg" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

        </form>

        {/* DEMO SHORTCUT BUTTON: Styled in semi-transparent glass (.btn-glass in index.css) */}
        <button 
          className="btn btn-glass" 
          type="button" 
          onClick={demo} 
          disabled={loading} 
          style={{ width: '100%', marginTop: 10 }}
        >
          Try Demo
        </button>

        {/* BOTTOM REDIRECT LINK: Prompts new users to visit the SignUp page. */}
        <p className="auth-switch">
          No account yet? <Link to="/signup">Create one</Link>
        </p>

      </section>
    </div>
  )
}
