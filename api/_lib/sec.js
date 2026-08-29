// SEC EDGAR XBRL client — pulls 10+ years of annual fundamentals from the free,
// keyless companyfacts API. Yahoo only returns ~4 years of annual statements, so
// this is what makes "current multiple vs. long-run average" credible.
//
// SEC requires a descriptive User-Agent with contact info and rate-limits to
// 10 req/sec. We make at most 2 requests per cold invocation and cache hard.

const UA = 'ValueScope/1.0 (adib@ihsan.build)';

// Warm-invocation caches. The ticker→CIK map is ~800KB and changes rarely.
let cikMapPromise = null;
const factsCache = new Map();
const FACTS_TTL_MS = 6 * 60 * 60 * 1000;

async function secFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`SEC responded ${res.status}`);
  return res.json();
}

// When a company reorganizes under a new holding company, SEC's ticker map
// points at the new shell while every historical filing stays under the old CIK.
// The new entity's companyfacts is simply empty, with nothing linking the two,
// so known cases are listed explicitly.
const CIK_OVERRIDES = {
  XOM: '0000034088', // ticker maps to ExxonMobil Holdings Corp (no filings)
};

export async function lookupCik(ticker) {
  const override = CIK_OVERRIDES[ticker.toUpperCase()];
  if (override) return override;

  if (!cikMapPromise) {
    cikMapPromise = secFetch('https://www.sec.gov/files/company_tickers.json').catch((e) => {
      cikMapPromise = null; // let the next request retry
      throw e;
    });
  }
  const map = await cikMapPromise;
  const sym = ticker.toUpperCase();
  for (const entry of Object.values(map)) {
    if (entry.ticker === sym) return String(entry.cik_str).padStart(10, '0');
  }
  return null;
}

export async function fetchCompanyFacts(cik) {
  const hit = factsCache.get(cik);
  if (hit && Date.now() - hit.at < FACTS_TTL_MS) return hit.data;
  const data = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  factsCache.set(cik, { at: Date.now(), data });
  return data;
}

const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86400000;
const isAnnualReport = (form) => /^10-K/.test(form || '');

// A fact can appear in several filings (original plus later comparatives, and
// restatements). Keyed by period end, the most recently filed value wins.
function collect(facts, taxonomy, tag, unit, wantDuration) {
  const arr = facts?.[taxonomy]?.[tag]?.units?.[unit];
  if (!arr) return null;
  const byEnd = new Map();
  for (const f of arr) {
    if (!f.end || !isAnnualReport(f.form)) continue;
    if (wantDuration) {
      if (!f.start) continue;
      const d = daysBetween(f.start, f.end);
      if (d < 340 || d > 400) continue; // annual periods only (52/53-week years included)
    } else if (f.start) {
      continue; // balance-sheet items are instants, not durations
    }
    const prev = byEnd.get(f.end);
    if (!prev || new Date(f.filed) > new Date(prev.filed)) byEnd.set(f.end, f);
  }
  return byEnd.size ? byEnd : null;
}

// Walks a priority list of tags and returns the first that has a value for this
// period end. Balance-sheet dates can land a few days off the income-statement
// year end, so instants match within a tolerance.
function pickFact(facts, tagList, endDate, { duration, unit = 'USD', tolDays = 0 }) {
  for (const [taxonomy, tag] of tagList) {
    const series = collect(facts, taxonomy, tag, unit, duration);
    if (!series) continue;
    if (series.has(endDate)) return series.get(endDate);
    if (tolDays > 0) {
      let best = null, bestDiff = Infinity;
      for (const [d, f] of series) {
        const diff = Math.abs(daysBetween(d, endDate));
        if (diff <= tolDays && diff < bestDiff) { bestDiff = diff; best = f; }
      }
      if (best) return best;
    }
  }
  return null;
}

function pickValue(facts, tagList, endDate, opts) {
  return pickFact(facts, tagList, endDate, opts)?.val ?? null;
}

