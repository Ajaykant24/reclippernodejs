// ── PWA INSTALL PROMPT: InstallPrompt.jsx ──
// Shows a tasteful "Install app" banner so users can add Reclipper to their home
// screen without hunting through the browser menu.
// - Android/Chrome: uses the `beforeinstallprompt` event to trigger the native
//   install sheet on tap.
// - iOS Safari: has no install API, so we show a short "Share → Add to Home
//   Screen" hint instead.
// The banner hides itself once the app is installed / running standalone, or if
// the user dismisses it (remembered in localStorage).

import { useEffect, useState } from 'react'

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [visible, setVisible] = useState(false)
  const [showIOSHelp, setShowIOSHelp] = useState(false)

  useEffect(() => {
    if (isStandalone()) return undefined
    if (localStorage.getItem('installDismissed') === '1') return undefined

    // Android / Chrome: capture the install event and reveal the button.
    const onBeforeInstall = event => {
      event.preventDefault()
      setDeferred(event)
      setVisible(true)
    }
    // Hide once installed.
    const onInstalled = () => {
      setVisible(false)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    // iOS has no beforeinstallprompt — show the hint banner instead.
    let iosTimer
    if (isIOS()) {
      iosTimer = setTimeout(() => setVisible(true), 1200)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      if (iosTimer) clearTimeout(iosTimer)
    }
  }, [])

  const dismiss = () => {
    setVisible(false)
    setShowIOSHelp(false)
    localStorage.setItem('installDismissed', '1')
  }

  const handleInstall = async () => {
    if (isIOS()) {
      setShowIOSHelp(true)
      return
    }
    if (!deferred) return
    deferred.prompt()
    try {
      await deferred.userChoice
    } catch {
      /* ignore */
    }
    setDeferred(null)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="install-banner" role="dialog" aria-label="Install Reclipper">
      <span className="install-banner-icon material-symbols-outlined">download</span>
      <div className="install-banner-copy">
        <strong>Install Reclipper</strong>
        {showIOSHelp ? (
          <small>Tap the Share icon, then “Add to Home Screen”.</small>
        ) : (
          <small>Add it to your home screen — opens like a real app.</small>
        )}
      </div>
      {!showIOSHelp ? (
        <button type="button" className="btn btn-solid-white btn-sm install-banner-cta" onClick={handleInstall}>
          Install
        </button>
      ) : null}
      <button type="button" className="install-banner-close" onClick={dismiss} aria-label="Dismiss">
        <span className="material-symbols-outlined">close</span>
      </button>
    </div>
  )
}
