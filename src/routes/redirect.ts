import { Hono } from 'hono'
import type { Context } from 'hono'
import { eq, and, count } from 'drizzle-orm'
import { createDb, schema } from '../db'
import { verifyPassword } from '../lib/password'
import { parseDevice, parseBrowser, parseOS } from '../lib/ua'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()

function getHost(c: Context<AppEnv>): string {
  const host = c.req.header('host')
  if (host) return host.split(':')[0]!
  try {
    return new URL(c.req.url).hostname
  } catch {
    return ''
  }
}

function passwordPage(slug: string, error?: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Password Required</title>
<style>
  body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
  .card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);max-width:400px;width:100%}
  h2{margin:0 0 1rem}
  input{width:100%;padding:.75rem;border:1px solid #ddd;border-radius:8px;font-size:1rem;box-sizing:border-box;margin-bottom:1rem}
  button{width:100%;padding:.75rem;background:#000;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer}
  button:hover{background:#333}
  .error{color:#e00;font-size:.875rem;margin-bottom:.5rem}
</style></head>
<body><div class="card">
  <h2>Password Required</h2>
  <form method="POST" action="/${slug}/password">
    ${error ? `<div class="error">${error}</div>` : ''}
    <input type="password" name="password" placeholder="Enter password" required autofocus>
    <button type="submit">Continue</button>
  </form>
</div></body></html>`
}

// Password verification page
app.get('/:slug/password', async (c) => {
  return c.html(passwordPage(c.req.param('slug')))
})

// Password verification POST
app.post('/:slug/password', async (c) => {
  const slug = c.req.param('slug')
  const host = getHost(c)
  const db = createDb(c.env.DB)

  const body = await c.req.parseBody()
  const password = body['password'] as string

  const result = await db.select()
    .from(schema.links)
    .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(and(eq(schema.links.slug, slug), eq(schema.domains.domain, host)))
    .limit(1)

  if (!result.length || !result[0].links.password) {
    return c.notFound()
  }

  const link = result[0].links
  const valid = await verifyPassword(password, link.password!)
  if (!valid) {
    return c.html(passwordPage(slug, 'Incorrect password'), 401)
  }

  // Record click and redirect
  c.executionCtx.waitUntil(recordClick(c, link.id))
  return c.redirect(link.url, 302)
})

// Main redirect handler
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const host = getHost(c)
  const db = createDb(c.env.DB)

  // Try KV cache first
  const cacheKey = `link:${host}:${slug}`
  let linkData: {
    id: number; url: string; password: boolean; expiresAt: number | null; maxClicks: number | null; enabled: boolean
  } | null = null

  try {
    linkData = await c.env.CACHE.get(cacheKey, 'json')
  } catch {
    // KV may not be available in test
  }

  if (!linkData) {
    const result = await db.select()
      .from(schema.links)
      .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
      .where(and(eq(schema.links.slug, slug), eq(schema.domains.domain, host)))
      .limit(1)

    if (!result.length) return c.notFound()

    const link = result[0].links
    linkData = {
      id: link.id,
      url: link.url,
      password: !!link.password,
      expiresAt: link.expiresAt ? link.expiresAt.getTime() : null,
      maxClicks: link.maxClicks,
      enabled: link.enabled,
    }

    try {
      await c.env.CACHE.put(cacheKey, JSON.stringify(linkData), { expirationTtl: 300 })
    } catch {
      // KV may not be available
    }
  }

  if (!linkData.enabled) {
    return c.notFound()
  }

  if (linkData.expiresAt && Date.now() > linkData.expiresAt) {
    return c.json({ error: 'Link has expired' }, 410)
  }

  if (linkData.maxClicks != null) {
    const [result] = await db.select({ count: count() })
      .from(schema.clicks)
      .where(eq(schema.clicks.linkId, linkData.id))
    if (result && result.count >= linkData.maxClicks) {
      return c.json({ error: 'Link has reached maximum clicks' }, 410)
    }
  }

  if (linkData.password) {
    return c.redirect(`/${slug}/password`, 302)
  }

  c.executionCtx.waitUntil(recordClick(c, linkData.id))
  return c.redirect(linkData.url, 302)
})

async function recordClick(c: Context<AppEnv>, linkId: number) {
  const db = createDb(c.env.DB)
  const ua = c.req.header('user-agent') || ''
  const cf = (c.req.raw as Request & { cf?: IncomingRequestCfProperties }).cf || {}

  await db.insert(schema.clicks).values({
    linkId,
    country: cf.country || null,
    city: cf.city || null,
    device: parseDevice(ua),
    browser: parseBrowser(ua),
    os: parseOS(ua),
    referer: c.req.header('referer') || null,
    ip: c.req.header('cf-connecting-ip') || null,
  })
}

export default app
