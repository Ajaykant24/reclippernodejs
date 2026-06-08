// ── LANDING / MARKETING HOMEPAGE: Home.jsx ──
// - Purpose: This is the very first page a visitor sees if they are not logged in.
// - Features: Includes a navigation header, a bold sales headline (hero section), an interactive mock mobile phone illustration, trust statistics, and key benefit columns.
// - Editing Tip: If you want to change the text content of your landing page, simply edit the text strings inside the tags below.

import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    /* 
      PAGE BASE LAYER: Marketing Page Wrapper.
      - Styled by .marketing-page and .premium-home in index.css.
    */
    <div className="marketing-page premium-home mobile-page mobile-home-page">
      
      {/* 
        MARKETING NAVIGATION HEADER:
        - Contains the "Reclipper" home logo and links to Pricing, Sign In, and a glowing CTA "Start Free" button.
        - CSS styles are defined under .marketing-nav and .premium-nav.
      */}
      <header className="marketing-nav premium-nav">
        
        {/* LOGO: Left-side brand title linking back to homepage. */}
        <Link className="marketing-brand" to="/">Reclipper</Link>
        
        {/* NAVIGATION LINKS: Right-side headers */}
        <nav>
          <Link to="/pricing">Pricing</Link>
          <Link to="/signin">Sign In</Link>
          {/* Glowing CTA Sign Up button with .marketing-signup styling */}
          <Link className="marketing-signup" to="/signup">Start Free</Link>
        </nav>

      </header>

      {/* 
        HERO BANNER: The primary high-impact introduction section.
        - Spans two columns on desktop: Sales pitch copy on the left, visual phone mockup graphics on the right.
        - CSS styles: .premium-hero
      */}
      <section className="premium-hero mobile-home-hero">
        
        {/* LEFT COLUMN: Main sales text copy and call-to-action links */}
        <div className="premium-hero-copy">
          <span className="eyebrow">Creator operating room</span>
          <h1>Clip, caption, and publish without friction.</h1>
          <p>Reclipper turns source video into mobile-first reels with AI overlay hooks, editable previews, and a clean export handoff built for daily posting.</p>
          
          {/* CTA ACTION BUTTONS: Link to registration or direct tool launch. */}
          <div className="hero-actions">
            {/* White solid button (starts signup) */}
            <Link className="btn btn-solid-white btn-lg" to="/signup">Build My Workspace</Link>
            {/* Transparent glass button (opens editor tool directly) */}
            <Link className="btn btn-glass btn-lg" to="/tool">Open Tool</Link>
          </div>
        </div>

        {/* 
          RIGHT COLUMN: Mockup Mobile Phone Graphic representation.
          - Re-creates a 9:16 mobile phone simulator using pure HTML and CSS (no heavy images needed).
          - Styled by .premium-phone-stage and .premium-phone in index.css.
        */}
        <div className="premium-phone-stage" aria-hidden="true">
          <div className="premium-phone">
            
            {/* Phone speaker topbar notch */}
            <div className="phone-topbar" />
            
            {/* Phone video frame representation with simulated overlay hook texts inside */}
            <div className="phone-video">
              <span>AI Hook</span>
              <strong>when the clip finally hits</strong>
            </div>
            
            {/* Phone caption representation panel */}
            <div className="phone-caption-row">
              <span>Caption</span>
              <b>Copied</b>
            </div>
            
            {/* Phone bottom success badge */}
            <div className="phone-action">Export ready</div>

          </div>
        </div>

      </section>

      {/* 
        SOCIAL PROOF / KEY STATS ROW:
        - Displays highlights of key product features (hooks count, caption panel, ratio).
        - Styled by .premium-proof in index.css.
      */}
      <section className="premium-proof mobile-stat-strip">
        <div><strong>20</strong><span>overlay hooks per clip</span></div>
        <div><strong>1</strong><span>caption panel for posting</span></div>
        <div><strong>9:16</strong><span>mobile preview workflow</span></div>
      </section>

      {/* 
        FEATURES COLUMNS GRID:
        - 3-column list explaining product capabilities with custom Google Material icons.
        - Styled by .premium-feature-grid in index.css.
      */}
      <section className="premium-feature-grid mobile-feature-list">
        
        {/* Column 1: AI Hooks */}
        <article>
          <span className="material-symbols-outlined">auto_awesome</span>
          <h2>Generate better hooks</h2>
          <p>Gemini creates punchy overlay options from the clip context so each reel starts with a stronger first second.</p>
        </article>
        
        {/* Column 2: Editor */}
        <article>
          <span className="material-symbols-outlined">edit_square</span>
          <h2>Edit in one place</h2>
          <p>Adjust ratio, background, text, captions, and export settings without jumping across messy screens.</p>
        </article>
        
        {/* Column 3: Exports */}
        <article>
          <span className="material-symbols-outlined">ios_share</span>
          <h2>Export with the caption</h2>
          <p>Review the final video, download it, and copy the caption from the same mobile-friendly page.</p>
        </article>

      </section>
    </div>
  )
}
