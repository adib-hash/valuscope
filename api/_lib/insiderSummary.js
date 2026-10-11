// Turns raw insider transactions into what the Insiders tab shows: who bought
// and sold, how much, and when. Dollar values are estimates (shares × that
// day's close) unless a filing has been opened for its exact price.

const OPEN_MARKET = new Set(['P', 'S']);

// The close on the trade date, or the nearest earlier trading day (Form 4
// dates can fall on a weekend for gifts and plan transfers).
export function closeOn(closes, date) {
  let lo = 0, hi = closes.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (closes[mid].date <= date) { best = closes[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best?.close ?? null;
}

export function summariseInsiders(transactions, closes) {
  const rows = transactions.map((t) => {
    const price = t.common ? closeOn(closes, t.date) : null;
    return {
      date: t.date,
      name: t.name,
      role: t.role,
      code: t.code,
      label: t.label,
      ad: t.ad,
      shares: t.shares,
      ownedAfter: t.ownedAfter,
      direct: t.direct,
      security: t.security,
      common: t.common,
      openMarket: OPEN_MARKET.has(t.code) && t.common,
      estPrice: price,
      estValue: price ? Math.round(price * t.shares) : null,
      accession: t.accession,
      filing: t.filing,
      ownerCik: t.ownerCik,
    };
  });

  // Per insider: open-market buys and sells, plus a count of everything else.
  const people = new Map();
  for (const r of rows) {
    const key = r.ownerCik || r.name;
    if (!people.has(key)) {
      people.set(key, {
        name: r.name, role: r.role, ownerCik: r.ownerCik,
        sold: { shares: 0, value: 0, trades: 0 },
        bought: { shares: 0, value: 0, trades: 0 },
        other: 0, lastDate: r.date, firstDate: r.date,
      });
    }
    const p = people.get(key);
    if (r.date > p.lastDate) p.lastDate = r.date;
    if (r.date < p.firstDate) p.firstDate = r.date;
    if (r.openMarket && r.code === 'S') { p.sold.shares += r.shares; p.sold.value += r.estValue || 0; p.sold.trades++; }
    else if (r.openMarket && r.code === 'P') { p.bought.shares += r.shares; p.bought.value += r.estValue || 0; p.bought.trades++; }
    else p.other++;
  }
  const insiders = [...people.values()]
    .sort((a, b) => (b.sold.value + b.bought.value) - (a.sold.value + a.bought.value) || b.other - a.other);

  // Monthly open-market totals, for the chart.
  const months = new Map();
  for (const r of rows) {
    if (!r.openMarket) continue;
    const m = r.date.slice(0, 7);
    if (!months.has(m)) months.set(m, { month: m, sold: 0, bought: 0 });
    months.get(m)[r.code === 'S' ? 'sold' : 'bought'] += r.estValue || 0;
  }

  const totals = insiders.reduce((t, p) => {
    t.soldValue += p.sold.value; t.boughtValue += p.bought.value;
    if (p.sold.trades) t.sellers++;
    if (p.bought.trades) t.buyers++;
    return t;
  }, { soldValue: 0, boughtValue: 0, sellers: 0, buyers: 0 });

  return {
    totals,
    insiders,
    monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    transactions: rows,
  };
}
