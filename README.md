# ValuScope

Historical valuation multiples for any US public company. Look up 3-10 years of P/E, EV/EBITDA, P/FCF, and 20+ other metrics with interactive charts, fair value estimates, and fundamental analysis.

**Live:** [valuscope.ihsan.build](https://valuscope.ihsan.build)

## Features

### Valuation Dashboard
- Search any US public company by ticker with autocomplete
- 3Y / 5Y / 10Y trailing multiples across five chart groups:
  - Price Multiples (P/E, P/S, P/B, P/Gross Profit, P/FCF, P/OCF)
  - EV Multiples (EV/EBITDA, EV/Sales, EV/Gross Profit, EV/EBIT, EV/FCF, EV/OCF)
  - Yield Metrics (Earnings Yield, FCF Yield, Buyback Yield)
  - Growth and Margins (Revenue Growth, Gross/EBITDA/Operating/Net/FCF Margin)
  - Leverage and Returns (ND/EBITDA, Interest Coverage, Current Ratio, ROIC)
- Interactive charts with toggleable metrics and historical average reference lines
- Adaptive chart height and theme-aware colors
- Period toggle (3Y / 5Y / 10Y) controls charts, data tables, and averages

### Summary Pills
- Current vs. historical average with above/below indicators
- Range bar showing min/max track, average tick, and colored dot for current position
- Percentile badges showing where the current value sits historically
- Tap any pill to open a detail bottom sheet with a single-metric mini chart and data table
- Scroll snapping on mobile for clean horizontal swiping

### Fundamentals Panel
- Growth CAGRs (1yr/3yr/5yr revenue, 1yr/3yr EBITDA)
- LTM margins with trend arrows vs. 3-year average
- Leverage metrics (Net Debt, ND/EBITDA, Interest Coverage, Current Ratio, ROIC) with color-coded risk signals
- Signals (Beta, Insider Ownership, Short Interest, Dividend Yield)
- Forward P/E (NTM) and PEG ratio from analyst consensus

### Fair Value Estimator
- "If we return to the historical average..." implied price and upside/downside for P/E, EV/EBITDA, P/FCF, P/S, EV/Sales
- Blended median estimate across all metrics

### Valuation Regime Badge
- Single-word verdict (Deep Value / Undervalued / Fair Value / Stretched / Expensive) based on average percentile of pill metrics

### Company Info
- Market cap and EV displayed alongside price and daily change
- Collapsible company description (longBusinessSummary)
- External links: StockAnalysis, SEC EDGAR, Yahoo Finance, Quartr, SEC 8-K filings
- Calculation tooltips on every metric showing formulas and period notes

### My Thesis
- Per-ticker investment notes with auto-save (debounced 500ms)
- Persists to localStorage with relative timestamps and character count

### General
- Light/dark mode toggle with localStorage persistence
- Settings modal (gear icon) showing version, data source, theme toggle, watchlist count
- Watchlist (star tickers, localStorage, cap of 20)
- Shareable/bookmarkable URLs (`?ticker=AAPL`) with copy-to-clipboard share button
- Loading skeleton placeholders
- Expandable data table with raw fundamentals
- Recent search history and quick-launch ticker buttons

## Architecture

- **Frontend:** React + Vite + Tailwind CSS + Recharts
- **Data:** Yahoo Finance via `yahoo-finance2` (server-side, Vercel serverless functions). No API key required.
- **Hosting:** Vercel free tier
- **Domain:** valuscope.ihsan.build (Namecheap DNS)

## Setup

### Local Development

No API key needed. Yahoo Finance data is free and keyless.

```bash
# Clone
git clone https://github.com/adib-hash/valuscope.git
cd valuscope

# Install
npm install

# Run dev server
npm run dev
```

The Vite dev server proxies `/api` calls to the serverless functions. In production, Vercel handles routing automatically.

### Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy
vercel
```

No environment variables to configure.

### Custom Domain

Add `valuscope.ihsan.build` as a custom domain in Vercel project settings, then add a CNAME record in Namecheap pointing to `cname.vercel-dns.com`.

## Project Structure

```
valuscope/
├── api/
│   ├── financials.js       # Serverless: Yahoo Finance data (financials, prices, signals)
│   └── search.js           # Serverless: Yahoo Finance ticker search
├── src/
│   ├── components/
│   │   ├── DataTable.jsx        # Expandable raw fundamentals table
│   │   ├── FairValueTable.jsx   # Implied fair value estimates
│   │   ├── FundamentalsPanel.jsx # Growth, margins, leverage, signals
│   │   ├── Pill.jsx             # Summary pill with range bar + percentile
│   │   ├── PillDetail.jsx       # Bottom sheet for single-metric deep dive
│   │   ├── SearchBar.jsx        # Ticker autocomplete search
│   │   ├── Thesis.jsx           # Per-ticker investment notes
│   │   └── ValuChart.jsx        # Interactive Recharts chart
│   ├── lib/
│   │   ├── api.js           # Client-side fetch helpers
│   │   ├── fundamentals.js  # Derived metric computation
│   │   ├── metrics.js       # Metric definitions, formulas, tooltips
│   │   └── watchlist.js     # localStorage watchlist helpers
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── vercel.json
└── CHANGELOG.md
```

## Roadmap

- [x] Forward multiples from analyst estimates (Forward P/E NTM, PEG ratio)
- [x] Mobile-optimized layout (responsive charts, scroll snapping, adaptive heights)
- [ ] Peer comparison (2-3 comps side by side)
- [ ] Supabase caching to reduce API calls
- [ ] Export to PNG/PDF

## Data Sources

All financial data sourced from [Yahoo Finance](https://finance.yahoo.com/) via `yahoo-finance2`. Historical valuation multiples are computed from annual financial statements and historical monthly prices. Validation links provided for every company lookup.
