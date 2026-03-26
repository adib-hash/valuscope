# ValuScope

Historical valuation multiples for any US public company. Look up 5 years of P/E, EV/EBITDA, P/FCF, and 12+ other metrics with interactive charts and data tables.

**Live:** [valuscope.ihsan.build](https://valuscope.ihsan.build)

## Features

- Search any US public company by ticker with autocomplete
- 5-year trailing multiples: Price Multiples, EV Multiples, Yield Metrics
- Interactive charts with toggleable metrics and historical average reference lines
- Summary pills showing current vs. historical average (above/below)
- Full expandable data table with raw fundamentals
- Validation links to StockAnalysis, SEC EDGAR, and Yahoo Finance

## Architecture

- **Frontend:** React + Vite + Tailwind CSS + Recharts
- **Data:** Financial Modeling Prep API (server-side via Vercel serverless functions)
- **Hosting:** Vercel free tier
- **Domain:** valuscope.ihsan.build (Namecheap DNS)

## Setup

### 1. Get an FMP API Key

Sign up for free at [financialmodelingprep.com/developer](https://site.financialmodelingprep.com/developer). Free tier gives 250 calls/day, US stocks, no credit card.

### 2. Local Development

```bash
# Clone
git clone https://github.com/adib-hash/valuscope.git
cd valuscope

# Install
npm install

# Create .env with your FMP key
cp .env.example .env
# Edit .env and add your FMP_API_KEY

# Run dev server
npm run dev
```

The Vite dev server proxies `/api` calls to FMP directly. In production, Vercel serverless functions handle the proxy.

### 3. Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy
vercel

# Set environment variable
vercel env add FMP_API_KEY
```

### 4. Custom Domain

Add `valuscope.ihsan.build` as a custom domain in Vercel project settings, then add a CNAME record in Namecheap pointing to `cname.vercel-dns.com`.

## Project Structure

```
valuscope/
├── api/
│   ├── financials.js    # Serverless: FMP financial data proxy
│   └── search.js        # Serverless: FMP ticker search proxy
├── src/
│   ├── components/
│   │   ├── SearchBar.jsx
│   │   ├── Pill.jsx
│   │   ├── ValuChart.jsx
│   │   └── DataTable.jsx
│   ├── lib/
│   │   ├── api.js       # Client-side fetch helpers
│   │   └── metrics.js   # Metric definitions & computation
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

- [ ] Peer comparison (2-3 comps side by side)
- [ ] Forward multiples from analyst estimates
- [ ] Supabase caching to reduce FMP API calls
- [ ] Export to PNG/PDF
- [ ] Mobile-optimized layout

## Data Sources

All financial data sourced from [Financial Modeling Prep](https://financialmodelingprep.com/), which pulls from SEC EDGAR filings. Validation links provided for every company lookup.
