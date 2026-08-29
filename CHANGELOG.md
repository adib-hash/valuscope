# Changelog

## 0.15.2 — 2026-08-28

### Changed
- **Renamed the app to ValueScope.** The display name now reads ValueScope everywhere it is user-visible: the browser title, the header logo and its `aria-label`, and the App row in Settings. The SEC EDGAR User-Agent was updated to match, since that string is how the app identifies itself to the SEC.

### Notes
- Infrastructure identifiers were left alone on purpose. The domain is still `valuscope.ihsan.build`, the repo is still `adib-hash/valuscope`, and the package name and Vite dev-plugin slug still read `valuscope`. Changing those means moving DNS and the GitHub remote, which is a separate decision from what the app calls itself.
- Older changelog entries keep the original spelling, because they describe what shipped at the time.

## 0.15.1 — 2026-07-31

### Changed
- **Index returns are now a heat map** rather than red-or-green text. Each timeframe column gets its own colour scale spanning every market, so a column reads as a ranking at a glance instead of a list of signs.
- **Scaled per column across all rows, not per section.** The Global section has one row and Emerging has two — a per-section scale would paint the 2.3-point gap between MSCI India and MSCI China as the entire spectrum, which says something the data does not.
- **Anchored at zero, not at the column's range.** Green always means the market made money. Scaling to the range instead would have rendered real estate up 15.4% in red purely for lagging energy, which reads as a loss.
- The shading curve sits below linear so mid-range cells stay legible instead of washing out behind one outlier — energy at +39% would otherwise flatten the rest of the 1-year column.
- Values are now neutral high-contrast text on a tinted cell, so the background carries the signal and the number stays readable. A legend under the toggle shows the ramp.

### Notes
- Tint ceiling is 0.42 alpha, set by contrast rather than taste. Measured against `vs-text`, green in dark mode is the binding case: 0.42 leaves 5.2:1, while 0.55 drops to 3.87:1 and fails AA. Verified on the rendered cells — worst case is 5.38:1 in dark and 9.19:1 in light, against a 4.5:1 floor.
- Colour is redundant encoding here, never the only channel: every cell still shows its signed number, so the table is readable without distinguishing red from green.
- The day-change column keeps its sign colouring. It is a different kind of number from a period return and is not part of the cross-market comparison.

## 0.15.0 — 2026-07-31

### Added
- **13F holdings browser.** A new top-level `13F` view. Search an investor by name, pick a quarter, and read their portfolio: every position by size, with percentage of book, share count and a link into that company's ValuScope page. Roughly ten years of quarters are available per manager.
- **Quarter-over-quarter changes.** A second tab diffs the filing against the previous one and labels each position new, added, trimmed, exited or held, with the change in shares. This is the part of a 13F that actually says something — a portfolio snapshot tells you what someone owns, the diff tells you what they decided.
- **Positions link into the rest of the app.** 13Fs identify securities by CUSIP and a shouty issuer name ("WELLS FARGO & CO NEW"), never a ticker. CUSIPs are resolved through OpenFIGI, free and keyless, so a holding is one click from its valuation history. Unresolved rows keep their issuer name rather than disappearing.
- Options are kept as separate rows from the underlying rather than folded into the share count, so a manager holding puts reads as holding puts.

### Notes
- New `/api/institutions` and `/api/holdings` endpoints, plus `api/_lib/edgar13f.js`. Entirely keyless: EDGAR full-text search resolves a name to a CIK, the submissions API lists that filer's 13Fs, and the filing's information table XML is parsed directly.
- **Values changed units in 2023.** Filings made before January 2023 report the value column in thousands; from 2023 onward in whole dollars. Verified against real filings — Berkshire's 2016 Q3 portfolio totals $128.8B once scaled, and every implied share price lands on a real 2016 price. Miss this and every older portfolio renders a thousand times too small.
- **A filing's rows are not its positions.** The same security appears once per managing entity, so Berkshire's Q1 2026 filing is 90 rows covering 29 actual positions. Rows are combined by CUSIP; the raw-to-combined count is stated under each table.
- The information table filename is not stable across years — `form13fInfoTable.xml` in 2016, `53405.xml` in 2026 — so it is located through the filing's `index.json` rather than guessed.
- Every table carries what a 13F does not tell you: filings arrive up to 45 days after quarter-end, and they cover US-listed long equity only, so short positions, bonds, cash and foreign holdings never appear. A portfolio that looks live but is six weeks stale is worth labelling as such.
- Ticker resolution fails soft. OpenFIGI being slow or throttled costs the links, not the page.

