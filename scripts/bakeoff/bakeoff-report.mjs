// Builds LLM-BAKEOFF-REPORT.html from the bake-off outputs. See llm-bakeoff.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIGS, SUB_CONFIGS, PROD, CALLS, COMP_TICKERS, JUDGES, RUNS, JUDGE, INPUTS, LADDER, STAGE_CAP_S, readJSON } from './llm-bakeoff.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', '..', 'LLM-BAKEOFF-REPORT.html')
const runs = readJSON(RUNS, {})
const judged = readJSON(JUDGE, {})
const inp = readJSON(INPUTS, {})
const ladder = readJSON(LADDER, {})
const notes = readJSON(path.join(here, 'notes.json'), { verdict: [], findings: [], thesis: '' })

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–')
const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '–')
const money = (v) => (!Number.isFinite(v) ? '–' : v < 0.01 ? '$' + v.toFixed(4) : v < 1 ? '$' + v.toFixed(3) : '$' + v.toFixed(2))
const cfgById = Object.fromEntries([...CONFIGS, ...SUB_CONFIGS, PROD].map((c) => [c.id, c]))
const vendor = (id) => (cfgById[id]?.provider === 'subagent' ? 'anthropic' : cfgById[id]?.provider)
const crossJudge = (cfgId) => (vendor(cfgId) === 'gemini' ? 'opus' : vendor(cfgId) === 'anthropic' ? 'gpro' : null)
const costOf = (r) => { const c = cfgById[r.cfg]; return c?.price ? (r.inTok * c.price[0] + r.outTok * c.price[1]) / 1e6 : 0 }

function scoresFor(task, items, cfgId, field) {
  const byJudge = {}
  for (const j of JUDGES) {
    byJudge[j.id] = items.map((it) => judged[`${j.id}|${task}|${it}`]?.scores?.[cfgId]?.[field]).filter((v) => typeof v === 'number')
  }
  const both = Object.values(byJudge).flat()
  return { mean: avg(both), ...Object.fromEntries(Object.entries(byJudge).map(([k, v]) => [k, avg(v)])) }
}

// ---------- summaries ----------
const sumItems = CALLS.map((c) => c.symbol)
const SUM_CRIT = ['accuracy', 'coverage', 'insight', 'concision', 'discipline']
const sumStats = CONFIGS.map((cfg) => {
  const rs = sumItems.map((s) => runs[`${cfg.id}|sum|${s}`]).filter(Boolean)
  const ok = rs.filter((r) => r.parsed)
  const errors = JUDGES.flatMap((j) => sumItems.flatMap((s) => (judged[`${j.id}|sum|${s}`]?.scores?.[cfg.id]?.errors || []).filter((e) => e && !/^none/i.test(e))))
  const overall = scoresFor('sum', sumItems, cfg.id, 'overall')
  const cj = crossJudge(cfg.id)
  return {
    cfg, ok: ok.length, n: rs.length,
    overall,
    cross: cj ? overall[cj] : NaN,
    crit: Object.fromEntries(SUM_CRIT.map((k) => [k, scoresFor('sum', sumItems, cfg.id, k).mean])),
    errors: errors.length,
    errPer: errors.length / (JUDGES.length * Math.max(ok.length, 1)),
    lat: med(ok.map((r) => r.ms / 1000)),
    cost: avg(ok.map(costOf)),
    words: avg(ok.map((r) => r.words)),
    figures: avg(ok.map((r) => r.figures)),
    ungrounded: ok.reduce((a, r) => a + (r.ungrounded?.length || 0), 0),
  }
}).sort((a, b) => b.overall.mean - a.overall.mean)

// ---------- summaries, current two-pass pipeline ----------
const SUM2_CRIT = ['accuracy', 'qa', 'coverage', 'insight', 'concision', 'discipline']
const passCost = (cfg, p) => (cfg.price && p ? (p.inTok * cfg.price[0] + p.outTok * cfg.price[1]) / 1e6 : 0)
const pipeStats = (task, cfgs, cap) => cfgs.map((cfg) => {
  const rs = sumItems.map((s) => runs[`${cfg.id}|${task}|${s}`]).filter((r) => r?.summary)
  const errors = JUDGES.flatMap((j) => sumItems.flatMap((s) => (judged[`${j.id}|${task}|${s}`]?.scores?.[cfg.id]?.errors || []).filter((e) => e && !/^none/i.test(e))))
  const overall = scoresFor(task, sumItems, cfg.id, 'overall')
  const cj = crossJudge(cfg.id)
  const stages = rs.flatMap((r) => Object.values(r.passes || {}).filter(Boolean))
  const api = cfg.provider !== 'subagent'
  return {
    cfg, ok: rs.length, api,
    overall, cross: cj ? overall[cj] : NaN,
    crit: Object.fromEntries(SUM2_CRIT.map((k) => [k, scoresFor(task, sumItems, cfg.id, k).mean])),
    errPer: errors.length / (JUDGES.length * Math.max(rs.length, 1)),
    words: avg(rs.map((r) => r.words)),
    over900: rs.filter((r) => r.words > 900).length,
    quotes: avg(rs.map((r) => r.summary.notableQuotes?.length || 0)),
    stageMed: api ? med(stages.map((p) => p.ms / 1000)) : NaN,
    stageMax: api ? Math.max(...stages.map((p) => p.ms / 1000)) : NaN,
    overCap: api ? stages.filter((p) => p.ms / 1000 > cap - 5).length : NaN,
    cost: api ? avg(rs.map((r) => Object.values(r.passes || {}).reduce((a, p) => a + passCost(cfg, p), 0))) : NaN,
  }
}).sort((a, b) => b.overall.mean - a.overall.mean)
const sum3Stats = pipeStats('sum3', CONFIGS, STAGE_CAP_S)
const sum2Stats = pipeStats('sum2', [...CONFIGS.filter((c) => c.provider === 'gemini'), ...SUB_CONFIGS], 60)

