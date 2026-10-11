// Which test tickers would production actually send to the AI rung?
// Runs the real Yahoo similar-stocks rung (api/_lib/peers.js) for each.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YahooFinance from 'yahoo-finance2'
import { similarPeers } from '../../api/_lib/peers.js'
import { COMP_TICKERS, INPUTS } from './llm-bakeoff.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })
const inp = JSON.parse(fs.readFileSync(INPUTS, 'utf8'))
// getCuratedComps isn't exported; evaluate the real table and function from comps.js.
const src = fs.readFileSync(path.join(here, '..', '..', 'api', 'comps.js'), 'utf8')
const getCuratedComps = new Function(
  src.slice(src.indexOf('const COMP_GROUPS'), src.indexOf('// A peer set can cross')) + '; return getCuratedComps;'
)()
const out = {}
for (const c of COMP_TICKERS) {
  const curated = getCuratedComps(c.symbol)
  const peers = curated ? [] : await similarPeers(yahooFinance, c.symbol, inp.comps[c.symbol]).catch(() => [])
  out[c.symbol] = curated ? { rung: 'curated', list: curated } : { rung: peers.length >= 3 ? 'similar' : 'ai', similar: peers }
  console.log(c.symbol, out[c.symbol].rung, (curated || peers).join(' '))
}
fs.writeFileSync(path.join(here, 'ladder.json'), JSON.stringify(out, null, 1))