## 0.14.0 — 2026-07-31

### Added
- **World indices tab.** A new top-level `Indices` view, reachable without loading a company, showing YTD, 1-year, and annualised 3-, 5- and 10-year returns for eleven markets: MSCI ACWI, the S&P 500, NASDAQ, FTSE 100, Nikkei 225, MSCI India, MSCI China, US real estate, energy, US bonds, and the VIX. Each row carries a five-year sparkline rebased to 100.
- **Two return bases, switchable.** This is the whole design of the feature. Measured on price alone, US bonds returned roughly **-1.5% a year** over the last decade; with coupons reinvested they returned **+1.3%**. Real estate is +0.7% against +4.8% on the same split. For bonds and property the income *is* the return, so a single table quoting price-only figures would not be a simplification, it would be wrong. Rather than pick one basis quietly, both are offered: **Total return · USD** (dividends and coupons reinvested, everything in dollars, every row comparable) and **Price · local** (the indices themselves in their own currency, matching the headline numbers in the press).
- Every row names the instrument it actually measured — `via SPY`, `via ^GSPC` — so the table never hides what is behind a number.
- **The VIX is reported as a level, not a return.** It mean-reverts around 15-20 rather than trending, so compounding it produces a meaningless figure. It gets its own row shape: current level, its ten-year range and median, and where today sits in that decade.

### Notes
- New `/api/indices` endpoint. Keyless, on Yahoo Finance, like the rest of the app. Eleven daily series over eleven years is one batch quote plus eleven chart calls, about 700ms cold, cached at the edge for an hour.
- FTSE 100 and Nikkei 225 have no free total-return series, so MSCI UK and MSCI Japan ETFs stand in on that basis. Those rows are labelled `proxy` — they are genuinely different indices, and pretending otherwise would be the kind of quiet substitution this feature exists to avoid.
- Annualised figures are suppressed rather than estimated where an instrument lacks the history to cover the window. MSCI India only lists back to 2012, so it has no true fifteen-year number and does not invent one.
- Views are no longer required to have a ticker loaded. `App.jsx` gained `openGlobalView` alongside `openView`, and `/?view=indices` is a deep link that survives a refresh.
- Contrast: this page uses `vs-soft` rather than `vs-dim` for small labels. `vs-dim` measures 3.29:1 on card in dark mode and 4.07:1 on card2 in light — both below the 4.5:1 AA floor, which matters more here than elsewhere given the deliberately dense 9-13px scale.

## 0.13.0 — 2026-07-28

### Added
- **AI summary of earnings calls.** A "Summarize this call" button on the transcript page produces an overview plus key takeaways, financial highlights, guidance, what analysts pressed on, and the risks management acknowledged. Powered by Gemini 3.6 Flash on the free tier.
- It only runs when asked. Nothing is generated on page load — the call takes 10–15 seconds, and an unrequested AI summary isn't something a valuation tool should be pushing at you.
- The prompt is deliberately extractive: grounded strictly in the transcript, no outside knowledge, forward-looking statements attributed to management rather than asserted as fact, and no price view or recommendation of any kind. A response schema keeps the sections stable. Output is labelled AI-generated and carries a not-financial-advice note.
- A summary is a pure function of a transcript that never changes once published, so responses are edge-cached for 30 days — any given quarter is generated once and then served from cache.

