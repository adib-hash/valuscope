// Investor search — resolves a manager name to a CIK via EDGAR full-text
// search, restricted to entities that have actually filed a 13F.

import { searchFilers } from './_lib/edgar13f.js';

export default async function handler(req, res) {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  try {
    const filers = await searchFilers(q.trim());
    // Filer names are effectively static.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({ filers });
  } catch (err) {
    console.error('Institutions error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Investor search failed: ${err.message}` });
  }
}
