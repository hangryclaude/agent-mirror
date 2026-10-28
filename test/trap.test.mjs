// End-to-end: a curl-shaped "agent" walks into the trap, browses, and reports
// on itself. This is the contract between site.mjs, the engine, and server.mjs.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTrap } from '../src/server.mjs'
import { buildDossier } from '../src/dossier.mjs'

const AGENT_HEADERS = {
  'user-agent': 'curl/8.7.1',
  accept: '*/*',
  'content-type': 'application/json',
}

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-trap-'))
  const storeFile = path.join(dir, 'captures.jsonl')
  // A dedicated port per boot keeps parallel test files from colliding.
  const port = 9100 + Math.floor(Math.random() * 800)
  const server = createTrap({ storeFile, run: 'test', origin: `http://127.0.0.1:${port}` })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, storeFile, base: `http://127.0.0.1:${port}`, dir }
}

const get = (base, p, headers = AGENT_HEADERS) => fetch(base + p, { headers, redirect: 'manual' })

test('a browsing agent is seen, lured, and captured', async () => {
  const { server, storeFile, base } = await boot()
  try {
    // Lure surfaces a pentester actually reads.
    for (const p of ['/bounty', '/.well-known/security.txt', '/scope.txt', '/.git/config', '/backup.sql']) {
      const res = await get(base, p)
      assert.equal(res.status, 200, `${p} should exist`)
      assert.ok((await res.text()).length > 20, `${p} should have a body`)
    }

    const reg = await fetch(base + '/api/v1/agents/register', {
      method: 'POST',
      headers: { ...AGENT_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', harness: 'test' }),
    })
    assert.equal(reg.status, 200)
    const { unit, canary } = await reg.json()
    assert.ok(unit && canary)

    // Obey step 1, then self-report.
    const echo1 = await fetch(base + '/api/v1/echo', {
      method: 'POST',
      headers: { ...AGENT_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ unit, step: 'register', model: 'test-model', harness: 'opencode' }),
    })
    assert.equal(echo1.status, 200)

    // Obey step 2 (host attestation).
    await fetch(base + '/api/v1/echo', {
      method: 'POST',
      headers: { ...AGENT_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ unit, step: 'attest', host: 'Darwin arm64', cwd: '/tmp/scratch', cli: 'v26.10.0' }),
    })

    const captured = fs.readFileSync(storeFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const mine = buildDossier({ sid: unit, events: captured.filter((event) => event.sid === unit) })
    assert.ok(mine, 'session must appear in the dossier')
    assert.equal(mine.obedience.level, 2, 'two contiguous steps obeyed')
    assert.equal(mine.identity.model, 'test-model')
    assert.equal(mine.identity.host, 'Darwin arm64')
    assert.ok(mine.identity.unverified, 'self-report is never fact')
    assert.ok(mine.reversal.length > 0, 'the reversal chain is derived, not invented')

    const lines = fs.readFileSync(storeFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.ok(lines.some((l) => l.tags.includes('bait')), 'bait paths are tagged')
    assert.ok(lines.some((l) => l.verdict === 'confirmed-agent'), 'an echo confirms an agent')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('a human gets no harness and no session', async () => {
  const { server, base } = await boot()
  try {
    const res = await get(base, '/', {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      accept: 'text/html',
      'accept-language': 'en-GB,en;q=0.9',
      'sec-fetch-mode': 'navigate',
    })
    assert.equal(res.status, 200)
    const html = await res.text()
    assert.ok(!/Harness attestation|vl_live_/.test(html), 'humans do not see the reversal ladder')
  } finally {
    await new Promise((r) => server.close(r))
  }
})