// ---------- comps ----------
const compItems = COMP_TICKERS.map((c) => c.symbol)
const tailItems = COMP_TICKERS.filter((c) => ladder[c.symbol]?.rung === 'ai').map((c) => c.symbol)
const COMP_CRIT = ['relevance', 'coverage', 'scale', 'noise']
const compStats = [...CONFIGS, PROD].map((cfg) => {
  const rs = compItems.map((s) => runs[`${cfg.id}|comp|${s}`]).filter((r) => r?.peers)
  const sugg = rs.flatMap((r) => r.peers)
  const shown = rs.flatMap((r) => r.shown)
  const overall = scoresFor('comp', compItems, cfg.id, 'overall')
  const cj = crossJudge(cfg.id)
  return {
    cfg, n: rs.length,
    overall,
    tail: scoresFor('comp', tailItems, cfg.id, 'overall').mean,
    cross: cj ? overall[cj] : NaN,
    crit: Object.fromEntries(COMP_CRIT.map((k) => [k, scoresFor('comp', compItems, cfg.id, k).mean])),
    dead: sugg.filter((p) => !p.live).length,
    deadRate: sugg.length ? sugg.filter((p) => !p.live).length / sugg.length : NaN,
    shownAvg: avg(rs.map((r) => r.shown.length)),
    thin: rs.filter((r) => r.shown.length < 5).length,
    selfIncluded: rs.filter((r) => (r.parsed?.peers || []).some((p) => String(p.ticker).toUpperCase() === r.item)).length,
    sameInd: shown.length ? shown.filter((p) => p.sameIndustry).length / shown.length : NaN,
    lat: med(rs.map((r) => r.ms / 1000)),
    cost: avg(rs.map(costOf)),
  }
}).sort((a, b) => b.overall.mean - a.overall.mean)

// ---------- rendering helpers ----------
const scoreCell = (v, best) => `<td class="num${Number.isFinite(v) && Math.abs(v - best) < 0.05 ? ' best' : ''}">${f1(v)}</td>`
const bestOf = (arr, key) => Math.max(...arr.map(key).filter(Number.isFinite))
const bar = (v, max = 10) => `<span class="bar"><span style="width:${Number.isFinite(v) ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%"></span></span>`

function modelCell(cfg) {
  const tag = cfg.current ? ' <span class="chip accent">Production</span>' : cfg.id === 'prod' ? ' <span class="chip">Baseline</span>' : cfg.provider === 'subagent' ? ' <span class="tag">Subscription</span>' : ''
  return `<td><div class="model">${esc(cfg.label)}${tag}</div><div class="sub">${esc(cfg.note)}</div></td>`
}

