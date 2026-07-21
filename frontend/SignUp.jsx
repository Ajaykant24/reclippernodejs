// ── CREATOR SIGN UP PAGE: SignUp.jsx ──
// - Purpose: Allows new users to create their own creator suite workspace account.
// - Features: Name, Email, and Password form inputs with minimum password length requirements, automatic registration requests to FastAPI, and error banners.
// - Editing Tip: To change the signup welcome copy, edit the text inside the `<h1>` and `<p>` tags.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, saveSession as persistSession } from './api/client'

export default function SignUpPage() {
  const navigate = useNavigate()
  
  // STATE MANAGEMENT: Local memory variables to track input values, display errors, and block double-clicks during server calls.
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState('')

  // REGISTRATION SUBMIT WORKFLOW:
  // - Triggers when you click "Create Account".
  // - Calls the backend API endpoint (`/auth/signup`) to hash the password and save the user.
  const submit = async event => {
    event.preventDefault() // Prevents page from doing a hard reload
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/signup', form)
      // New accounts are pending admin approval — no session is returned; show a
      // waiting message instead of entering the tool. (Admin accounts get a token.)
      if (data?.pending || !data?.token) {
        setPending(data?.message || 'Account created! An admin will review and approve it shortly.')
        return
      }
      // Safely caches the session (guards bad tokens) to maintain login.
      persistSession(data)
      // Redirects you to the main creator workspace
      navigate('/dashboard')
    } catch (err) {
      // Gathers error detail sent by FastAPI or defaults
      setError(err?.response?.data?.detail || err.message || 'Sign up failed.')
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
        {pending ? (
          <>
            <span className="eyebrow">Almost there</span>
            <h1>Request received</h1>
            <div className="info-box" style={{ margin: '4px 0 8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>hourglass_top</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{pending}</span>
            </div>
            <p>You'll be able to sign in as soon as an admin approves your account.</p>
            <Link className="btn btn-solid-white btn-lg" to="/signin">Go to Sign in</Link>
          </>
        ) : (
        <>
        <span className="eyebrow">Start the studio</span>
        <h1>Create your account</h1>
        <p>Launch a polished short-form workflow with projects, AI overlays, captions, editor controls, and export review.</p>

        {/* ERROR BOX: Renders a pinkish warning block if email is already taken or password invalid */}
        {error ? <div className="error-box">{error}</div> : null}

        {/* REGISTRATION INPUTS FORM: Uses flexbox stack spacing (.stack in index.css). */}
        <form className="stack" onSubmit={submit}>
          
          {/* Name input field */}
          <label className="stack" style={{ gap: 6 }}>
            <span className="text-label">Name</span>
            {/* Input is styled via .glass-input in index.css (dark semi-transparent box) */}
            <input 
              className="glass-input" 
              required 
              value={form.name} 
              onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))} 
            />
          </label>
          
          {/* Email input field */}
          <label className="stack" style={{ gap: 6 }}>
            <span className="text-label">Email</span>
            <input 
              className="glass-input" 
              type="email" 
              required 
              value={form.email} 
              onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))} 
            />
          </label>
          
          {/* Password input field (Must be at least 6 characters) */}
          <label className="stack" style={{ gap: 6 }}>
            <span className="text-label">Password</span>
            <input 
              className="glass-input" 
              type="password" 
              required 
              minLength={6} 
              value={form.password} 
              onChange={event => setForm(prev => ({ ...prev, password: event.target.value }))} 
            />
          </label>
          
          {/* SUBMIT BUTTON: Solid white button, disabled during pending request state */}
          <button className="btn btn-solid-white btn-lg" type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>

        </form>

        {/* BOTTOM REDIRECT LINK: Prompts existing users to sign in. */}
        <p className="auth-switch">
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
        </>
        )}

      </section>
    </div>
  )
}
