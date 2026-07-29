// Shared valuation math — used by both the Yahoo-backed /api/financials and the
// SEC EDGAR-backed /api/history so a single formula produces every year on the
// chart. Any drift here would show up as a visible discontinuity where the two
// data sources meet.

// Builds one fiscal-year row from raw fundamentals. All monetary inputs are in
// absolute dollars; outputs are in millions to match the client's formatters.
export function computeYearRow({
  fiscalYear,
  endDate,
  price,
  shares,
  revenue,
  grossProfit,
  ebit,
  ebitda,
  netIncome,
  interestExpense,
  taxProvision,
  pretaxIncome,
  ocf,
  fcf,
  buybacks,
  bookValue,
  totalDebt,
  cash,
  minorityInterest,
  currentAssets,
  currentLiabilities,
  prevRevenue,
}) {
  const mktCap = price != null && shares ? price * shares : null;

  // EV = Market Cap + Total Debt + Minority Interest − Cash
  const ev = mktCap != null
    ? mktCap + (totalDebt || 0) + (minorityInterest || 0) - (cash || 0)
    : null;

  const pe   = mktCap && netIncome   > 0 ? mktCap / netIncome   : null;
  const ps   = mktCap && revenue     > 0 ? mktCap / revenue     : null;
  const pb   = mktCap && bookValue   > 0 ? mktCap / bookValue   : null;
  const pfcf = mktCap && fcf         > 0 ? mktCap / fcf         : null;
  const pocf = mktCap && ocf         > 0 ? mktCap / ocf         : null;
  const pGP  = mktCap && grossProfit > 0 ? mktCap / grossProfit : null;

  const evSales  = ev && revenue     > 0 ? ev / revenue     : null;
  const evEbitda = ev && ebitda      > 0 ? ev / ebitda      : null;
  const evEbit   = ev && ebit        > 0 ? ev / ebit        : null;
  const evGP     = ev && grossProfit > 0 ? ev / grossProfit : null;
  const evFcf    = ev && fcf         > 0 ? ev / fcf         : null;
  const evOcf    = ev && ocf         > 0 ? ev / ocf         : null;

  const buybackYield = mktCap && buybacks ? (buybacks / mktCap) * 100 : null;

  const grossMargin     = revenue > 0 && grossProfit != null ? (grossProfit / revenue) * 100 : null;
  const ebitdaMargin    = revenue > 0 && ebitda      != null ? (ebitda      / revenue) * 100 : null;
  const operatingMargin = revenue > 0 && ebit        != null ? (ebit        / revenue) * 100 : null;
  const netMargin       = revenue > 0 && netIncome   != null ? (netIncome   / revenue) * 100 : null;
  const fcfMargin       = revenue > 0 && fcf         != null ? (fcf         / revenue) * 100 : null;
  const revenueGrowth   = revenue && prevRevenue && prevRevenue > 0
    ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;

  const netDebtRaw = totalDebt != null && cash != null ? totalDebt - cash : null;
  const netDebtToEbitda = netDebtRaw != null && ebitda && ebitda > 0
    ? netDebtRaw / ebitda : null;
  const interestCoverage = ebit && interestExpense && interestExpense > 0
    ? ebit / interestExpense : null;
  const currentRatio = currentAssets && currentLiabilities && currentLiabilities > 0
    ? currentAssets / currentLiabilities : null;

  // ROIC = NOPAT / Invested Capital, with the effective tax rate clamped to a
  // sane band so loss years and tax-benefit years don't produce absurd figures.
  const effectiveTaxRate = taxProvision != null && pretaxIncome && pretaxIncome > 0
    ? Math.min(0.5, Math.max(0, taxProvision / pretaxIncome))
    : 0.21;
  const nopat = ebit != null ? ebit * (1 - effectiveTaxRate) : null;
  const investedCapital = (totalDebt || 0) + (bookValue || 0) - (cash || 0);
  const roic = nopat != null && investedCapital > 0
    ? (nopat / investedCapital) * 100 : null;

  const M = (v) => (v != null ? v / 1e6 : null);

  return {
    fiscalYear,
    endDate,
    pe, ps, pb, pfcf, pocf, pGP,
    evSales, evEbitda, evEbit, evGP, evFcf, evOcf,
    earningsYield: pe   ? (1 / pe)   * 100 : null,
    fcfYield:      pfcf ? (1 / pfcf) * 100 : null,
    buybackYield,
    grossMargin, ebitdaMargin, operatingMargin, netMargin, fcfMargin, revenueGrowth,
    netDebtToEbitda, interestCoverage, currentRatio, roic,
    price,
    mktCap:      M(mktCap),
    ev:          M(ev),
    revenue:     M(revenue),
    grossProfit: M(grossProfit),
    ebitda:      M(ebitda),
    ebit:        M(ebit),
    netIncome:   M(netIncome),
    ocf:         M(ocf),
    fcf:         M(fcf),
    bookValue:   M(bookValue),
    sharesOut:   M(shares),
    netDebt:     M(netDebtRaw),
    _effectiveTaxRate: effectiveTaxRate,
  };
}