// Tag priority lists. Order matters: the most specific / most modern tag first,
// then older or broader fallbacks. Companies that genuinely lack a concept
// (banks have no gross profit or capex) correctly yield null.
const INCOME = {
  revenue: [
    ['us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
    ['us-gaap', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
    ['us-gaap', 'Revenues'],
    ['us-gaap', 'SalesRevenueNet'],
    ['us-gaap', 'SalesRevenueGoodsNet'],
    ['us-gaap', 'SalesRevenueServicesNet'],
  ],
  grossProfit: [['us-gaap', 'GrossProfit']],
  costOfRevenue: [
    ['us-gaap', 'CostOfRevenue'],
    ['us-gaap', 'CostOfGoodsAndServicesSold'],
    ['us-gaap', 'CostOfGoodsSold'],
    ['us-gaap', 'CostOfServices'],
  ],
  ebit: [['us-gaap', 'OperatingIncomeLoss']],
  netIncome: [['us-gaap', 'NetIncomeLoss'], ['us-gaap', 'ProfitLoss']],
  // EBITDA needs depreciation *and* amortization. Most filers report a combined
  // line; others (Alphabet) report the two separately, so both shapes are tried.
  depreciationAndAmortization: [
    ['us-gaap', 'DepreciationDepletionAndAmortization'],
    ['us-gaap', 'DepreciationAmortizationAndAccretionNet'],
    ['us-gaap', 'DepreciationAndAmortization'],
  ],
  depreciationOnly: [
    ['us-gaap', 'Depreciation'],
    ['us-gaap', 'DepreciationNonproduction'],
    ['us-gaap', 'PropertyPlantAndEquipmentDepreciationMethodsDepreciationExpense'],
  ],
  amortizationOnly: [
    ['us-gaap', 'AmortizationOfIntangibleAssets'],
    ['us-gaap', 'AmortizationOfIntangibleAssetsExcludingDeferredCharges'],
  ],
  interestExpense: [
    ['us-gaap', 'InterestExpense'],
    ['us-gaap', 'InterestExpenseDebt'],
    ['us-gaap', 'InterestExpenseNonoperating'],
    ['us-gaap', 'InterestAndDebtExpense'],
  ],
  taxProvision: [['us-gaap', 'IncomeTaxExpenseBenefit']],
  pretaxIncome: [
    ['us-gaap', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'],
    ['us-gaap', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
    ['us-gaap', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic'],
  ],
  ocf: [
    ['us-gaap', 'NetCashProvidedByUsedInOperatingActivities'],
    ['us-gaap', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  ],
  capex: [
    ['us-gaap', 'PaymentsToAcquirePropertyPlantAndEquipment'],
    ['us-gaap', 'PaymentsToAcquireProductiveAssets'],
    ['us-gaap', 'PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets'],
  ],
  buybacks: [['us-gaap', 'PaymentsForRepurchaseOfCommonStock']],
  epsDiluted: [
    ['us-gaap', 'EarningsPerShareDiluted'],
    ['us-gaap', 'IncomeLossFromContinuingOperationsPerDilutedShare'],
  ],
};

const BALANCE = {
  bookValue: [
    ['us-gaap', 'StockholdersEquity'],
    ['us-gaap', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  ],
  cash: [
    ['us-gaap', 'CashAndCashEquivalentsAtCarryingValue'],
    ['us-gaap', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  ],
  shortTermInvestments: [
    ['us-gaap', 'ShortTermInvestments'],
    ['us-gaap', 'MarketableSecuritiesCurrent'],
    ['us-gaap', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'],
  ],
  longTermDebtNoncurrent: [
    ['us-gaap', 'LongTermDebtNoncurrent'],
    ['us-gaap', 'LongTermDebt'],
  ],
  longTermDebtCurrent: [['us-gaap', 'LongTermDebtCurrent']],
  shortTermDebt: [
    ['us-gaap', 'ShortTermBorrowings'],
    ['us-gaap', 'CommercialPaper'],
    ['us-gaap', 'OtherShortTermBorrowings'],
  ],
  minorityInterest: [['us-gaap', 'MinorityInterest']],
  currentAssets: [['us-gaap', 'AssetsCurrent']],
  currentLiabilities: [['us-gaap', 'LiabilitiesCurrent']],
};

const SHARES_INSTANT = [
  ['us-gaap', 'CommonStockSharesOutstanding'],
  ['dei', 'EntityCommonStockSharesOutstanding'],
];
const SHARES_DURATION = [
  ['us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding'],
  ['us-gaap', 'WeightedAverageNumberOfSharesOutstandingBasic'],
];

// Returns annual fundamentals oldest-first, one entry per fiscal year end.
export function extractAnnualFundamentals(companyFacts) {
  const facts = companyFacts?.facts;
  if (!facts) return [];

  // Fiscal year ends are wherever we can find a top-line or bottom-line figure.
  const ends = new Set();
  for (const list of [INCOME.revenue, INCOME.netIncome]) {
    for (const [taxonomy, tag] of list) {
      const series = collect(facts, taxonomy, tag, 'USD', true);
      if (series) for (const end of series.keys()) ends.add(end);
    }
  }

  const sorted = [...ends].sort();
  return sorted.map((endDate) => {
    const inc = (key) => pickValue(facts, INCOME[key], endDate, { duration: true });
    // Balance sheets can be dated a few days from the income statement year end.
    const bal = (key) => pickValue(facts, BALANCE[key], endDate, { duration: false, tolDays: 20 });

    const revenue     = inc('revenue');
    const costOfRevenue = inc('costOfRevenue');
    const grossProfit = inc('grossProfit')
      ?? (revenue != null && costOfRevenue != null ? revenue - costOfRevenue : null);

    const interestExpenseRaw = inc('interestExpense');
    const interestExpense = interestExpenseRaw != null ? Math.abs(interestExpenseRaw) : null;
    const pretaxIncome = inc('pretaxIncome');

    // Pharma and some conglomerates skip OperatingIncomeLoss entirely. EBIT is
    // then rebuilt the textbook way: pre-tax income plus interest expense.
    //
    // Banks are deliberately excluded. For a lender, interest is the main cost
    // of doing business rather than a financing charge, so adding it back
    // invents an operating profit that doesn't exist and makes EV/EBITDA look
    // meaningful when it isn't. Reporting a cost of revenue or capital
    // expenditure is what distinguishes an operating company here; banks report
    // neither, so they keep a null EBIT and simply plot no EV multiples.
    const looksOperating = costOfRevenue != null || inc('capex') != null;
    const ebit = inc('ebit')
      ?? (looksOperating && pretaxIncome != null && interestExpense != null
        ? pretaxIncome + interestExpense
        : null);

    const combinedDA = inc('depreciationAndAmortization');
    const depOnly    = inc('depreciationOnly');
    const amortOnly  = inc('amortizationOnly');
    const da = combinedDA
      ?? (depOnly != null || amortOnly != null ? (depOnly || 0) + (amortOnly || 0) : null);

    const ocf   = inc('ocf');
    const capex = inc('capex');

    const ltDebtNoncurrent = bal('longTermDebtNoncurrent');
    const ltDebtCurrent    = bal('longTermDebtCurrent');
    const shortTermDebt    = bal('shortTermDebt');
    const totalDebt = [ltDebtNoncurrent, ltDebtCurrent, shortTermDebt].some((v) => v != null)
      ? (ltDebtNoncurrent || 0) + (ltDebtCurrent || 0) + (shortTermDebt || 0)
      : null;

    const cashOnHand = bal('cash');
    const cash = cashOnHand != null ? cashOnHand + (bal('shortTermInvestments') || 0) : null;

    // Share counts are the one figure that gets restated by stock splits, so the
    // filing date travels with the value. A count reported in a filing made
    // after a split is already expressed post-split; callers need to know which
    // splits still have to be applied. See splitFactorSince() in api/history.js.
    const netIncome = inc('netIncome');
    let sharesFact =
      pickFact(facts, SHARES_INSTANT, endDate, { duration: false, unit: 'shares', tolDays: 45 })
      ?? pickFact(facts, SHARES_DURATION, endDate, { duration: true, unit: 'shares' });

    // Multi-class issuers (Visa, and most founder-controlled companies) report
    // every share count broken out by class. companyfacts drops dimensional
    // facts, so those tags come back empty. Diluted EPS is never dimensional,
    // which makes net income ÷ EPS a reliable share count of last resort.
    if (!sharesFact && netIncome != null) {
      const epsFact = pickFact(facts, INCOME.epsDiluted, endDate, {
        duration: true, unit: 'USD/shares',
      });
      if (epsFact?.val) {
        sharesFact = { val: netIncome / epsFact.val, filed: epsFact.filed };
      }
    }

    return {
      endDate,
      revenue,
      grossProfit,
      ebit,
      // EBITDA isn't a GAAP concept, so it's built the standard way: EBIT + D&A.
      ebitda: ebit != null && da != null ? ebit + da : null,
      netIncome,
      interestExpense,
      taxProvision: inc('taxProvision'),
      pretaxIncome,
      ocf,
      fcf: ocf != null && capex != null ? ocf - capex : null,
      buybacks: inc('buybacks') != null ? Math.abs(inc('buybacks')) : null,
      bookValue: bal('bookValue'),
      totalDebt,
      cash,
      minorityInterest: bal('minorityInterest'),
      currentAssets: bal('currentAssets'),
      currentLiabilities: bal('currentLiabilities'),
      shares: sharesFact?.val ?? null,
      sharesFiled: sharesFact?.filed ?? null,
    };
  });
}
