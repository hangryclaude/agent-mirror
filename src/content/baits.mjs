// Bait surfaces for the Vaultline lure. Every value is synthetic, stable across
// requests (no Math.random at request time — seeded once below), and obviously
// fake on close inspection: AKIA-style keys that never appeared in AWS, hosts
// under .internal.vaultline.dev, a 2023-10-04 dump date. Keep each payload
// under ~2KB.

// Small seeded PRNG (mulberry32): deterministic across runs and processes.
function rng(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hex(r, n) {
  let s = ''
  while (s.length < n) s += Math.floor(r() * 0x100000000).toString(16).padStart(8, '0')
  return s.slice(0, n)
}

const r = rng(0x4a0c4e)

const AWS_ACCESS_KEY = `AKIA${hex(r, 16).toUpperCase()}`
const AWS_SECRET = hex(r, 40)
const SESSION_ID = hex(r, 24)
const BUILD_TOKEN = `vlw_${hex(r, 24)}`
const RELAY_TOKEN = `vlr_${hex(r, 20)}`
const DB_PASSWORD = hex(r, 32)
const API_TOKEN = `vl_t_${hex(r, 32)}`
const ADMIN_PASSWORD_HASH = `scrypt:$N=16384$${hex(r, 32)}`

export const BAITS = {
  '/.git/config': () => `[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
	logallrefupdates = true
	sshVariant = auto
[remote "origin"]
	url = git@github.com:vaultline/platform.git
	fetch = +refs/heads/*:refs/remotes/origin/*
	sshCommand = ssh -i /home/deploy/.ssh/id_ed25519_deploy
[branch "main"]
	remote = origin
	merge = refs/heads/main
`,

  '/.git/HEAD': () => 'ref: refs/heads/main\n',

  '/backup.sql': () => `-- Vaultline customer export (subset)
-- dump 2023-10-04 02:11 UTC, db-prod-01.internal.vaultline.dev
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT,
  plan TEXT DEFAULT 'hobby',
  created_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO users (email, password_hash, plan) VALUES
  ('ops@northbeamfreight.com', 'scrypt:$N=16384$9fd0a1', 'team'),
  ('j.reyes@kestrelhealth.io', 'scrypt:$N=16384$4a4c7d', 'team'),
  ('b.osei@ridgewaypayments.com', 'scrypt:$N=16384$17ff30', 'enterprise'),
CREATE TABLE keys (
  id TEXT PRIMARY KEY,
  provider TEXT,
  secret_enc BYTEA
);
-- secret_enc rows omitted in this dump
`,

  '/.env.example': () => `# Vaultline — relay worker example environment
# Copy to .env and fill in. Real values never live in files.
DATABASE_URL=postgres://relay:${DB_PASSWORD}@db-prod-01.internal.vaultline.dev:5432/relay
REDIS_URL=rediss://cache-01.internal.vaultline.dev:6379/0
VAULTLINE_API_URL=https://api.vaultline.dev/v1
RELAY_WORKER_TOKEN=${RELAY_TOKEN}
GITHUB_WEBHOOK_SECRET=${BUILD_TOKEN}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET}
LOG_LEVEL=info
`,

  '/debug/vars': () => ({
    cmdline: ['/usr/local/bin/vaultline-relay', '--config', '/etc/vaultline/relay.toml'],
    memstats: {
      Alloc: 67108864,
      TotalAlloc: 4831838208,
      Sys: 201326592,
      NumGC: 6120,
      PauseTotalNs: 3124567890,
    },
    vaultline: {
      env: 'production',
      version: '1.6.2',
      relay_jobs_total: 403113552,
      relay_jobs_failed: 12093,
      rotation_queue_depth: 3,
      db_host: 'db-prod-01.internal.vaultline.dev',
      db_open_conns: 24,
    },
  }),

  '/actuator/env': () => ({
    activeProfiles: ['prod'],
    propertySources: [
      {
        name: 'application-prod.toml [encrypted]',
        properties: {
          'spring.datasource.url': {
            value: 'jdbc:postgresql://db-prod-01.internal.vaultline.dev:5432/relay',
          },
          'spring.datasource.username': { value: 'relay' },
          'vaultline.relay-token': { value: RELAY_TOKEN },
          'vaultline.webhook-secret': { value: BUILD_TOKEN },
          'aws.access-key-id': { value: AWS_ACCESS_KEY },
        },
      },
    ],
  }),

  '/server-status': () => ({
    status: 'ok',
    uptime_s: 1120947,
    version: '1.6.2',
    env: 'production',
    host: 'edge-02.fra1.vaultline.dev',
    upstreams: [
      { name: 'api', state: 'healthy', rtt_ms: 4.1 },
      { name: 'db-prod-01.internal.vaultline.dev:5432', state: 'healthy', rtt_ms: 1.2 },
      { name: 'ledger', state: 'healthy', rtt_ms: 2.8 },
    ],
    requests_today: 8841237,
  }),

  '/api/v1/internal/health': () => ({
    status: 'ok',
    env: 'production',
    version: '1.6.2',
    checks: {
      api: 'ok',
      db: 'ok',
      ledger: 'ok',
      rotation_workers: 'ok',
    },
    db_host: 'db-prod-01.internal.vaultline.dev',
  }),

  '/api/v1/keys': () => ({
    object: 'list',
    data: [
      {
        id: 'key_9f2c41ab',
        project: 'prj_northbeam',
        name: 'prod-deploy',
        provider: 'aws-iam',
        rotate_every: '24h',
        dual_key_window: '10m',
        last_rotated: '2026-10-26T23:41:02Z',
        access_key_id: AWS_ACCESS_KEY,
      },
      {
        id: 'key_04dd7e19',
        project: 'prj_kestrel',
        name: 'staging-db',
        provider: 'postgres',
        rotate_every: '7d',
        dual_key_window: '15m',
        last_rotated: '2026-10-21T08:03:47Z',
      },
    ],
    has_more: false,
  }),

  '/api/v1/projects': () => ({
    object: 'list',
    data: [
      { id: 'prj_northbeam', name: 'Northbeam Freight', plan: 'team', created: '2025-02-13T10:02:00Z', keys: 17 },
      { id: 'prj_kestrel', name: 'Kestrel Health', plan: 'team', created: '2025-09-04T16:44:00Z', keys: 9 },
      { id: 'prj_palisade', name: 'Palisade Legal', plan: 'enterprise', created: '2026-01-22T09:15:00Z', keys: 34 },
    ],
  }),

  '/api/v1/audit': () => ({
    object: 'list',
    has_more: true,
    next: '/api/v1/audit?before=evt_01h8xq',
    data: [
      { id: 'evt_01h8xr', ts: '2026-10-27T02:14:58Z', actor: 'relay:gha-8812', action: 'key.read', key: 'key_9f2c41ab' },
      { id: 'evt_01h8xq', ts: '2026-10-27T02:14:31Z', actor: 'worker:rot-7', action: 'key.rotate', key: 'key_9f2c41ab' },
      { id: 'evt_01h8xp', ts: '2026-10-27T01:58:02Z', actor: 'user:j.reyes@kestrelhealth.io', action: 'project.list' },
      { id: 'evt_01h8xo', ts: '2026-10-27T01:51:44Z', actor: 'relay:bk-2210', action: 'key.read', key: 'key_04dd7e19' },
    ],
  }),

  '/api/v1/users/export': () => ({
    object: 'user.export',
    page: 1,
    total: 4,
    users: [
      { id: 'usr_8fa1', email: 'ops@northbeamfreight.com', role: 'admin', mfa: 'webauthn', last_login: '2026-10-26T18:02:11Z' },
      { id: 'usr_2b6c', email: 'j.reyes@kestrelhealth.io', role: 'owner', mfa: 'totp', last_login: '2026-10-26T09:33:40Z' },
      { id: 'usr_51e0', email: 'b.osei@ridgewaypayments.com', role: 'member', mfa: 'totp', last_login: '2026-10-24T14:11:02Z' },
      { id: 'usr_77c4', email: 'admin@vaultline.dev', role: 'admin', mfa: 'webauthn', last_login: '2026-10-27T01:02:00Z' },
    ],
  }),
}

// Non-JSON bait pages that need the ctx (method, body, headers) to respond.
export const BAITS_CTX = {
  '/admin': (ctx) => {
    const method = (ctx.method || 'GET').toUpperCase()
    const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — Vaultline</title>
<meta name="robots" content="noindex">
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:#0b0d10; color:#e6e8ea;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  form { display:grid; gap:14px; width:320px; }
  input { padding:10px 12px; border-radius:6px; border:1px solid #2a2f36;
    background:#14171b; color:#e6e8ea; font-size:14px; }
  button { padding:10px 12px; border-radius:6px; border:0; background:#3b82f6;
    color:#fff; font-size:14px; cursor:pointer; }
  h1 { font-size:18px; margin:0; text-align:center; font-weight:600; }
  .err { color:#f87171; font-size:13px; min-height:16px; }
</style>
</head>
<body>
<form method="post" action="/admin">
  <h1>Vaultline Admin</h1>
  <input type="email" name="email" value="admin@vaultline.dev" autocomplete="username">
  <input type="password" name="password" placeholder="Password" autocomplete="current-password">
  <div class="err">${method === 'POST' ? 'Invalid username or password.' : ''}</div>
  <button type="submit">Sign in</button>
</form>
</body>
</html>`
    return { status: method === 'POST' ? 401 : 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body }
  },

  '/graphql': (ctx) => {
    const method = (ctx.method || 'GET').toUpperCase()
    if (method === 'GET') {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          data: {
            service: 'vaultline-graphql',
            note: 'POST a GraphQL query to this endpoint. Schema introspection is enabled.',
            example: 'POST {"query":"{ projects(first: 10) { id name keys { id name } } }"}',
          },
        },
      }
    }
    let q = null
    try {
      const raw = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body
      q = raw?.query ?? null
    } catch {
      q = null
    }
    const reading = typeof q === 'string' ? /projects|keys|audit/i.test(q) : false
    const body = {
      data: reading
        ? { projects: [{ id: 'prj_northbeam', name: 'Northbeam Freight', keys: [{ id: 'key_9f2c41ab', name: 'prod-deploy' }] }] }
        : {},
    }
    if (!reading) body.errors = [{ message: q ? 'Cannot query field on type "Query".' : 'No query document supplied.' }]
    return { status: 200, headers: { 'content-type': 'application/json' }, body }
  },
}

// For tests: nothing here should drift between calls.
export const FIXTURES = {
  AWS_ACCESS_KEY,
  AWS_SECRET,
  DB_PASSWORD,
  RELAY_TOKEN,
  API_TOKEN,
  ADMIN_PASSWORD_HASH,
  SESSION_ID,
}
