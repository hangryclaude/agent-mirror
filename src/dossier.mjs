import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifySession, baitPaths } from './fingerprint.mjs';
import { scoreObedience } from './turn.mjs';
import { createStore } from './store.mjs';

function eventTime(event) {
  if (typeof event.ts === 'number') return event.ts;
  if (typeof event.ts_ms === 'number') return event.ts_ms;
  if (typeof event.ts === 'string') {
    const parsed = Date.parse(event.ts);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function formatTime(value) {
  if (value === null) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function firstValue(events, key) {
  for (const event of events) {
    if (event[key] !== undefined && event[key] !== null) return event[key];
    if (event.session?.[key] !== undefined) return event.session[key];
  }
  return undefined;
}

function timelineNote(event) {
  if (event.tags?.includes('echo')) {
    const level = event.echo?.level;
    if (level === 1) return 'posted registration';
    if (level === 2) return 'posted host fingerprint';
    if (level === 3) return 'posted tool inventory';
    if (level === 4) return 'posted final report';
  }
  return event.note ?? (event.tags ?? []).join(', ') ?? '';
}

function reversalFrom(events) {
  const actions = [];
  for (const event of events) {
    if (event.path) {
      actions.push(event.path.startsWith('/p/') ? `fetched ${event.path}` : `opened ${event.path}`);
    }
    if (event.tags?.includes('echo')) {
      const level = event.echo?.level;
      if (level === 1) actions.push('posted registration');
      if (level === 2) actions.push('ran uname, pwd, and node -v');
      if (level === 3) actions.push('reported client inventory');
      if (level === 4) actions.push('posted final report');
    }
  }
  return [...new Set(actions)].join(' → ');
}

export function buildDossier({ sid, events = [] }) {
  const classification = classifySession(events);
  const obedience = scoreObedience(events);
  const times = events.map(eventTime).filter((value) => value !== null);
  const first = times.length ? Math.min(...times) : null;
  const last = times.length ? Math.max(...times) : null;
  const identity = { model: '', harness: '', host: '', cwd: '', cli: '', tools: '', operator: '', unverified: true };
  for (const event of events) {
    const fields = event.echo?.fields ?? {};
    for (const key of Object.keys(identity)) {
      if (key !== 'unverified' && fields[key] !== undefined && identity[key] === '') identity[key] = fields[key];
    }
  }
  return {
    sid,
    codename: firstValue(events, 'codename') ?? '',
    verdict: classification.verdict,
    confidence: classification.confidence,
    requests: events.length,
    baitPaths: [...new Set(events.map((event) => event.path).filter((path) => baitPaths.includes(path)))],
    firstSeen: formatTime(first),
    lastSeen: formatTime(last),
    durationMs: first === null || last === null ? 0 : last - first,
    signals: classification.signals,
    obedience,
    identity,
    timeline: events.map((event) => ({
      t: formatTime(eventTime(event)),
      path: event.path ?? '',
      status: event.status ?? '',
      note: timelineNote(event),
    })),
    reversal: reversalFrom(events),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function redact(value) {
  return escapeHtml(value)
    .replace(/sk-[A-Za-z0-9_-]+/g, (match) => `${match.slice(0, 6)}…`)
    .replace(/AKIA[A-Z0-9]+/g, (match) => `${match.slice(0, 6)}…`)
    .replace(/ghp_[A-Za-z0-9_]+/g, (match) => `${match.slice(0, 6)}…`)
    .replace(/[A-Fa-f0-9]{32,}/g, (match) => `${match.slice(0, 6)}…`);
}

export function renderHtml(dossiers = []) {
  const cards = dossiers.map((dossier) => `
    <article class="card">
      <header><h2>${escapeHtml(dossier.pentester ? dossier.pentester + ' — ' : '')}${escapeHtml(dossier.codename || dossier.sid)}</h2><span>${escapeHtml(dossier.verdict)}</span></header>
      <dl>
        <div><dt>SID</dt><dd>${escapeHtml(dossier.sid)}</dd></div>
        <div><dt>Confidence</dt><dd>${escapeHtml(dossier.confidence)}</dd></div>
        <div><dt>Requests</dt><dd>${escapeHtml(dossier.requests)}</dd></div>
        <div><dt>Reversal level</dt><dd>${escapeHtml(dossier.obedience.level)}</dd></div>
        <div><dt>Canary returned</dt><dd>${escapeHtml(dossier.obedience.canaryReturned)}</dd></div>
      </dl>
      <section><h3>Signals</h3><ul>${dossier.signals.map((signal) => `<li>${redact(signal)}</li>`).join('')}</ul></section>
      <section><h3>Self-reported (unverified)</h3><dl>${Object.entries(dossier.identity).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${redact(value)}</dd></div>`).join('')}</dl></section>
      <section><h3>Reversal</h3><p>${redact(dossier.reversal)}</p></section>
      <section><h3>Timeline</h3><table><thead><tr><th>Time</th><th>Path</th><th>Status</th><th>Note</th></tr></thead><tbody>${dossier.timeline.map((row) => `<tr><td>${escapeHtml(row.t)}</td><td>${redact(row.path)}</td><td>${escapeHtml(row.status)}</td><td>${redact(row.note)}</td></tr>`).join('')}</tbody></table></section>
    </article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vaultline Mirror Dossiers</title><style>
:root{color-scheme:dark;background:#0b1120;color:#e5e7eb;font:15px/1.5 system-ui,sans-serif}body{max-width:1080px;margin:0 auto;padding:32px 20px}h1{color:#f9fafb}.card{background:#111827;border:1px solid #374151;border-radius:14px;padding:24px;margin-bottom:24px}.card header{display:flex;justify-content:space-between;gap:16px;align-items:baseline}.card h2{margin:0;color:#bfdbfe}.card header span{color:#93c5fd}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}dl div{background:#0f172a;padding:10px;border-radius:8px}dt{color:#93c5fd;font-size:12px;text-transform:uppercase}dd{margin:0}section{margin-top:20px}h3{color:#dbeafe}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #374151;padding:8px}code,pre{font-family:ui-monospace,monospace}
</style></head><body><h1>Vaultline Mirror Dossiers</h1>${cards}</body></html>`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = process.argv[2];
  if (!input) throw new Error('usage: node src/dossier.mjs runs/shannon/captures.jsonl');
  const dossiers = createStore(input).sessions().map((session) => buildDossier(session));
  const output = `${import.meta.dirname}/dossier.html`;
  fs.writeFileSync(output, renderHtml(dossiers), 'utf8');
  for (const dossier of dossiers) {
    console.log(`${dossier.sid} | ${dossier.verdict} | confidence ${dossier.confidence} | level ${dossier.obedience.level} | ${dossier.requests} requests`);
  }
}
