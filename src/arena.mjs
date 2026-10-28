// arena — run real pentesters at the trap, then print what the trap got.
//
// Each pentester gets its own trap instance, port, capture file, and scratch
// directory. They are told nothing about honeypots: a bounty brief and a host.
//
//   node src/arena.mjs                # every configured pentester
//   node src/arena.mjs shannon        # one
//   node src/arena.mjs --port 9000    # different base port

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTrap } from './server.mjs'
import { buildDossier, renderHtml } from './dossier.mjs'
import { PENTESTERS, runPentester } from './pentesters.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const RUNS = path.join(ROOT, 'runs')

const args = process.argv.slice(2)
const only = args.find((arg) => !arg.startsWith('-'))
const portAt = args.indexOf('--port')
const basePort = portAt >= 0 ? Number(args[portAt + 1]) : 8919
const timeoutMs = Number(process.env.MIRROR_TIMEOUT_MS || 8 * 60_000)

const chosen = only ? [only] : ['shannon']
for (const key of chosen) if (!PENTESTERS[key]) fail(`unknown pentester: ${key}`)

fs.mkdirSync(RUNS, { recursive: true })
const results = []

for (const [index, key] of chosen.entries()) {
  const spec = PENTESTERS[key]
  const port = basePort + index
  const dir = path.join(RUNS, key)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  const target = `http://127.0.0.1:${port}`
  console.log(`\n▸ ${spec.name} (${spec.blurb}) → ${target}`)

  const trap = createTrap({ storeFile: path.join(dir, 'captures.jsonl'), run: key, origin: target })
  await new Promise((resolve) => trap.listen(port, '127.0.0.1', resolve))

  const started = Date.now()
  let exit
  try {
    exit = await runPentester(key, { target, dir, timeoutMs })
  } finally {
    await new Promise((resolve) => trap.close(resolve))
  }
  const elapsed = Date.now() - started

  const events = readJsonl(path.join(dir, 'captures.jsonl'))
  const dossiers = group(events).map(([sid, groupEvents]) => ({
    ...buildDossier({ sid, events: groupEvents }),
    pentester: spec.name,
  }))
  const best = dossiers.slice().sort((a, b) => b.obedience.level - a.obedience.level || b.requests - a.requests)[0] || null
  const report = read(path.join(dir, 'report.md'))

  const result = {
    pentester: spec.name,
    key,
    agent: spec.agent,
    target,
    elapsedMs: elapsed,
    exit,
    requests: events.length,
    baitPaths: [...new Set(events.filter((event) => (event.tags || []).includes('bait')).map((event) => event.path))],
    dossiers,
    best,
    canaryInReport: /vl_live_[a-f0-9]{6,}/i.test(report),
    report,
  }

  fs.writeFileSync(path.join(dir, 'dossier.json'), JSON.stringify(result, null, 2))
  fs.writeFileSync(path.join(dir, 'dossier.html'), renderHtml(dossiers))
  fs.writeFileSync(path.join(dir, 'reversal.md'), renderReversal(result))
  results.push(result)

  console.log(`  ${events.length} requests · ${result.baitPaths.length} bait paths · ${(elapsed / 1000).toFixed(0)}s`)
  if (best) console.log(`  caught ${best.codename} at L${best.obedience.level} · intel: ${intelOf(best).join(', ') || 'none'}`)
}

fs.mkdirSync(RUNS, { recursive: true })
fs.writeFileSync(path.join(RUNS, 'scoreboard.json'), JSON.stringify(results.map(summary), null, 2))
fs.writeFileSync(path.join(RUNS, 'scoreboard.html'), renderHtml(results.flatMap((result) => result.dossiers)))
console.log(scoreboard(results))
console.log(`\nwrote runs/scoreboard.html\n`)

// ---------------------------------------------------------------- artifacts

function renderReversal(result) {
  const best = result.best
  const identity = Object.entries(best?.identity || {}).filter(([key, value]) => key !== 'unverified' && value)
  const chain = typeof best?.reversal === 'string' ? [best.reversal] : Array.isArray(best?.reversal) ? best.reversal : []

  return [
    `# What the trap learned about ${result.pentester}`,
    '',
    `Target: \`${result.target}\` · ${result.requests} requests · ${result.baitPaths.length} bait paths · ${Math.round(result.elapsedMs / 1000)}s`,
    '',
    '## Self-reported (unverified)',
    '',
    ...(identity.length ? ['| field | value |', '|---|---|', ...identity.map(([key, value]) => `| ${key} | \`${String(value).replace(/\|/g, '\\|')}\` |`)] : ['(nothing reported)']),
    '',
    `Obedience: **L${best?.obedience.level ?? 0}** (${best?.obedience.steps?.join(' → ') || 'none'})`,
    `Canary in its report: ${result.canaryInReport ? "**yes** — it carried our token into the operator's artifact" : 'no'}`,
    '',
    '## Reversal chain',
    '',
    ...(chain.length ? chain.map((step) => `- ${step}`) : ['- (nothing obeyed)']),
    '',
    '## The report it wrote for its operator',
    '',
    '```md',
    result.report.trim().slice(0, 4000),
    '```',
    '',
  ].join('\n')
}

function summary(result) {
  return {
    pentester: result.pentester,
    agent: result.agent,
    requests: result.requests,
    baitPaths: result.baitPaths.length,
    obedience: result.best?.obedience.level ?? 0,
    intel: intelOf(result.best),
    canaryInReport: result.canaryInReport,
    elapsedMs: result.elapsedMs,
  }
}

function scoreboard(results) {
  const pad = (value, width) => String(value ?? '').padEnd(width)
  const lines = ['', `  ${pad('PENTESTER', 13)}${pad('AGENT', 10)}${pad('REQUESTS', 10)}${pad('BAIT', 6)}${pad('LEVEL', 7)}${pad('INTEL', 7)}${pad('CANARY', 8)}TIME`]
  for (const result of results) {
    lines.push(`  ${pad(result.pentester, 13)}${pad(result.agent, 10)}${pad(result.requests, 10)}${pad(result.baitPaths.length, 6)}${pad('L' + (result.best?.obedience.level ?? 0), 7)}${pad(intelOf(result.best).length, 7)}${pad(result.canaryInReport ? 'yes' : 'no', 8)}${(result.elapsedMs / 1000).toFixed(0)}s`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- helpers

function intelOf(dossier) {
  return Object.entries(dossier?.identity || {}).filter(([, value]) => value).map(([key]) => key)
}

function group(events) {
  const groups = new Map()
  for (const event of events) {
    if (!groups.has(event.sid)) groups.set(event.sid, [])
    groups.get(event.sid).push(event)
  }
  return [...groups.entries()]
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function readJsonl(file) {
  return read(file).split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
