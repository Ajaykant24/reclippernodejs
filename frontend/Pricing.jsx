// ── PRODUCT PRICING TIERS GRID: Pricing.jsx ──
// - Purpose: Showcases subscription pricing options to the user.
// - Features: 3-column plan grid with bullet lists of included features, custom prices, and custom highlighting for the central "featured" Pro plan.
// - Editing Tip: If you want to change prices, names, or feature bullet points, look at the `plans` array below.

import { Link } from 'react-router-dom'

// PRICING TIERS DATABASE SCHEMA:
// Format for each row: [Plan Name, Price, Stat/Limit, Feature A, Feature B]
// - You can easily edit these text strings to change names, values, or bullets.
const plans = [
  ['Starter', '$19', '100 clips / month', 'AI overlay hooks', 'Caption panel'],
  ['Pro', '$79', '1,000 clips / month', 'Editor and export review', 'Priority renders'],
  ['Scale', '$249', 'Team workspaces', 'Bulk campaigns', 'Commercial support'],
]

export default function PricingPage() {
  return (
    /* 
      PAGE BASE LAYER: Workspace layout wrapper.
      - Styled by .workspace-page (index.css).
    */
    <div className="workspace-page mobile-page mobile-pricing-page">
      
      {/* HEADER HERO BANNER: Page title and marketing subhead. */}
      <header className="workspace-hero mobile-page-hero">
        <div>
          <span className="eyebrow">Plans</span>
          <h1>Pricing for daily clip production.</h1>
          <p>Pick the workspace size that matches your publishing volume.</p>
        </div>
      </header>

      {/* 
        PRICING CARD GRID CONTAINER:
        - Layout that aligns cards in columns.
        - Styled by .pricing-grid and .premium-pricing in index.css.
      */}
      <div className="pricing-grid premium-pricing mobile-card-stack stagger">
        {/* LOOPS THROUGH PLAN LIST: Takes each plan array entry and builds a card. */}
        {plans.map((plan, index) => (
          /* 
            INDIVIDUAL PLAN CARD:
            - Note: `index === 1` refers to the second tier ("Pro"). It automatically gets the extra CSS class "featured" 
              which gives it a glowing outline or distinct background in index.css (.pricing-plan.featured).
          */
          <article className={`pricing-plan${index === 1 ? ' featured' : ''}`} key={plan[0]}>

            {/* "Most popular" chip on the featured middle tier */}
            {index === 1 ? <span className="chip chip-accent" style={{ alignSelf: 'flex-start' }}>Most popular</span> : null}

            {/* Plan Name Tier (Starter / Pro / Scale) */}
            <h2>{plan[0]}</h2>
            
            {/* Price tag layout */}
            <strong>{plan[1]}<span>/mo</span></strong>
            
            {/* Bulleted feature list: Gathers all values from index 2 onwards */}
            <ul>
              {plan.slice(2).map(item => <li key={item}>{item}</li>)}
            </ul>
            
            {/* CTA ACTION BUTTON: Directs user to signup page. */}
            <Link className="btn btn-solid-white" to="/signup">Choose Plan</Link>
            
          </article>
        ))}
      </div>

    </div>
  )
}
