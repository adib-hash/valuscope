# Changelog

## 0.3.0 — 2026-03-26

### Added
- **Light/dark mode toggle** — sun/moon icon in header; persists to localStorage; flash-free init via inline script in `index.html`; full CSS custom property system for both themes
- **Settings modal** — gear icon in header opens slide-in modal showing app version, data source, theme toggle, and watchlist count; background scroll locked using `position: fixed` pattern
- **Watchlist** — star icon on company header saves/removes tickers to localStorage (cap 20); watchlist section appears above Quick Tickers on empty state
- **Pill range bar** — each metric pill now shows a horizontal min/max track bar with an amber avg tick and a colored dot at current position
- **Percentile badge** — each pill shows what percentile the current value sits at vs. historical data
- **Pill detail bottom sheet** — tapping any pill opens a slide-up sheet with a single-metric mini chart and year-by-year data table; closes on Escape or backdrop tap
- **Company description** — collapsible `longBusinessSummary` from Yahoo Finance, truncated to 150 chars with "more/less" toggle
- **Loading skeleton** — `animate-pulse` skeleton cards replace the pulsing dots loading state
- **Scroll snapping for pills** — pills row uses `snap-x snap-mandatory` for clean swipe behaviour on mobile

### Changed
- Header logo "ValuScope" is now a clickable reset button (`aria-label="ValuScope home"`)
- Empty state bar-chart icon is now an inline SVG (was `📊` emoji — CLAUDE.md violation)
- DataTable toggle chevron is now an inline SVG (was Unicode `▼`/`▲` — CLAUDE.md violation)
- Chart height is now adaptive: `h-[260px] sm:h-[350px] md:h-[420px]` (was fixed 350px)
- Viewport meta now includes `maximum-scale=1` to prevent iOS auto-zoom on input focus
- All Recharts hardcoded colors now derive from theme CSS variables via `isDark` prop

## 0.2.0 — 2026-03-26

### Changed
- Switched data source from Financial Modeling Prep (FMP) to Yahoo Finance via `yahoo-finance2`
  - FMP deprecated their v3 API endpoints for accounts created after August 2025
  - No API key required; yahoo-finance2 uses Yahoo Finance's public data
  - Historical valuation multiples now computed from annual financial statements + historical monthly prices
  - Search now powered by Yahoo Finance's search endpoint
- Removed `FMP_API_KEY` dependency (no environment variables needed)
- Updated data attribution in header and footer

## 0.1.0 — 2026-03-26

### Added
- Initial scaffolding: React + Vite + Tailwind CSS + Recharts
- Vercel serverless API routes proxying FMP (no CORS issues)
- Ticker search with autocomplete via FMP search endpoint
- 5-year historical valuation multiples dashboard
  - Price Multiples: P/E, P/S, P/B, P/Gross Profit, P/FCF, P/OCF
  - EV Multiples: EV/EBITDA, EV/Sales, EV/Gross Profit, EV/EBIT, EV/FCF, EV/OCF
  - Yield Metrics: Earnings Yield, FCF Yield, Buyback Yield
- Interactive chart with toggleable metrics and dashed average reference lines
- Summary pills (current vs. historical avg with above/below indicators)
- Expandable full data table with raw fundamentals
- Validation links: StockAnalysis ratios, SEC EDGAR 10-Ks, Yahoo Finance
- Recent search history
- Quick-launch ticker buttons
- Dark theme matching ihsan.build design system
