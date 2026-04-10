# Changelog

## 0.8.0 — 2026-04-10

### Added
- **Interactive price history page** — any loaded ticker now has a `Price chart →` link next to the StockAnalysis link. Opens a dedicated page with an interactive price chart and Today / 5D / 1M / YTD / 1Y / 5Y / Max range buttons. Powered by a new `/api/priceHistory` serverless endpoint that calls `yahooFinance.chart()` with the right interval per range (5m for intraday, 1d for monthly, 1wk for 5Y, 1mo for Max). Line color flips green/red based on the period's total return. Routed via `?view=price` so URLs remain shareable.

## 0.7.4 — 2026-04-04

### Fixed
- **LTM revenue now computed from quarterly data** — `financialData.totalRevenue` was returning single-quarter figures for some companies (MAR showed $7B instead of $26B, HLT similarly off); now sums the last 4 quarters from `fundamentalsTimeSeries` for revenue, gross profit, EBITDA, OCF, and FCF; falls back to `financialData` when quarterly data is unavailable

## 0.7.3 — 2026-04-04

### Changed
- **Single external link** — removed Investor Relations link (Yahoo's `irWebsite` was missing for ~half of tickers, falling back to generic corporate sites); single StockAnalysis link covers financials, ratios, and SEC filings
- **Sector rationale always visible** — moved back out of collapsed description to a compact line above the pills section

## 0.7.2 — 2026-04-04

### Changed
- **External links slimmed to 2** — removed broken Quartr link (404, wrong URL format), broken SEC EDGAR links (deprecated endpoint), and redundant Yahoo Finance link; replaced with compact text-style StockAnalysis + dynamic Investor Relations link (uses company's IR website from Yahoo Finance, falls back to corporate site)
- **Period toggle fixed** — replaced misleading 3Y/5Y/10Y with 3Y/All; Yahoo Finance only provides ~4 years of annual data, so 5Y and 10Y were always showing the same 4 years
- **Sector recommendation banner** folded into the collapsible company description — appears when "more" is expanded
- **Period toggle and group tabs** merged into a single row — group tabs left, period buttons right
- **Regime badge** inlined with pills section header instead of standalone row
- **Chart legend line** removed (self-explanatory)
- **Removed 2 redundant "Data: Yahoo Finance"** occurrences (links row badge + footer); kept header attribution

## 0.7.1 — 2026-04-04

### Fixed
- **Comps quality overhaul** — replaced Yahoo Finance's `recommendationsBySymbol` (which selected peers by trading pattern correlation, producing irrelevant results like Boeing for Netflix) with curated analyst-style comp sets for ~200 commonly analyzed stocks across 35 industry groups; falls back to Yahoo Finance industry classification for uncovered tickers; quality gate requires 3+ peers or shows nothing rather than garbage

## 0.7.0 — 2026-04-04

### Added
- **Comps table** — auto-discovers comparable companies and displays LTM multiples side-by-side; subject company highlighted in blue with green/red coloring vs peer median; metrics auto-selected based on sector recommendations
- **New `/api/comps` endpoint** — fetches peer data and parallel-loads LTM multiples for up to 8 peers
- Clicking any peer row navigates to that company's full ValuScope dashboard

## 0.6.0 — 2026-04-04

### Added
- **Sector-aware metric recommendations** — auto-detects the stock's sector (via Yahoo Finance) and suggests the most relevant valuation multiples; charts auto-populate with recommended metrics on load (e.g., P/B & P/E for Financials, EV/EBITDA & EV/Sales for Tech)
- **Sector insight banner** — concise explanation below validation links explaining why certain metrics matter for this sector
- **Visual recommendation indicators** — recommended group tab gets a blue dot, recommended metrics within each group get a subtle blue border and dot; all metrics remain accessible

## 0.5.0 — 2026-03-26

### Added
- **Shareable/bookmarkable URLs** — loading a company updates the URL to `?ticker=AAPL`; direct links and page refreshes restore the company automatically; share button (link icon) in company header copies the current URL to clipboard with a "Copied" checkmark flash
- **3Y / 5Y / 10Y period toggle** — selector above the chart tabs controls how many historical years are shown in the chart, data table, and averages; API now fetches up to 10 fiscal years
- **Market cap and EV in company header** — displayed alongside price and daily change (e.g., `Mkt Cap $2.94T · EV $2.81T`)
- **Forward estimates in Signals panel** — Forward P/E (NTM) and PEG ratio from Yahoo Finance analyst consensus; PEG color-coded green <1×, neutral 1–2×, red >2×

### Fixed
- **TTM EBIT now computed correctly** — uses `financialData.operatingMargins × TTM revenue` (a genuine TTM figure) instead of the prior FY proxy that was flagged in v0.3.1 CHANGELOG

## 0.4.0 — 2026-03-26

### Added
- **Two new chart metric groups** — "Growth & Margins" (Rev. Growth, Gross/EBITDA/Operating/Net/FCF Margin) and "Leverage & Returns" (ND/EBITDA, Interest Coverage, Current Ratio, ROIC) with full formula and period tooltips
- **FundamentalsPanel** — compact analytics card below the chart with four sections: Growth CAGRs (1yr/3yr/5yr revenue, 1yr/3yr EBITDA), Margins (LTM with trend arrows vs 3yr avg), Leverage (Net Debt, ND/EBITDA, Interest Coverage, Current Ratio, ROIC with color-coded risk signals), and Signals (Beta, Insider Ownership, Short Interest, Dividend Yield)
- **Fair Value Estimator** — "If we return to the historical average…" table showing implied price and upside/downside for P/E, EV/EBITDA, P/FCF, P/S, EV/Sales, plus a blended median estimate
- **Valuation Regime badge** — single-word verdict (Deep Value / Undervalued / Fair Value / Stretched / Expensive) computed as avg percentile of pill metrics, shown inline above the pills row
- **My Thesis** — per-ticker localStorage investment notes with auto-save (debounced 500ms), relative timestamp, character count, and "Saved" flash indicator; collapses when empty
- **Quartr and SEC 8-K links** added to company header external links row

### Changed
- `api/financials.js` now extracts interest expense, tax provision, current assets/liabilities and computes 10 derived per-year fields (margins, leverage ratios, ROIC, revenue growth) plus 5 top-level signal fields (beta, dividendYield, insiderOwnershipPct, institutionalPct, shortInterestPct)
- Chart `chartData` construction now allows negative metric values (e.g., negative revenue growth, net cash position) instead of coercing to null
- `isYield` flag (% formatting on chart Y-axis) now also applies to "Growth & Margins" group

## 0.3.1 — 2026-03-26

### Fixed (Data Quality)
- **Historical market cap now uses period-end shares** (`commonStockSharesOutstanding` from balance sheet) instead of weighted-average diluted shares (`dilutedAverageShares`). Diluted average shares is an EPS figure, not correct for computing a point-in-time market cap.
- **EV formula now includes minority interest** (noncontrolling interest) for both historical and Now periods. Standard EV = Market Cap + Debt + Minority Interest − Cash. Omitting minority interest caused EV-based multiples to be understated for companies with consolidated subsidiaries.
- **"Now (LTM)" EV/EBIT now populated** using most recent fiscal year EBIT as a proxy (TTM EBIT is not available from the Yahoo Finance API; the tooltip makes this approximation clear).
- **"Now (LTM)" net income now populated** — derived as Market Cap ÷ Trailing P/E.
- **"Now (LTM)" buyback yield now populated** — uses most recent annual repurchase figure from cash flow series ÷ current market cap.
- **"Now (LTM)" shares outstanding now populated** — derived as Market Cap ÷ Current Price.

### Added
- **Calculation tooltips** on every metric: formula (e.g., "Enterprise Value ÷ EBITDA") and period note (e.g., "Now: current EV ÷ TTM EBITDA") shown in the Pill detail bottom sheet and as hover tooltips on DataTable metric name cells.

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
