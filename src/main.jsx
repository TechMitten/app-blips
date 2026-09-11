import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AnalyticsPage from './pages/AnalyticsPage.jsx'
import { initAnalytics } from './lib/analytics'

initAnalytics()

// No router dependency -- this is the only route outside the main SPA
// surface, so a plain pathname check picks the page to mount. Cloudflare
// Pages falls back to index.html for any unmatched path (see
// functions/[[path]].js's `next()` on the appblips.com hostname), so direct
// navigation/refresh on /analytics works the same as client-side nav.
const isAnalyticsRoute = window.location.pathname === '/analytics'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isAnalyticsRoute ? <AnalyticsPage /> : <App />}
  </StrictMode>,
)