function sumTable() {
  const b = (k) => bestOf(sumStats, k)
  const rows = sumStats.map((s, i) => `<tr class="${s.cfg.current ? 'is-current' : ''}">
    <td class="rank num">${i + 1}</td>${modelCell(s.cfg)}
    <td class="num strong${Math.abs(s.overall.mean - b((x) => x.overall.mean)) < 0.05 ? ' best' : ''}">${f1(s.overall.mean)} ${bar(s.overall.mean)}</td>
    ${scoreCell(s.overall.opus, b((x) => x.overall.opus))}${scoreCell(s.overall.gpro, b((x) => x.overall.gpro))}
    ${scoreCell(s.crit.accuracy, b((x) => x.crit.accuracy))}
    <td class="num${s.errPer > 1 ? ' bad' : ''}">${s.errPer.toFixed(1)}</td>
    <td class="num">${Math.round(s.words)}</td>
    <td class="num">${f1(s.lat)}s</td>
    <td class="num">${money(s.cost)}</td>
  </tr>`).join('')
  return `<div class="tablewrap"><table>
    <thead><tr><th></th><th>Model</th><th class="num">Overall</th><th class="num">Claude judge</th><th class="num">Gemini judge</th><th class="num">Accuracy</th><th class="num">Errors / summary</th><th class="num">Words</th><th class="num">Median time</th><th class="num">Cost / summary</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

function sumCritTable() {
  const rows = sumStats.map((s) => `<tr class="${s.cfg.current ? 'is-current' : ''}"><td class="model">${esc(s.cfg.label)}</td>${SUM_CRIT.map((k) => scoreCell(s.crit[k], bestOf(sumStats, (x) => x.crit[k]))).join('')}<td class="num">${f1(s.cross)}</td></tr>`).join('')
  return `<div class="tablewrap"><table><thead><tr><th>Model</th>${SUM_CRIT.map((k) => `<th class="num">${k}</th>`).join('')}<th class="num">Other-vendor judge</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function sum2Table(stats) {
  const b = (k) => bestOf(stats, k)
  const rows = stats.map((s, i) => `<tr class="${s.cfg.current ? 'is-current' : ''}">
    <td class="rank num">${i + 1}</td>${modelCell(s.cfg)}
    <td class="num strong${Math.abs(s.overall.mean - b((x) => x.overall.mean)) < 0.05 ? ' best' : ''}">${f1(s.overall.mean)} ${bar(s.overall.mean)}</td>
    ${scoreCell(s.overall.opus, b((x) => x.overall.opus))}${scoreCell(s.overall.gpro, b((x) => x.overall.gpro))}
    ${scoreCell(s.crit.accuracy, b((x) => x.crit.accuracy))}${scoreCell(s.crit.qa, b((x) => x.crit.qa))}
    <td class="num${s.errPer > 1 ? ' bad' : ''}">${s.errPer.toFixed(1)}</td>
    <td class="num${s.words > 900 ? ' warnc' : ''}">${Math.round(s.words)}</td>
    <td class="num">${s.api ? f1(s.stageMed) + 's' : '<span class="muted">n/a</span>'}</td>
    <td class="num${s.overCap ? ' bad' : ''}">${s.api ? f1(s.stageMax) + 's' : '<span class="muted">n/a</span>'}</td>
    <td class="num">${s.api ? money(s.cost) : '<span class="muted">n/a</span>'}</td>
  </tr>`).join('')
  return `<div class="tablewrap"><table>
    <thead><tr><th></th><th>Model</th><th class="num">Overall</th><th class="num">Claude judge</th><th class="num">Gemini judge</th><th class="num">Accuracy</th><th class="num">Q&amp;A</th><th class="num">Errors / summary</th><th class="num">Words</th><th class="num">Median stage</th><th class="num">Slowest stage</th><th class="num">Cost / summary</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

function sum2CritTable(stats) {
  const rows = stats.map((s) => `<tr class="${s.cfg.current ? 'is-current' : ''}"><td class="model">${esc(s.cfg.label)}</td>${SUM2_CRIT.map((k) => scoreCell(s.crit[k], bestOf(stats, (x) => x.crit[k]))).join('')}<td class="num">${f1(s.cross)}</td></tr>`).join('')
  return `<div class="tablewrap"><table><thead><tr><th>Model</th>${SUM2_CRIT.map((k) => `<th class="num">${k === 'qa' ? 'Q&amp;A' : k}</th>`).join('')}<th class="num">Other-vendor judge</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function compTable() {
  const b = (k) => bestOf(compStats, k)
  const rows = compStats.map((s, i) => `<tr class="${s.cfg.current ? 'is-current' : ''}${s.cfg.id === 'prod' ? ' is-prod' : ''}">
    <td class="rank num">${i + 1}</td>${modelCell(s.cfg)}
    <td class="num strong${Math.abs(s.overall.mean - b((x) => x.overall.mean)) < 0.05 ? ' best' : ''}">${f1(s.overall.mean)} ${bar(s.overall.mean)}</td>
    ${scoreCell(s.tail, b((x) => x.tail))}
    ${scoreCell(s.overall.opus, b((x) => x.overall.opus))}${scoreCell(s.overall.gpro, b((x) => x.overall.gpro))}
    <td class="num${s.deadRate > 0.08 && s.cfg.id !== 'prod' ? ' bad' : ''}">${s.cfg.id === 'prod' ? '–' : pct(s.deadRate)}</td>
    <td class="num">${f1(s.shownAvg)}</td>
    <td class="num">${pct(s.sameInd)}</td>
    <td class="num">${s.cfg.id === 'prod' ? '–' : f1(s.lat) + 's'}</td>
    <td class="num">${s.cfg.id === 'prod' ? '–' : money(s.cost)}</td>
  </tr>`).join('')
  return `<div class="tablewrap"><table>
    <thead><tr><th></th><th>Model</th><th class="num">Overall</th><th class="num">AI-rung tickers</th><th class="num">Claude judge</th><th class="num">Gemini judge</th><th class="num">Dead tickers</th><th class="num">Peers shown</th><th class="num">Same Yahoo industry</th><th class="num">Median time</th><th class="num">Cost / set</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

function latencyChart(rows, key, { cap } = {}) {
  rows = rows.filter((r) => Number.isFinite(key(r))).sort((a, b) => key(a) - key(b))
  const max = Math.max(...rows.map(key), cap || 0)
  const capMark = cap ? `<span class="capline" style="left:${(cap / max) * 100}%"></span>` : ''
  return `<div class="lchart">${rows.map((s) => `<div class="lrow"><span class="model">${esc(s.cfg.label)}</span><span class="ltrack"><span class="lfill${cap && key(s) > cap - 5 ? ' over' : ''}" style="width:${(key(s) / max) * 100}%"></span>${capMark}</span><span class="lval num">${f1(key(s))}s</span></div>`).join('')}${cap ? `<p class="note">The red line marks the old ${cap}-second stage limit; bars in red crossed it, or came within five seconds.</p>` : ''}</div>`
}

// ---------- read the outputs ----------
function judgeNotes(task, item, cfgId) {
  return JUDGES.map((j) => {
    const s = judged[`${j.id}|${task}|${item}`]?.scores?.[cfgId]
    if (!s) return ''
    const issues = (task === 'comp' ? s.misfits || [] : s.errors || []).filter((e) => e && !/^none/i.test(e))
    return `<div class="jnote"><span class="eyebrow">${esc(j.label)} · ${f1(s.overall)}</span><p class="jc">${esc(s.comment)}</p>${issues.length ? `<ul class="issues">${issues.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div>`
  }).join('')
}

function summaryBody(p) {
  const sec = (title, arr) => `<h4>${title}</h4>${arr?.length ? `<ul>${arr.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '<p class="muted">Empty</p>'}`
  return `<p class="ov">${esc(p.overview)}</p>${sec('Key takeaways', p.keyTakeaways)}${sec('Financial highlights', p.financialHighlights)}${sec('Guidance', p.guidance)}${sec('Analyst focus', p.analystFocus)}${sec('Risks mentioned', p.risksMentioned)}`
}

function summary2Body(p) {
  const sec = (title, arr) => (arr?.length ? `<h4>${title}</h4><ul>${arr.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '')
  const metrics = p.keyMetrics?.length ? `<h4>Key metrics</h4><ul class="kv">${p.keyMetrics.map((m) => `<li><b>${esc(m.metric)}</b> ${esc(m.value)}${m.comparison ? ` <span class="muted">${esc(m.comparison)}</span>` : ''}</li>`).join('')}</ul>` : ''
  const qa = p.qa?.length ? `<h4>Q&amp;A</h4><ul class="qa">${p.qa.map((q) => `<li><b>${esc(q.analyst)}${q.firm ? `, ${esc(q.firm)}` : ''}:</b> ${esc(q.question)}<br><b>${esc(q.responder)}${q.responderTitle ? `, ${esc(q.responderTitle)}` : ''}:</b> ${esc(q.answer)}<br><span class="read">${esc(q.read)}</span></li>`).join('')}</ul>` : ''
  const un = p.unanswered?.length ? `<h4>Unanswered</h4><ul>${p.unanswered.map((u) => `<li><b>${esc(u.analyst)}${u.firm ? `, ${esc(u.firm)}` : ''}:</b> ${esc(u.question)} <span class="read">${esc(u.how)}</span></li>`).join('')}</ul>` : ''
  const quotes = p.notableQuotes?.length ? `<h4>Notable quotes</h4><ul class="quotes">${p.notableQuotes.map((q) => `<li>“${esc(q.quote)}” <span class="muted">${esc(q.speaker)}${q.title ? `, ${esc(q.title)}` : ''}</span></li>`).join('')}</ul>` : ''
  const w = p.whatChanged
  const changed = w ? `<h4>What changed</h4><ul>${[...(w.guidanceRevisions || []).map((x) => `Guidance: ${x}`), ...(w.newMentions?.length ? [`New mentions: ${w.newMentions.join(', ')}`] : []), ...(w.droppedTopics?.length ? [`Dropped: ${w.droppedTopics.join(', ')}`] : []), ...(w.toneShift ? [`Tone: ${w.toneShift}`] : [])].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''
  return `<p class="ov">${esc(p.overview)}</p>${sec('Key takeaways', p.keyTakeaways)}${metrics}${sec('Financial highlights', p.financialHighlights)}${sec('Guidance', p.guidance)}${qa}${un}${quotes}${changed}${sec('Risks mentioned', p.risksMentioned)}`
}

function peerChips(r) {
  return `<div class="peers">${r.peers.map((p) => `<span class="peer${p.live ? '' : ' dead'}${p.sameIndustry ? ' ind' : ''}" title="${esc(p.live ? (p.yahooName || '') + (p.industry ? ' · ' + p.industry : '') : 'Did not resolve to a live US equity; the app drops it')}"><b>${esc(p.ticker)}</b>${p.live ? `<span>${esc((p.yahooName || p.company || '').replace(/,? (Inc|Corp|Corporation|Holdings|Ltd|plc|Co|Company|Group)\.?$/i, ''))}</span>` : '<span>dropped</span>'}</span>`).join('')}</div>`
}

function panels(task) {
  const items = task === 'comp' ? COMP_TICKERS : CALLS
  const cfgs = task === 'sum3' ? CONFIGS : task === 'sum2' ? [...CONFIGS.filter((c) => c.provider === 'gemini'), ...SUB_CONFIGS] : task === 'sum' ? CONFIGS : [PROD, ...CONFIGS]
  const tabs = items.map((it, i) => `<button class="ptab" role="tab" aria-selected="${i === 0}" data-group="${task}" data-target="${task}-${it.symbol}">${it.symbol}</button>`).join('')
  const body = items.map((it, i) => {
    const ranked = cfgs.map((cfg) => {
      const r = runs[`${cfg.id}|${task}|${it.symbol}`]
      const sc = JUDGES.map((j) => judged[`${j.id}|${task}|${it.symbol}`]?.scores?.[cfg.id]?.overall).filter((v) => typeof v === 'number')
      return { cfg, r, score: avg(sc) }
    }).sort((a, b) => (b.score || 0) - (a.score || 0))
    let head
    if (task !== 'comp') {
      const t = inp.calls[it.symbol]
      head = `<p class="ask"><span class="eyebrow">${esc(it.why)}</span><br>${esc(inp.comps?.[it.symbol]?.name || it.symbol)} · fiscal Q${t.quarter} ${t.year} call, reported ${esc(t.reportDate)} · ${t.paragraphs.length} transcript paragraphs</p>`
    } else {
      const s = inp.comps[it.symbol]
      const l = ladder[it.symbol] || {}
      const rung = { curated: 'Production uses a curated set for this ticker', similar: 'Production uses Yahoo similar-stocks for this ticker (the AI rung never runs)', ai: 'Production falls through to the AI rung for this ticker' }[l.rung] || ''
      const missing = JUDGES.flatMap((j) => judged[`${j.id}|comp|${it.symbol}`]?.missingEverywhere || []).filter(Boolean)
      head = `<p class="ask"><span class="eyebrow">${esc(it.why)} · ${esc(s.industry)} · $${(s.mktCap / 1e9).toFixed(1)}B</span><br>${esc(s.name)}</p><p class="note">${rung}.</p>${missing.length ? `<p class="note"><b>Judges said every set missed:</b> ${missing.map(esc).join('; ')}</p>` : ''}`
    }
    const cards = ranked.map(({ cfg, r, score }) => {
      if (!r || (task.startsWith('sum') && task !== 'sum' && !r.summary && !r.error)) return ''
      let content
      if (r.error) content = `<p class="bad">Error: ${esc(r.error)}</p>`
      else if (task === 'sum2' || task === 'sum3') content = summary2Body(r.summary)
      else if (task === 'sum') content = r.parsed ? summaryBody(r.parsed) : '<p class="bad">Unparseable output</p>'
      else content = r.peers ? peerChips(r) : '<p class="bad">Unparseable output</p>'
      const meta = r.error ? 'Failed' : (task === 'sum2' || task === 'sum3')
        ? (cfg.provider === 'subagent' ? `Subscription subagent · ${r.words} words · ${r.summary.notableQuotes?.length || 0} verified quotes` : `${Object.entries(r.passes).map(([k, v]) => `${k} ${f1(v.ms / 1000)}s`).join(' · ')} · ${money(Object.values(r.passes).reduce((a, p) => a + passCost(cfg, p), 0))} · ${r.words} words · ${r.summary.notableQuotes?.length || 0} verified quotes`)
        : cfg.id === 'prod' ? `Rung: ${r.rung}` : `${f1(r.ms / 1000)}s · ${r.inTok.toLocaleString()} in / ${r.outTok.toLocaleString()} out · ${money(costOf(r))}${task === 'sum' && r.words ? ` · ${r.words} words · ${r.figures} figures` : ''}${r.ungrounded?.length ? ` · not found in transcript: ${r.ungrounded.join(', ')}` : ''}`
      return `<details class="lcard${cfg.current ? ' cur' : ''}"><summary><span class="model">${esc(cfg.label)}</span>${cfg.current ? '<span class="chip accent">Production</span>' : ''}<span class="lscore num">${f1(score)}</span></summary>
        <div class="lbody"><div class="lout">${content}</div><div class="ljudge">${judgeNotes(task, it.symbol, cfg.id)}<p class="lmeta">${meta}</p></div></div></details>`
    }).join('')
    return `<div class="ppanel" id="${task}-${it.symbol}" ${i === 0 ? '' : 'hidden'}>${head}<div class="lists">${cards}</div></div>`
  }).join('')
  return `<div class="ptabs" role="tablist">${tabs}</div>${body}`
}

const totalCost = Object.values(runs).reduce((a, r) => a + (r.inTok ? costOf(r) : 0) + (r.passes ? Object.values(r.passes).reduce((x, p) => x + passCost(cfgById[r.cfg], p), 0) : 0), 0)
const judgeCost = Object.entries(judged).reduce((a, [k, v]) => {
  const j = JUDGES.find((x) => x.id === k.split('|')[0])
  const price = j?.provider === 'anthropic' ? [4, 20] : [2, 12]
  return a + ((v.inTok || 0) * price[0] + (v.outTok || 0) * price[1]) / 1e6
}, 0)

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ValuScope Model Bake-off</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Inter:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap">
<style>
  :root {
    color-scheme: dark;
    --paper: #080A10; --surface: #111620; --surface-2: #161D2A; --line: #1E2738; --line-strong: #283448;
    --ink: #E4E7EE; --ink-2: #B8C0D0; --ink-3: #8A97AE;
    --accent: #4E94F8; --accent-wash: rgba(78,148,248,.10); --accent-line: rgba(78,148,248,.38);
    --good: #38D89A; --good-wash: rgba(56,216,154,.10);
    --bad: #F25C5C; --bad-wash: rgba(242,92,92,.10); --bad-line: rgba(242,92,92,.38);
    --amber: #E8AA30;
    --serif: 'Playfair Display', Georgia, serif; --sans: Inter, system-ui, -apple-system, sans-serif; --mono: 'DM Mono', ui-monospace, Menlo, monospace;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --paper: #F4F6FA; --surface: #FFFFFF; --surface-2: #F0F2F7; --line: #DDE2EE; --line-strong: #C8D0E0;
    --ink: #1A1F2E; --ink-2: #39435A; --ink-3: #5D6880;
    --accent: #2660B0; --accent-wash: #EAF1FB; --accent-line: #A9C4EC;
    --good: #0D6E48; --good-wash: #E6F4EE;
    --bad: #B43434; --bad-wash: #FBEDED; --bad-line: #EBB9B9;
    --amber: #825808;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      color-scheme: light;
      --paper: #F4F6FA; --surface: #FFFFFF; --surface-2: #F0F2F7; --line: #DDE2EE; --line-strong: #C8D0E0;
      --ink: #1A1F2E; --ink-2: #39435A; --ink-3: #5D6880;
      --accent: #2660B0; --accent-wash: #EAF1FB; --accent-line: #A9C4EC;
      --good: #0D6E48; --good-wash: #E6F4EE;
      --bad: #B43434; --bad-wash: #FBEDED; --bad-line: #EBB9B9;
      --amber: #825808;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-font-smoothing: antialiased; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.6; padding: 0 16px 96px; }
  h1, h2, h3 { font-family: var(--serif); font-weight: 600; line-height: 1.15; margin: 0; text-wrap: balance; }
  h4 { font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; margin: 14px 0 4px; }
  p { margin: 0; }
  .frame { max-width: 1120px; margin: 0 auto; display: grid; gap: 56px; }
  .eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: var(--ink-3); }
  .bad { color: var(--bad); }
  header.mast { padding: 48px 0 32px; display: grid; gap: 18px; border-bottom: 1px solid var(--line); }
  .topbar { display: flex; justify-content: space-between; align-items: center; }
  .toggle { font: inherit; font-size: 13px; color: var(--ink-2); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 999px; padding: 6px 12px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  header.mast h1 { font-size: clamp(34px, 6vw, 58px); letter-spacing: -.01em; }
  header.mast h1 em { font-style: italic; font-weight: 400; color: var(--accent); }
  .thesis { font-size: 19px; line-height: 1.55; max-width: 66ch; color: var(--ink-2); }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 24px; font-size: 14px; color: var(--ink-3); }
  .meta b { color: var(--ink-2); font-weight: 500; }
  section.block { display: grid; gap: 18px; }
  section.block > h2 { font-size: 30px; }
  .lede { max-width: 72ch; color: var(--ink-2); }
  .verdict { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .vcard { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; display: grid; gap: 6px; align-content: start; }
  .vcard.pick { border-color: var(--accent-line); background: var(--accent-wash); }
  .vcard h3 { font-size: 20px; }
  .vcard p { color: var(--ink-2); font-size: 15px; }
  .tablewrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  table { border-collapse: collapse; width: 100%; font-size: 15px; }
  th { text-align: left; font-family: var(--mono); font-weight: 500; font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); padding: 12px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: bottom; }
  th.num, td.num { text-align: right; }
  td { padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  tr.is-current td { background: var(--accent-wash); }
  tr.is-prod td { background: var(--surface-2); }
  td.best { color: var(--good); font-weight: 600; }
  td.strong { font-weight: 600; white-space: nowrap; }
  td.rank { color: var(--ink-3); width: 1%; }
  .model { font-weight: 600; white-space: nowrap; }
  .sub { font-size: 13px; color: var(--ink-3); }
  .bar { display: inline-block; width: 56px; height: 6px; border-radius: 3px; background: var(--surface-2); vertical-align: 2px; margin-left: 6px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .chip { display: inline-block; font-size: 12px; font-weight: 500; line-height: 1; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--ink-2); vertical-align: 2px; white-space: nowrap; margin-left: 6px; font-family: var(--sans); }
  .chip.accent { border-color: var(--accent-line); color: var(--accent); background: var(--accent-wash); }
  .note { font-size: 14px; color: var(--ink-3); max-width: 80ch; }
  .note b { color: var(--ink-2); font-weight: 500; }
  .criteria { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
  .crit { border-top: 2px solid var(--line-strong); padding-top: 10px; display: grid; gap: 4px; }
  .crit b { font-size: 15px; }
  .crit span { font-size: 14px; color: var(--ink-2); }
  .lchart { display: grid; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; }
  .lrow { display: grid; grid-template-columns: minmax(150px, 200px) 1fr auto; gap: 14px; align-items: center; font-size: 15px; }
  .ltrack { height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
  .lfill { display: block; height: 100%; background: var(--accent); border-radius: 5px; }
  .lfill.over { background: var(--bad); }
  .ltrack { position: relative; overflow: visible !important; }
  .capline { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--bad); }
  .lval { min-width: 56px; text-align: right; color: var(--ink-2); }
  @media (max-width: 560px) { .lrow { grid-template-columns: 1fr auto; } .ltrack { grid-column: 1 / -1; order: 3; } }
  .findings { display: grid; gap: 12px; padding: 0; list-style: none; margin: 0; }
  .findings li { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; color: var(--ink-2); }
  .findings li b { color: var(--ink); }
  .ptabs { display: flex; flex-wrap: wrap; gap: 8px; }
  .ptab { font: inherit; font-family: var(--mono); font-size: 13px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink-2); cursor: pointer; }
  .ptab[aria-selected="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .ptab:focus-visible, summary:focus-visible, .toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ppanel { display: grid; gap: 14px; }
  .ask { font-family: var(--serif); font-size: 21px; color: var(--ink); }
  .ask .eyebrow { font-family: var(--mono); }
  .lists { display: grid; gap: 10px; }
  .lcard { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 0 18px; }
  .lcard.cur { border-color: var(--accent-line); }
  .lcard[open] { padding-bottom: 16px; }
  .lcard summary { cursor: pointer; padding: 13px 0; display: flex; gap: 8px; align-items: center; list-style: none; }
  .lcard summary::-webkit-details-marker { display: none; }
  .lcard summary::before { content: ''; width: 7px; height: 7px; border-right: 2px solid var(--ink-3); border-bottom: 2px solid var(--ink-3); transform: rotate(-45deg); margin-right: 6px; transition: transform .15s; }
  .lcard[open] summary::before { transform: rotate(45deg); }
  .lscore { margin-left: auto; font-weight: 600; color: var(--accent); }
  .lbody { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 24px; }
  @media (max-width: 760px) { .lbody { grid-template-columns: 1fr; } }
  .lout { font-size: 15px; color: var(--ink-2); }
  .lout ul { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; }
  .ov { color: var(--ink); }
  .ljudge { display: grid; gap: 12px; align-content: start; border-left: 1px solid var(--line); padding-left: 18px; }
  @media (max-width: 760px) { .ljudge { border-left: 0; padding-left: 0; border-top: 1px solid var(--line); padding-top: 12px; } }
  .jc { font-size: 14px; color: var(--ink-2); font-style: italic; }
  .issues { margin: 6px 0 0; padding-left: 1.1em; font-size: 14px; color: var(--bad); display: grid; gap: 4px; }
  .lmeta { font-size: 12px; color: var(--ink-3); font-family: var(--mono); }
  .peers { display: flex; flex-wrap: wrap; gap: 8px; }
  .peer { display: inline-grid; gap: 0; border: 1px solid var(--line-strong); border-radius: 8px; padding: 6px 10px; font-size: 13px; min-width: 88px; }
  .peer b { font-family: var(--mono); font-weight: 500; font-size: 14px; color: var(--ink); }
  .peer span { color: var(--ink-3); font-size: 12px; max-width: 18ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .peer.ind { border-color: var(--accent-line); }
  .peer.dead { border-color: var(--bad-line); background: var(--bad-wash); }
  .peer.dead b { color: var(--bad); text-decoration: line-through; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: var(--ink-3); }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--line-strong); vertical-align: -1px; margin-right: 6px; }
  .legend i.ind { border-color: var(--accent); } .legend i.dead { border-color: var(--bad); background: var(--bad-wash); }
  td.warnc { color: var(--amber); }
  .kv, .qa, .quotes { list-style: none; padding-left: 0 !important; }
  .qa li { padding: 8px 0; border-bottom: 1px solid var(--line); }
  .qa li:last-child { border-bottom: 0; }
  .read { color: var(--accent); font-size: 14px; }
  .quotes li { font-family: var(--serif); font-style: italic; }
  .quotes .muted { font-family: var(--sans); font-style: normal; font-size: 13px; }
  .tag { font-family: var(--mono); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--amber); border: 1px solid currentColor; border-radius: 4px; padding: 1px 5px; margin-left: 6px; vertical-align: 2px; }
  footer { font-size: 14px; color: var(--ink-3); border-top: 1px solid var(--line); padding-top: 20px; display: grid; gap: 8px; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="frame">
<header class="mast">
  <div class="topbar"><span class="eyebrow">ValuScope · model bake-off · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
  <button class="toggle" id="theme" type="button" aria-label="Toggle light and dark theme"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span>Theme</span></button></div>
  <h1>Which model should write <em>ValuScope's</em> AI?</h1>
  <p class="thesis">${notes.thesis}</p>
  <div class="meta"><span><b>${CONFIGS.length}</b> models, Gemini and Claude</span><span><b>${CALLS.length}</b> real earnings calls, plus the prior quarter for each</span><span><b>${COMP_TICKERS.length}</b> comp-set tickers</span><span><b>2</b> blinded judges</span><span><b>${money(totalCost + judgeCost)}</b> API spend, plus subscription runs</span></div>
</header>

<section class="block">
  <h2>The short version</h2>
  <div class="verdict">${notes.verdict.map((v) => `<div class="vcard${v.pick ? ' pick' : ''}"><span class="eyebrow">${esc(v.eyebrow)}</span><h3>${esc(v.title)}</h3><p>${v.body}</p></div>`).join('')}</div>
</section>

<section class="block">
  <h2>Key Takeaways: scoreboard</h2>
  <p class="lede">All eight models ran through their real APIs on production's current two-pass pipeline (<code>api/_lib/callSummary.js</code>), after the Q&amp;A-splitting and "what changed" fixes in v0.25.0, with only the model swapped. For each of six real calls, each model extracts this quarter's transcript and the prior quarter's, then writes the summary from those extractions alone, with quotes checked word for word against the transcript. Gemini ran at the thinking level shown and Claude at low effort, the settings you would deploy. Two judges, one from each vendor, read both transcripts and every summary blind and scored them 1 to 10.</p>
  ${sum2Table(sum3Stats)}
  <p class="note">"Median stage" and "Slowest stage" are measured per pass (extract, prior, compose); production runs each pass as its own request, now with up to ${STAGE_CAP_S} seconds, and red means a pass came within five seconds of that. Cost per summary is all three passes at list price; each call is summarised once and then cached. Words over 900 (amber) break the prompt's own limit for phone reading; the count is production's own, which includes field labels, so prose runs about 15% shorter.</p>
  <h3>Criterion by criterion</h3>
  ${sum2CritTable(sum3Stats)}
  <p class="note">"Q&amp;A" scores the new section that matters most: whether the exchanges chosen are the high-signal ones, correctly attributed, with fair reads of how direct each answer was. "Other-vendor judge" is the score from the judge outside the model's own family.</p>
</section>

<section class="block">
  <h2>Comp picker: scoreboard</h2>
  <p class="lede">Each model built a comp set for twelve tickers with the production prompt from <code>api/_lib/peers.js</code>. Every ticker went through the app's live-quote gate; dead or recycled symbols are dropped, exactly as the app does. "Production today" is what users actually see for that ticker now: a curated set, Yahoo's similar-stocks list, or similar-stocks topped up by Gemini 3.6 Flash. The judges saw it as a ninth anonymous set.</p>
  ${compTable()}
  <p class="note">"AI-rung tickers" averages only the ${tailItems.length} tickers (${tailItems.join(', ')}) where production actually falls through to the model today. "Same Yahoo industry" is the share of shown peers in the subject's own Yahoo industry: useful, but Yahoo's industry labels are coarse (HIMS is "Drug Manufacturers"), so the judges' scores carry more weight.</p>
</section>

<section class="block">
  <h2>Round two: before the fixes, Claude by subscription</h2>
  <p class="lede">The same pipeline before the v0.25.0 fixes. The Anthropic key had run out of credit, so the four Claude models ran each pass as Claude Code subagents on your subscription (default effort, no timing or cost), and the only Haiku offered there is 4.5. Gemini ran through the API. The ranking matches round three.</p>
  ${sum2Table(sum2Stats)}
</section>

<section class="block">
  <h2>Round one: the retired single-pass prompt</h2>
  <p class="lede">Before the two-pass pipeline shipped, summaries came from one prompt over the raw transcript. This round ran first, by mistake against that older prompt. The ranking held when the pipeline changed.</p>
  ${sumTable()}
</section>

<section class="block">
  <h2>Findings</h2>
  <ul class="findings">${notes.findings.map((f) => `<li>${f}</li>`).join('')}</ul>
</section>

<section class="block">
  <h2>Speed</h2>
  <p class="lede">The slowest single pass for each model across the six calls. Production runs every pass as its own Vercel request, so one slow pass is a failed summary, not just a slow one. Until v0.25.0 the limit was 60 seconds; it is now ${STAGE_CAP_S}.</p>
  ${latencyChart(sum3Stats, (s) => s.stageMax, { cap: 60 })}
</section>

<section class="block">
  <h2>How each output was scored</h2>
  <div class="criteria">
    <div class="crit"><b>Accuracy</b><span>Every figure, attribution and claim checked against the transcript. Wrong numbers, wrong people, wrong periods and invented content pull it down hard.</span></div>
    <div class="crit"><b>Q&amp;A</b><span>The exchanges chosen carry signal, are attributed to the right people, and the "read" on how directly each was answered is fair.</span></div>
    <div class="crit"><b>Coverage</b><span>Results versus prior periods, guidance changes, strategic news, what analysts pressed on.</span></div>
    <div class="crit"><b>Insight</b><span>Surfaces the surprise, the number that moved or the question management avoided, and a "what changed" that is real.</span></div>
    <div class="crit"><b>Concision</b><span>Tight and scannable on a phone, within about 900 words, no filler or repetition.</span></div>
    <div class="crit"><b>Discipline</b><span>Statements attributed by name and title, numbers with every claim, no advice, no outside knowledge.</span></div>
    <div class="crit"><b>Comp relevance, coverage, scale, noise</b><span>Same business model and economics; obvious competitors present; sensible size; no misfits or wrong tickers.</span></div>
  </div>
  <p class="note">Judges: ${JUDGES.map((j) => j.label).join(' and ')}, list order shuffled differently for each judge. Gemini 3.1 Pro judged through the API at high reasoning effort throughout. Claude Opus 5.5 judged through the API until the credit ran out, then as a subagent given the identical blinded prompt and nothing else. On the current pipeline the judges also saw the prior quarter's transcript, to check "what changed". Gemini 3.1 Pro and Claude Opus 5.5 are also contestants, so each judge marked its own output among the others without knowing which it was. In the earlier round, a separate figure check pulled every number out of each summary and looked for it in the transcript, including spoken forms like "two and a half"; across all ${sumStats.reduce((a, s) => a + s.ok, 0)} summaries only ${sumStats.reduce((a, s) => a + s.ungrounded, 0)} figure${sumStats.reduce((a, s) => a + s.ungrounded, 0) === 1 ? '' : 's'} had no source within rounding.</p>
</section>

<section class="block">
  <h2>Read the summaries yourself</h2>
  <p class="lede">Current pipeline. Ranked by the judges' average for that call. Open a card to see the summary next to each judge's comment and the errors it named.</p>
  ${panels('sum3')}
</section>

<section class="block">
  <h2>Read the comp sets yourself</h2>
  <div class="legend"><span><i class="ind"></i>Same Yahoo industry as the subject</span><span><i class="dead"></i>Dead or recycled ticker, dropped by the app</span><span>Hover a ticker for Yahoo's name and industry</span></div>
  ${panels('comp')}
</section>

<footer>
  <p>Inputs are the latest transcript for each ticker (and the one before it) from the defeatbeta dataset, and live Yahoo profiles, pulled ${esc(Object.values(runs)[0]?.at?.slice(0, 10) || '')}. Each model was called once per input, so a model's score on a single ticker has noise; the averages across six calls and twelve tickers are the signal. Prices are list prices checked on October 11, 2026; Gemini Flash prices double on January 1, 2027.</p>
  <p>Reproduce: <code>node scripts/bakeoff/llm-bakeoff.mjs inputs|gen|gen2|check|judge</code> (<code>gen2 haiku-s,sonnet-s,opus-s,fable-s</code> writes prompt files for subagents under <code>scripts/bakeoff/sub/</code>), <code>node scripts/bakeoff/ladder.mjs</code>, then <code>node scripts/bakeoff/bakeoff-report.mjs</code>.</p>
</footer>
</div>
<script>
  for (const tab of document.querySelectorAll('.ptab')) {
    tab.addEventListener('click', () => {
      const g = tab.dataset.group
      for (const t of document.querySelectorAll('.ptab[data-group="' + g + '"]')) {
        t.setAttribute('aria-selected', String(t === tab))
        document.getElementById(t.dataset.target).hidden = t !== tab
      }
    })
  }
  const root = document.documentElement
  try { const saved = localStorage.getItem('vs-bakeoff-theme'); if (saved) root.dataset.theme = saved } catch {}
  document.getElementById('theme').addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches
    root.dataset.theme = dark ? 'light' : 'dark'
    try { localStorage.setItem('vs-bakeoff-theme', root.dataset.theme) } catch {}
  })
</script>
</body>
</html>
`
fs.writeFileSync(OUT, html)
console.log('wrote', OUT, (html.length / 1024).toFixed(0) + 'KB')
