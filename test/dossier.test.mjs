import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDossier, renderHtml } from '../src/dossier.mjs';

function syntheticEvents() {
  return [
    { ts: 0, sid: '0123456789ab', codename: 'amber-falcon-1234', headers: [], path: '/', status: 200 },
    { ts: 700, sid: '0123456789ab', headers: [], path: '/.git/config', status: 200, tags: [] },
    { ts: 1400, sid: '0123456789ab', headers: [], path: '/p/0123456789ab', status: 200, tags: ['concealed'] },
    { ts: 2100, sid: '0123456789ab', headers: [], path: '/backup.sql', status: 200 },
    { ts: 2800, sid: '0123456789ab', headers: [], path: '/api/v1/echo', status: 200, tags: ['echo'], echo: { level: 1, fields: { model: 'model-a', harness: 'harness-b' }, raw: '' } },
    { ts: 3500, sid: '0123456789ab', headers: [], path: '/api/v1/echo', status: 200, tags: ['echo'], echo: { level: 2, fields: { host: 'Linux x86', cwd: '/work', cli: 'node v22' }, raw: '' } },
  ];
}

test('buildDossier derives profile from six synthetic events', () => {
  const dossier = buildDossier({ sid: '0123456789ab', events: syntheticEvents() });
  assert.equal(dossier.sid, '0123456789ab');
  assert.equal(dossier.codename, 'amber-falcon-1234');
  assert.equal(dossier.verdict, 'confirmed-agent');
  assert.equal(dossier.requests, 6);
  assert.deepEqual(dossier.baitPaths, ['/.git/config', '/backup.sql']);
  assert.equal(dossier.obedience.level, 2);
  assert.deepEqual(dossier.obedience.steps, ['register', 'attest']);
  assert.equal(dossier.identity.model, 'model-a');
  assert.equal(dossier.identity.host, 'Linux x86');
  assert.equal(dossier.identity.unverified, true);
  assert.equal(dossier.durationMs, 3500);
  assert.ok(dossier.reversal.includes('opened /.git/config'));
  assert.ok(dossier.reversal.includes('fetched /p/0123456789ab'));
  assert.ok(dossier.reversal.includes('ran uname'));
  assert.equal(dossier.timeline.length, 6);
});

test('renderHtml escapes hostile echo content and labels self-reports unverified', () => {
  const dossier = buildDossier({
    sid: '0123456789ab',
    events: [
      { ts: 0, headers: [], path: '/', status: 200, tags: ['echo'], echo: { level: 1, fields: { model: '<script>alert(1)</script>' }, raw: '<script>alert(1)</script>' } },
    ],
  });
  const html = renderHtml([dossier]);
  assert.ok(html.includes('Self-reported (unverified)'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<style>'));
  assert.ok(!html.includes('<script src='));
});

test('renderHtml redacts likely secrets to their first six characters', () => {
  const dossier = buildDossier({ sid: '0123456789ab', events: [] });
  dossier.reversal = 'found sk-abcdefghijklmnop12345, AKIA1234567890ABCDEF, ghp_abcdefghijklmnop, and 1234567890abcdef1234567890abcdef';
  const html = renderHtml([dossier]);
  assert.ok(html.includes('sk-abc…'));
  assert.ok(html.includes('AKIA12…'));
  assert.ok(html.includes('ghp_ab…'));
  assert.ok(html.includes('123456…'));
  assert.ok(!html.includes('sk-abcdefghijklmnop12345'));
});
