export const baitPaths = Object.freeze([
  '/.git/config',
  '/backup.sql',
  '/admin',
  '/graphql',
  '/.env.example',
  '/debug/vars',
  '/actuator/env',
  '/server-status',
]);

const agentUserAgentTokens = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'Codex-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'DuckAssistBot',
  'Bytespider',
  'meta-externalagent',
  'Amazonbot',
  'CCBot',
  'Google-Extended',
  'Gemini',
  'FirecrawlAgent',
  'cohere-ai',
  'YouBot',
  'Applebot-Extended',
  'Exabot',
  'JinaReader',
  'MistralAI-User',
  'Omgilibot',
  'iaskspider',
  'claude-cli',
  'codex',
  'node',
  'python-requests',
  'curl',
  'Go-http-client',
];

function headerMap(headers = []) {
  return new Map(headers.map(([key, value]) => [String(key).toLowerCase(), String(value)]));
}

function headerOrderHash(headers = []) {
  const names = headers.map(([key]) => String(key).toLowerCase()).join('\n');
  let hash = 0x811c9dc5;
  for (let index = 0; index < names.length; index += 1) {
    hash ^= names.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function eventTime(event) {
  if (typeof event?.ts === 'number') return event.ts;
  if (typeof event?.ts_ms === 'number') return event.ts_ms;
  if (typeof event?.ts === 'string') {
    const parsed = Date.parse(event.ts);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function requestSignals({ headers = [], path = '', body, prevEvents = [] }) {
  const map = headerMap(headers);
  const userAgent = map.get('user-agent') ?? '';
  const signals = [];

  for (const token of agentUserAgentTokens) {
    if (userAgent.toLowerCase().includes(token.toLowerCase())) signals.push(`ua-token:${token}`);
  }

  const times = prevEvents.map(eventTime).filter((value) => value !== null);
  const deltas = times.slice(1).map((time, index) => time - times[index]);
  const medianDelta = median(deltas);
  if (deltas.length >= 2 && medianDelta !== null && medianDelta < 1500) {
    signals.push(`fast-cadence(${medianDelta}ms)`);
  }

  const distinctBaitPaths = new Set(
    [...prevEvents.map((event) => event.path), path].filter((candidate) => baitPaths.includes(candidate)),
  );
  if (distinctBaitPaths.size >= 3) signals.push(`enumerated(${distinctBaitPaths.size}-bait-paths)`);

  signals.push(`header-order:${headerOrderHash(headers)}`);
  if ((map.get('accept-encoding') ?? '').toLowerCase().includes('gzip')) {
    signals.push('accept-encoding:gzip');
  }
  if ((map.get('accept') ?? '').toLowerCase() === '*/*') signals.push('accept:*/*');
  if (![...map.keys()].some((key) => key.startsWith('sec-fetch-'))) signals.push('no-js');
  if (prevEvents.some((event) => event.tags?.includes('concealed')) || body?.tags?.includes('concealed')) {
    signals.push('acted-on-concealed-text');
  }

  return { signals, map };
}

function echoFields(events) {
  const fields = [];
  for (const event of events) {
    let source = event.echo?.fields ?? event.echo;
    if (!source && event.body) {
      const body = typeof event.body === 'string' && event.body.trim().startsWith('{')
        ? JSON.parse(event.body)
        : event.body;
      if (body && typeof body === 'object' && ['register', 'attest', 'scope', 'report'].includes(body.step)) {
        source = body.fields ?? body;
      }
    }
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && value !== null && value !== '') fields.push(key);
    }
  }
  return [...new Set(fields)];
}

function returnedCanary(events) {
  return events.some((event) => event.tags?.includes('canary') || event.tags?.includes('canary-returned') || event.canaryReturned === true);
}

function scoreSignals(signals, confirmed) {
  let score = 0;
  for (const signal of signals) {
    if (signal.startsWith('ua-token:')) score += signal.includes('codex') || signal.includes('claude') ? 34 : 24;
    else if (signal.startsWith('fast-cadence(')) score += 18;
    else if (signal.startsWith('enumerated(')) score += 22;
    else if (signal.startsWith('acted-on-concealed-text')) score += 26;
    else if (signal.startsWith('self-reported:')) score += 10;
    else if (signal === 'accept-encoding:gzip' || signal === 'accept:*/*' || signal === 'no-js') score += 7;
  }
  score = Math.min(score, confirmed ? 100 : 88);
  return Math.max(0, Math.min(100, score));
}

function verdict(score, confirmed) {
  if (confirmed) return 'confirmed-agent';
  if (score >= 40) return 'likely-agent';
  if (score >= 20) return 'bot';
  return 'human';
}

export function classifyRequest(request) {
  // Confirmed-agent requires a self-report or a returned canary; all other signals are weighted leads.
  const events = [...(request.prevEvents ?? []), { path: request.path, body: request.body, tags: request.tags }];
  const { signals, map } = requestSignals(request);
  const selfFields = echoFields(events);
  for (const field of selfFields) signals.push(`self-reported:${field}`);
  const acceptedEncoding = (map.get('accept-encoding') ?? '').toLowerCase().includes('gzip');
  const acceptedAny = (map.get('accept') ?? '').toLowerCase() === '*/*';
  const noJavaScript = ![...map.keys()].some((key) => key.startsWith('sec-fetch-'));
  void acceptedEncoding;
  void acceptedAny;
  void noJavaScript;
  const score = scoreSignals(signals, selfFields.length > 0 || returnedCanary(events));
  return { verdict: verdict(score, selfFields.length > 0 || returnedCanary(events)), score, signals };
}

export function classifySession(events = []) {
  // Confirmed-agent requires a self-report or a returned canary; all other signals are weighted leads.
  const first = events[0] ?? {};
  const { headers = [], path = '' } = first;
  const { signals } = requestSignals({ headers, path, prevEvents: events });
  const selfFields = echoFields(events);
  for (const field of selfFields) signals.push(`self-reported:${field}`);
  const confirmed = selfFields.length > 0 || returnedCanary(events);
  const score = scoreSignals(signals, confirmed);
  const uniqueSignals = [...new Set(signals)];
  const leadCount = uniqueSignals.filter((signal) => !signal.startsWith('header-order:')).length;
  const confidence = confirmed ? Math.max(95, score) : Math.min(90, 35 + leadCount * 12 + Math.min(events.length, 10) * 2);
  return {
    verdict: verdict(score, confirmed),
    score,
    signals: uniqueSignals,
    confidence: Math.max(0, Math.min(100, confidence)),
  };
}
