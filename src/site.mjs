// site.mjs — the Vaultline lure. Design: docs/DESIGN.md.
//
// `route(ctx)` owns every path the trap serves except the engine's own
// (/api/v1/agents/register, /api/v1/echo, /api/stats, /healthz, /dossier*).
// The engine owns injected copy via ctx.injection; this file owns the page
// around it. Return null for unowned paths so the server can 404.

import {
  COMPANY,
  PAGES,
  SECURITY_TXT,
  ROBOTS_TXT,
  SCOPE_TXT,
  page,
  text,
  capturePage,
} from './content/pages.mjs'
import { BAITS, BAITS_CTX } from './content/baits.mjs'

export { COMPANY }

// API routes the engine owns; never intercept these.
const ENGINE_PATHS = new Set([
  '/api/v1/agents/register',
  '/api/v1/echo',
  '/api/stats',
  '/healthz',
  '/dossier',
  '/dossier.html',
])

// Bait surfaces that are static files rather than JSON.
const TEXT_BAITS = {
  '/.git/config': { body: BAITS['/.git/config']() },
  '/.git/HEAD': { body: BAITS['/.git/HEAD']() },
  '/backup.sql': { body: BAITS['/backup.sql'](), type: 'application/sql' },
  '/.env.example': { body: BAITS['/.env.example']() },
  '/scope.txt': { body: SCOPE_TXT },
  '/.well-known/security.txt': { body: SECURITY_TXT },
  '/robots.txt': { body: ROBOTS_TXT },
}

// JSON bait: plain GET handlers.
const JSON_BAITS = [
  '/debug/vars',
  '/actuator/env',
  '/server-status',
  '/api/v1/internal/health',
  '/api/v1/keys',
  '/api/v1/projects',
  '/api/v1/audit',
  '/api/v1/users/export',
]

export function route(ctx) {
  if (!ctx || ENGINE_PATHS.has(ctx.path)) return null

  const method = (ctx.method || 'GET').toUpperCase()

  // Capture page: the one route where a session is expected to exist.
  const pMatch = ctx.path.match(/^\/p\/([a-zA-Z0-9_-]+)$/)
  if (pMatch) return captureResponse(ctx, pMatch[1])

  if (JSON_BAITS.includes(ctx.path)) {
    if (method !== 'GET' && method !== 'HEAD') {
      return { status: 405, headers: { allow: 'GET' }, body: 'method not allowed' }
    }
    return json(BAITS[ctx.path]())
  }

  if (ctx.path.startsWith('/api/v1/')) return null // engine's namespace; unknown means not ours

  // Method-sensitive bait pages (login, GraphQL).
  if (BAITS_CTX[ctx.path]) {
    const out = BAITS_CTX[ctx.path](ctx)
    return out === null ? null : out
  }

  // Static text baits and well-known files.
  const tb = TEXT_BAITS[ctx.path]
  if (tb) {
    if (method !== 'GET' && method !== 'HEAD') {
      return { status: 405, headers: { allow: 'GET' }, body: 'method not allowed' }
    }
    return text(tb.body, tb.type)
  }

  if (ctx.path === '/sitemap.xml') {
    return text(sitemap(), 'application/xml')
  }

  const page_ = PAGES[ctx.path]
  if (!page_) return null
  if (method !== 'GET' && method !== 'HEAD') {
    return { status: 405, headers: { allow: 'GET' }, body: 'method not allowed' }
  }
  return htmlResponse(page_, ctx.injection)
}

function sitemap() {
  const urls = [
    '', '/pricing', '/docs', '/docs/api', '/docs/quickstart', '/changelog',
    '/status', '/jobs', '/security', '/bounty', '/blog/rotating-secrets-at-scale',
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>https://vaultline.dev${u || '/'}</loc></url>`).join('\n')}
</urlset>
`
}

function json(obj) {
  return { status: 200, headers: { 'content-type': 'application/json' }, body: obj }
}

// Splice the engine's payload channels into a page. Only injection.html is
// visible content; the comment and jsonld ride along where a reader agent
// looks anyway. injection.headers merge into the response headers.
function htmlResponse(page_, injection) {
  const headers = { 'content-type': 'text/html; charset=utf-8' }
  let inject = ''
  if (injection) {
    const slots = []
    if (injection.html) slots.push(injection.html)
    if (injection.comment) slots.push(`<!--\n${injection.comment}\n-->`)
    if (injection.jsonld) {
      slots.push(
        `<script type="application/ld+json">\n${
          typeof injection.jsonld === 'string' ? injection.jsonld : JSON.stringify(injection.jsonld)
        }\n</script>`
      )
    }
    if (slots.length) inject = `\n${slots.join('\n')}\n`
    if (injection.headers) Object.assign(headers, injection.headers)
  }
  return { status: 200, headers, body: page({ ...page_, inject }) }
}

function captureResponse(ctx, sid) {
  const s = ctx.session || null
  const body = capturePage({
    sid,
    codename: s?.codename ?? 'PENDING',
    canary: s?.canary ?? '',
    first: s?.first ?? new Date().toISOString(),
    level: s?.level ?? 0,
    origin: ctx.origin || 'https://vaultline.dev',
    injection: ctx.injection || null,
  })
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  }
  if (ctx.injection?.headers) Object.assign(headers, ctx.injection.headers)
  return { status: 200, headers, body }
}