### Notes
- Requires `GEMINI_API_KEY` (free, no card, from https://aistudio.google.com/apikey). Deployments without one hide the button entirely rather than offering an action that can only fail.
- `api/summarize.js` runs with `maxDuration: 60`. Vercel's default 10s ceiling would have failed every request — generation takes about 11s for Apple and 15s for Costco's longer call.

## 0.12.0 — 2026-07-28

### Added
- **Earnings call transcripts.** Every ticker now has an `Earnings call →` view with the full transcript, speaker by speaker, split into prepared remarks and Q&A. A quarter picker reaches back through everything on file (83 quarters for Apple, back to 2005), and a search box filters the call to matching passages with the term highlighted. Body type is deliberately larger here than the rest of the app — this is prose to read, not a table to scan.
- **New `/api/transcript` endpoint.** The source is the defeatbeta community dataset: a single 2.2 GB Parquet file of ~235k transcripts on HuggingFace, free and keyless, rebuilt daily. It is obviously not downloadable, but its row groups are sorted by ticker with min/max statistics, so a company's transcripts can be located and pulled with HTTP range requests — a few KB for the quarter list, about 2 MB for a full call. Transcripts never change once published, so responses are edge-cached for a week.
- **Alpha Vantage fallback** for when that dataset goes stale or moves. Entirely optional: set `ALPHAVANTAGE_API_KEY` to enable it. Without the key the app simply relies on the primary source. Its free tier allows 25 requests a day, which is why it is not the primary.

### Fixed
- **Shared links to a sub-view now work.** Opening `?ticker=AAPL&view=price` loaded the company and then immediately reset the URL to just the ticker, dropping you on the dashboard. The view is now preserved when loading from a link — this also affected the price chart, which has been shareable-but-broken since 0.8.0.
- **The ticker search box could trigger iOS auto-zoom.** A `text-[15px]` class was overriding the 16px floor that keeps iOS from zooming the page on focus. Now 16px on mobile, 15px from the `sm` breakpoint up.
- **Transcript dates were a day early** west of UTC — a plain `YYYY-MM-DD` parsed as UTC midnight rendered as the previous day. Dates are now built in local time.

## 0.11.1 — 2026-07-28

### Fixed
- **Light mode was failing contrast across the app.** The accent palette was declared once and shared by both themes, but the values were tuned for a near-black background: green read 1.8:1 against a white card where WCAG AA wants 4.5:1, and the valuation regime badge was effectively invisible. An audit found 39 failing elements, spread across the fair value table, fundamentals panel and the new earnings panel. Light and dark now carry separate accent values, and the light neutrals were deepened too (`--vs-dim` 3.05:1 → 4.56:1). Re-audited with proper alpha compositing: **0 failing elements in either theme**, down from 39.
- **Theme colours are no longer hard-coded in components.** 98 literal hex values across 11 files became `rgb(var(--vs-*))` references, so a colour can never again be right in one theme and wrong in the other. Chart strokes, axis ticks and reference lines all follow the theme now — previously the price chart's axis labels were dark-theme grey regardless of theme.
- Added `tint()` in `src/lib/metrics.js` for translucent variants, replacing the `` `${color}12` `` hex-alpha concatenation that CSS variables can't support.

## 0.11.0 — 2026-07-28

### Added
- **Watchlist command centre.** The landing page used to show the watchlist as a row of bare ticker chips. It is now a live dashboard: every saved ticker with its price, today's move, valuation regime, percentile against its own long-run history, distance to blended fair value, and next earnings date. Sortable by cheapest (the default), today's move, or alphabetically — so the first thing you see on opening the app is which of your names is cheapest relative to its own record.
- **New `/api/overview` endpoint** — a single batched Yahoo `quote` call covers the whole watchlist regardless of length, so the landing view stays cheap.
- **Per-ticker valuation summaries cached in localStorage.** Recomputing regime and fair value for twenty tickers on page load would mean twenty full financial pipelines. Instead each dashboard saves its own summary as you visit it, and the watchlist reads what's cached, labelled with how recently it was computed. Tickers you haven't opened yet say so rather than showing a misleading blank.

### Changed
- **Valuation regime thresholds moved into `src/lib/metrics.js`** as a shared `getRegime()`, so the dashboard badge and the watchlist rows cannot drift apart.
- Watchlist summaries are always computed against the **full** history rather than the currently selected period, so switching the chart to 3Y no longer changes what the watchlist reports.

## 0.10.0 — 2026-07-28

### Added
- **Earnings panel** on every dashboard, covering the three things that matter around a print: when the next call is (with a plain-language countdown and the consensus EPS and revenue going in), how the last four quarters landed against estimates, and where full-year analyst estimates sit including which way they've been revised over the past 30 days. Apple currently reads "in 2 days", consensus $1.89, beat 100% of the last four. Served by a new `/api/earnings` endpoint using Yahoo's `calendarEvents`, `earningsHistory` and `earningsTrend` modules — no API key, no new dependency.

### Changed
- **`npm run dev` now serves the `/api` routes.** A dev-only Vite middleware mounts the serverless handlers, so the whole app runs locally without `vercel dev`. Production is unaffected — Vercel still runs them as functions.

## 0.9.0 — 2026-07-28

### Added
- **Deep history engine — true 10–15 year multiples via SEC EDGAR.** Yahoo Finance only returns about four years of annual statements, which made every "vs. historical average" claim in the app rest on a very short window. A new `/api/history` endpoint pulls annual fundamentals from the SEC's free, keyless XBRL `companyfacts` API and pairs them with Yahoo month-end prices, extending the series to 15 years for most US filers. Apple's average P/E over four years is 31x; over fifteen it is 21x — the current 41x reads very differently against the longer record.
- **5Y and 10Y period toggles are back.** They were removed in 0.7.2 because Yahoo could not support them. The buttons now appear only once the series is actually deep enough, so a 10Y average always reflects ten years of data.
- **Shared valuation module** (`api/_lib/valuation.js`) — the Yahoo and EDGAR paths now compute every multiple through one function, so the two data sources cannot drift apart and produce a step in the chart. Verified: the sources agree within 1–4% on overlapping years.

### Fixed
- **Historical market caps were wrong across stock splits.** Yahoo reports prices already restated for splits while SEC reports share counts exactly as filed, so multiplying them understated Apple's FY2011 market cap by 28x. Share counts are now restated using the splits recorded since the date each figure was *filed* — a FY2019 count republished in the FY2021 10-K already reflects the 2020 split and must not be adjusted twice.

### Notes on data coverage
- Banks (JPM) correctly show no EV/EBITDA or P/FCF: interest is a core operating cost for a lender, not a financing charge, so a reconstructed EBIT would be meaningless. P/E and P/B — the multiples that actually matter for financials — cover the full 15 years.
- Foreign private issuers (TSM) file 20-F rather than 10-K and have no XBRL company facts. They fall back silently to the Yahoo four-year view.
- Companies whose share counts are reported entirely by share class (Visa) have no consolidated count to read, and also fall back to the Yahoo view.
- Exxon's ticker maps to a post-reorganisation holding company with no filings; its history is read from the predecessor CIK.

## 0.8.2 — 2026-04-10

### Added
- **CAGR in selection summary** — dragging across the price chart now shows annualized CAGR alongside total return and dollar change (hidden for selections under ~30 days where CAGR is meaningless)

### Fixed
- **Axis tick labels no longer highlight during drag** — added `select-none` to the chart container so browser text selection is suppressed on the whole card, not just the SVG

## 0.8.1 — 2026-04-10

### Added
- **Drag-to-measure return** on the price history chart — click and drag across any two points to highlight that window and show the percentage return and dollar change between them. Works with all ranges (Today → Max). Selection resets when the range or ticker changes.

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
