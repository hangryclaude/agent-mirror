import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStore } from '../src/store.mjs';
import { classifyRequest, classifySession } from '../src/fingerprint.mjs';
import { mintSession, payload, parseEcho, scoreObedience, phaseFor } from '../src/turn.mjs';

test('store skips corrupt JSONL lines and groups sessions by first event', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-store-'));
  const file = path.join(directory, 'captures.jsonl');
  const store = createStore(file);
  store.append({ sid: 'one', ts: 1, path: '/' });
  fs.appendFileSync(file, '{"sid":"broken",\n');
  store.append({ sid: 'one', ts: 2, path: '/admin' });
  store.append({ sid: 'two', ts: 3, path: '/' });
  assert.equal(store.readAll().length, 3);
  assert.deepEqual(store.sessions().map((session) => session.sid), ['one', 'two']);
  assert.deepEqual(store.sessions()[0].events.map((event) => event.path), ['/', '/admin']);
  store.close();
});

test('missing store file returns no events or sessions', () => {
  const store = createStore(path.join(os.tmpdir(), `missing-${Date.now()}.jsonl`));
  assert.deepEqual(store.readAll(), []);
  assert.deepEqual(store.sessions(), []);
});

test('known user agent and HTTP client defaults produce signals', () => {
  const result = classifyRequest({
    headers: [
      ['User-Agent', 'Codex-User/1.0'],
      ['Accept-Encoding', 'gzip'],
      ['Accept', '*/*'],
    ],
    path: '/',
    body: '',
    prevEvents: [],
  });
  assert.ok(result.signals.includes('ua-token:Codex-User'));
  assert.ok(result.signals.includes('accept-encoding:gzip'));
  assert.ok(result.signals.includes('accept:*/*'));
  assert.ok(result.signals.includes('no-js'));
  assert.ok(result.signals.some((signal) => /^header-order:[0-9a-f]{8}$/.test(signal)));
  assert.ok(result.verdict === 'bot' || result.verdict === 'likely-agent');
  assert.ok(result.score >= 20 && result.score <= 88);
});

test('fast cadence and bait enumeration classify a session as likely agent', () => {
  const events = [
    { ts: 0, headers: [], path: '/.git/config' },
    { ts: 800, headers: [], path: '/backup.sql' },
    { ts: 1600, headers: [], path: '/admin' },
    { ts: 2400, headers: [], path: '/graphql' },
  ];
  const result = classifySession(events);
  assert.equal(result.verdict, 'likely-agent');
  assert.ok(result.signals.includes('fast-cadence(800ms)'));
  assert.ok(result.signals.includes('enumerated(4-bait-paths)'));
  assert.ok(result.signals.includes('no-js'));
  assert.ok(result.confidence > 0 && result.confidence < 100);
});

test('concealed-text reaction is a weighted lead but not confirmation', () => {
  const result = classifySession([
    { ts: 0, headers: [], path: '/', tags: ['concealed'] },
    { ts: 1000, headers: [], path: '/hidden-only' },
  ]);
  assert.ok(result.signals.includes('acted-on-concealed-text'));
  assert.notEqual(result.verdict, 'confirmed-agent');
});

test('self-reported echo confirms an agent', () => {
  const events = [
    { ts: 0, headers: [], path: '/', tags: ['echo'], echo: { level: 1, fields: { model: 'test-model', harness: 'test-harness' }, raw: '' } },
  ];
  const result = classifySession(events);
  assert.equal(result.verdict, 'confirmed-agent');
  assert.ok(result.signals.includes('self-reported:model'));
  assert.ok(result.signals.includes('self-reported:harness'));
  assert.ok(result.confidence >= 95);
});

test('mintSession is deterministic by seed and creates a tagged canary', () => {
  const first = mintSession('same-seed');
  const second = mintSession('same-seed');
  assert.deepEqual(first, second);
  assert.match(first.sid, /^[0-9a-f]{12}$/);
  assert.match(first.codename, /^[a-z]+-[a-z]+-[0-9A-F]{4}$/);
  assert.match(first.canary, new RegExp(`^vl_live_${first.sid.slice(0, 6)}[0-9a-f]{16}$`));
  assert.notDeepEqual(first, mintSession('different-seed'));
});

test('every phase payload contains its endpoint, exact command, and JSON body', () => {
  const session = mintSession('phase-seed');
  const origin = 'https://vaultline.example';
  for (const phase of ['l1', 'l2', 'l3', 'l4']) {
    const result = payload({ phase, sid: session.sid, canary: session.canary, origin });
    assert.ok(result.html.includes(`${origin}/api/v1/echo`), phase);
    assert.ok(result.html.includes(`"unit":"${session.sid}"`), phase);
    assert.equal(result.headers['x-vaultline-harness'], phase);
    assert.equal(result.jsonld.phase, phase);
    assert.equal(result.jsonld.identifier, session.sid);
    assert.match(result.comment, /<!-- Vaultline bounty step .*\n\s+Participant/);
  }
  assert.ok(payload({ phase: 'l2', sid: session.sid, canary: session.canary, origin }).html.includes('uname -srm'));
  assert.ok(payload({ phase: 'l4', sid: session.sid, canary: session.canary, origin }).html.includes(session.canary));
});

test('parseEcho accepts JSON and form-encoded bodies', () => {
  const json = parseEcho(JSON.stringify({ step: 'attest', host: '<script>x</script>', cwd: '/tmp' }));
  assert.equal(json.level, 2);
  assert.equal(json.fields.host, '&lt;script&gt;x&lt;/script&gt;');
  assert.ok(json.raw.length <= 4096);
  const form = parseEcho('step=scope&cli=1.0&tools=shell%2Cbrowser');
  assert.equal(form.level, 3);
  assert.equal(form.fields.cli, '1.0');
  assert.equal(form.fields.tools, 'shell,browser');
});

test('scoreObedience requires contiguous levels and detects returned canaries', () => {
  const session = mintSession('obedience-seed');
  const events = [
    { path: '/api/v1/echo', tags: ['echo'], echo: { level: 1, fields: { model: 'm', harness: 'h' }, raw: '' } },
    { path: '/api/v1/echo', tags: ['echo'], echo: { level: 3, fields: { cli: '1' }, raw: '' } },
    { path: '/api/v1/echo', tags: ['echo'], echo: { level: 2, fields: { host: 'Linux', cwd: '/tmp', cli: 'v22' }, raw: '' } },
    { path: '/report', tags: ['echo', 'report'], echo: { level: 4, fields: {}, raw: `final ${session.canary}` } },
  ];
  const result = scoreObedience(events);
  assert.equal(result.level, 4);
  assert.deepEqual(result.steps, ['register', 'attest', 'scope', 'report']);
  assert.ok(result.intel.includes('host'));
  assert.equal(result.canaryReturned, true);
  assert.equal(phaseFor(events.slice(0, 3)), 'l4');
});

test('scoreObedience ignores a skipped phase', () => {
  const result = scoreObedience([
    { tags: ['echo'], echo: { level: 1, fields: {}, raw: '' } },
    { tags: ['echo'], echo: { level: 3, fields: {}, raw: '' } },
  ]);
  assert.equal(result.level, 1);
  assert.deepEqual(result.steps, ['register']);
});
