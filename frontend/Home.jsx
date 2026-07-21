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
          <h1>Clip, caption, and publish <span className="text-gradient">without friction.</span></h1>
          <p>Reclipper turns source video into mobile-first reels with AI overlay hooks, editable previews, and a clean export handoff built for daily posting.</p>
          
          {/* CTA ACTION BUTTONS: Link to registration or direct tool launch. */}
          <div className="hero-actions">
            {/* White solid button (new users -> create account) */}
            <Link className="btn btn-solid-white btn-lg" to="/signup">Build My Workspace</Link>
            {/* Transparent glass button (returning users -> sign in) */}
            <Link className="btn btn-glass btn-lg" to="/signin">Sign In</Link>
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
      {/*
        HOW IT WORKS — three numbered steps connected by a gradient rail.
        Styled by .how-section / .how-grid in index.css.
      */}
      <section className="how-section">
        <div className="section-heading">
          <span className="eyebrow">How it works</span>
          <h2>Three steps. No timeline scrubbing.</h2>
        </div>
        <div className="how-grid stagger">
          <article className="how-step surface">
            <span className="how-num">01</span>
            <h3>Drop your video</h3>
            <p>Upload any MP4, MOV, or WEBM — then leave the page. Everything renders in the background.</p>
          </article>
          <article className="how-step surface">
            <span className="how-num">02</span>
            <h3>AI cuts &amp; hooks it</h3>
            <p>Smart crop finds the action, and AI writes 20 overlay hooks so the first second actually stops thumbs.</p>
          </article>
          <article className="how-step surface">
            <span className="how-num">03</span>
            <h3>Export with caption</h3>
            <p>Download the finished reel and copy its Instagram caption from the same screen. Post. Repeat.</p>
          </article>
        </div>
      </section>

      {/*
        FEATURE BENTO — one large editor-mock showcase card + four compact feature cards.
        Styled by .bento-marketing in index.css.
      */}
      <section className="bento-marketing">
        <div className="section-heading">
          <span className="eyebrow">The toolkit</span>
          <h2>Everything a clipper needs, nothing they don't.</h2>
        </div>
        <div className="bento-marketing-grid stagger">

          {/* Large showcase: a CSS-drawn miniature of the editor */}
          <article className="bento-feature bento-feature-lg surface surface-hover">
            <div className="mini-editor" aria-hidden="true">
              <div className="mini-editor-stage">
                <div className="mini-editor-video">
                  <span className="mini-hook-text">nobody talks about this side of the game</span>
                </div>
              </div>
              <div className="mini-editor-controls">
                <div className="mini-row"><span /><i style={{ width: '72%' }} /></div>
                <div className="mini-row"><span /><i style={{ width: '48%' }} /></div>
                <div className="mini-row"><span /><i style={{ width: '61%' }} /></div>
              </div>
            </div>
            <h3>A real editor, built for phones</h3>
            <p>Reposition, recolor, and rewrite the overlay on a live preview — then export in one tap.</p>
          </article>

          <article className="bento-feature surface surface-hover">
            <span className="material-symbols-outlined">auto_awesome</span>
            <h3>20 AI hooks per clip</h3>
            <p>Punchy overlay options written from the clip's actual context.</p>
          </article>

          <article className="bento-feature surface surface-hover">
            <span className="material-symbols-outlined">crop</span>
            <h3>Smart crop</h3>
            <p>Finds the subject and reframes to 9:16, 4:5, 1:1, or 16:9 automatically.</p>
          </article>

          <article className="bento-feature surface surface-hover">
            <span className="material-symbols-outlined">content_copy</span>
            <h3>Captions included</h3>
            <p>Every clip ships with a ready-to-paste Instagram caption.</p>
          </article>

          <article className="bento-feature surface surface-hover">
            <span className="material-symbols-outlined">rocket_launch</span>
            <h3>Fire &amp; forget</h3>
            <p>Hit generate and close the tab — clips land in Projects when ready.</p>
          </article>

        </div>
      </section>

      {/*
        FINAL CTA — glowing gradient panel.
        Styled by .final-cta in index.css.
      */}
      <section className="final-cta surface">
        <div className="final-cta-glow" aria-hidden="true" />
        <h2>Start clipping tonight.</h2>
        <p>Upload one video and watch it come back as post-ready reels.</p>
        <div className="hero-actions" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-solid-white btn-lg" to="/signup">Build My Workspace</Link>
          <Link className="btn btn-glass btn-lg" to="/pricing">See Pricing</Link>
        </div>
      </section>

      {/*
        FOOTER — brand, links, copyright.
        Styled by .marketing-footer in index.css.
      */}
      <footer className="marketing-footer">
        <div className="marketing-footer-inner">
          <div>
            <Link className="marketing-brand" to="/">Reclipper</Link>
            <p>The clipping workflow, minus the friction.</p>
          </div>
          <nav>
            <Link to="/pricing">Pricing</Link>
            <Link to="/signin">Sign In</Link>
            <Link to="/signup">Create Account</Link>
          </nav>
        </div>
        <div className="marketing-footer-legal">© {new Date().getFullYear()} Reclipper. All rights reserved.</div>
      </footer>
    </div>
  )
}
