import { Hono } from 'hono'
import { eq, and, desc, sql, count } from 'drizzle-orm'
import { createDb, schema } from '../db'
import { generateSlug } from '../lib/slug'
import { hashPassword } from '../lib/password'
import { apiKeyAuth } from '../middleware/auth'
import type { AppEnv } from '../types'

const api = new Hono<AppEnv>()

// All API routes require auth
api.use('/*', apiKeyAuth)

// ─── Domains ────────────────────────────────────────────

api.get('/domains', async (c) => {
  const db = createDb(c.env.DB)
  const result = await db.select().from(schema.domains).orderBy(desc(schema.domains.createdAt))
  return c.json({ domains: result })
})

api.post('/domains', async (c) => {
  const { domain } = await c.req.json<{ domain: string }>()
  if (!domain) return c.json({ error: 'domain is required' }, 400)

  const db = createDb(c.env.DB)

  // Check if domain already exists
  const existing = await db.select().from(schema.domains).where(eq(schema.domains.domain, domain)).limit(1)
  if (existing.length) return c.json({ error: 'Domain already exists' }, 409)

  const [result] = await db.insert(schema.domains).values({ domain }).returning()
  return c.json({ domain: result }, 201)
})

api.delete('/domains/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const db = createDb(c.env.DB)

  // Check if domain has links
  const linkCount = await db.select({ count: count() }).from(schema.links).where(eq(schema.links.domainId, id))
  if (linkCount[0].count > 0) {
    return c.json({ error: 'Domain has links, delete them first' }, 400)
  }

  await db.delete(schema.domains).where(eq(schema.domains.id, id))
  return c.json({ success: true })
})

// ─── Links ──────────────────────────────────────────────

api.get('/links', async (c) => {
  const db = createDb(c.env.DB)
  const domainId = c.req.query('domain_id')
  const page = parseInt(c.req.query('page') || '1')
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const offset = (page - 1) * limit

  let query = db.select({
    link: schema.links,
    domain: schema.domains,
    clickCount: count(schema.clicks.id),
  })
    .from(schema.links)
    .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .leftJoin(schema.clicks, eq(schema.clicks.linkId, schema.links.id))
    .groupBy(schema.links.id)
    .orderBy(desc(schema.links.createdAt))
    .limit(limit)
    .offset(offset)

  if (domainId) {
    query = query.where(eq(schema.links.domainId, parseInt(domainId))) as typeof query
  }

  const result = await query

  const links = result.map(r => {
    const { password: _, ...link } = r.link
    return {
      ...link,
      domain: r.domain.domain,
      shortUrl: `https://${r.domain.domain}/${r.link.slug}`,
      clickCount: r.clickCount,
      hasPassword: !!r.link.password,
    }
  })

  return c.json({ links, page, limit })
})

api.post('/links', async (c) => {
  const body = await c.req.json<{
    url: string
    slug?: string
    domainId: number
    password?: string
    expiresAt?: string
    maxClicks?: number
  }>()

  if (!body.url) return c.json({ error: 'url is required' }, 400)
  if (!body.domainId) return c.json({ error: 'domainId is required' }, 400)

  // Validate URL
  try {
    new URL(body.url)
  } catch {
    return c.json({ error: 'Invalid URL' }, 400)
  }

  // Validate custom slug format
  if (body.slug && !/^[a-zA-Z0-9_-]+$/.test(body.slug)) {
    return c.json({ error: 'Slug can only contain letters, numbers, hyphens, and underscores' }, 400)
  }

  const db = createDb(c.env.DB)

  // Verify domain exists
  const domain = await db.select().from(schema.domains).where(eq(schema.domains.id, body.domainId)).limit(1)
  if (!domain.length) return c.json({ error: 'Domain not found' }, 404)

  const slug = body.slug || generateSlug()

  // Check slug uniqueness within domain
  const existing = await db.select().from(schema.links)
    .where(and(eq(schema.links.slug, slug), eq(schema.links.domainId, body.domainId)))
    .limit(1)
  if (existing.length) return c.json({ error: 'Slug already taken' }, 409)

  const passwordHash = body.password ? await hashPassword(body.password) : null

  const [link] = await db.insert(schema.links).values({
    slug,
    url: body.url,
    domainId: body.domainId,
    password: passwordHash,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    maxClicks: body.maxClicks ?? null,
  }).returning()

  // Invalidate any cached version
  await c.env.CACHE.delete(`link:${domain[0].domain}:${slug}`)

  const { password: _, ...linkData } = link
  return c.json({
    link: {
      ...linkData,
      shortUrl: `https://${domain[0].domain}/${slug}`,
      hasPassword: !!passwordHash,
    }
  }, 201)
})

api.get('/links/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const db = createDb(c.env.DB)

  const result = await db.select({
    link: schema.links,
    domain: schema.domains,
  })
    .from(schema.links)
    .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.links.id, id))
    .limit(1)

  if (!result.length) return c.notFound()

  const r = result[0]
  const { password: _, ...linkData } = r.link
  return c.json({
    link: {
      ...linkData,
      domain: r.domain.domain,
      shortUrl: `https://${r.domain.domain}/${r.link.slug}`,
      hasPassword: !!r.link.password,
    }
  })
})

api.patch('/links/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json<{
    url?: string
    slug?: string
    password?: string | null
    expiresAt?: string | null
    maxClicks?: number | null
    enabled?: boolean
  }>()

  const db = createDb(c.env.DB)

  // Get existing link
  const existing = await db.select({
    link: schema.links,
    domain: schema.domains,
  })
    .from(schema.links)
    .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.links.id, id))
    .limit(1)

  if (!existing.length) return c.notFound()

  const oldLink = existing[0]

  // If slug changed, check uniqueness
  if (body.slug && body.slug !== oldLink.link.slug) {
    const slugExists = await db.select().from(schema.links)
      .where(and(eq(schema.links.slug, body.slug), eq(schema.links.domainId, oldLink.link.domainId)))
      .limit(1)
    if (slugExists.length) return c.json({ error: 'Slug already taken' }, 409)
  }

  const updates: Record<string, any> = { updatedAt: new Date() }
  if (body.url !== undefined) updates.url = body.url
  if (body.slug !== undefined) updates.slug = body.slug
  if (body.enabled !== undefined) updates.enabled = body.enabled
  if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
  if (body.maxClicks !== undefined) updates.maxClicks = body.maxClicks
  if (body.password !== undefined) {
    updates.password = body.password ? await hashPassword(body.password) : null
  }

  const [updated] = await db.update(schema.links).set(updates).where(eq(schema.links.id, id)).returning()

  // Invalidate cache for both old and new slug
  await c.env.CACHE.delete(`link:${oldLink.domain.domain}:${oldLink.link.slug}`)
  if (body.slug) await c.env.CACHE.delete(`link:${oldLink.domain.domain}:${body.slug}`)

  const { password: _, ...updatedData } = updated
  return c.json({
    link: {
      ...updatedData,
      domain: oldLink.domain.domain,
      shortUrl: `https://${oldLink.domain.domain}/${updated.slug}`,
      hasPassword: !!updated.password,
    }
  })
})

api.delete('/links/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const db = createDb(c.env.DB)

  // Get link info for cache invalidation
  const existing = await db.select({
    link: schema.links,
    domain: schema.domains,
  })
    .from(schema.links)
    .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.links.id, id))
    .limit(1)

  if (!existing.length) return c.notFound()

  await db.delete(schema.links).where(eq(schema.links.id, id))
  await c.env.CACHE.delete(`link:${existing[0].domain.domain}:${existing[0].link.slug}`)

  return c.json({ success: true })
})

// ─── Analytics ──────────────────────────────────────────

api.get('/links/:id/stats', async (c) => {
  const id = parseInt(c.req.param('id'))
  const db = createDb(c.env.DB)
  const days = parseInt(c.req.query('days') || '30')

  const since = new Date()
  since.setDate(since.getDate() - days)

  // Verify link exists
  const link = await db.select().from(schema.links).where(eq(schema.links.id, id)).limit(1)
  if (!link.length) return c.notFound()

  // Total clicks
  const totalClicks = await db.select({ count: count() })
    .from(schema.clicks)
    .where(and(
      eq(schema.clicks.linkId, id),
      sql`${schema.clicks.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))

  // Clicks by country
  const byCountry = await db.select({
    country: schema.clicks.country,
    count: count(),
  })
    .from(schema.clicks)
    .where(and(
      eq(schema.clicks.linkId, id),
      sql`${schema.clicks.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))
    .groupBy(schema.clicks.country)
    .orderBy(desc(count()))
    .limit(20)

  // Clicks by device
  const byDevice = await db.select({
    device: schema.clicks.device,
    count: count(),
  })
    .from(schema.clicks)
    .where(and(
      eq(schema.clicks.linkId, id),
      sql`${schema.clicks.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))
    .groupBy(schema.clicks.device)

  // Clicks by browser
  const byBrowser = await db.select({
    browser: schema.clicks.browser,
    count: count(),
  })
    .from(schema.clicks)
    .where(and(
      eq(schema.clicks.linkId, id),
      sql`${schema.clicks.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))
    .groupBy(schema.clicks.browser)
    .orderBy(desc(count()))

  // Clicks by OS
  const byOS = await db.select({
    os: schema.clicks.os,
    count: count(),
  })
    .from(schema.clicks)
    .where(and(
      eq(schema.clicks.linkId, id),
      sql`${schema.clicks.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))
    .groupBy(schema.clicks.os)
    .orderBy(desc(count()))

  // Clicks by referer
  const byReferer = await db.select({
    referer: schema.clicks.referer,
    count: count(),
  })
    .from(schema.clicks)
    .where(and(
      eq(schema.clicks.linkId, id),
      sql`${schema.clicks.createdAt} >= ${Math.floor(since.getTime() / 1000)}`,
      sql`${schema.clicks.referer} IS NOT NULL`
    ))
    .groupBy(schema.clicks.referer)
    .orderBy(desc(count()))
    .limit(20)

  // Clicks over time (daily)
  const clicksOverTime = await db.select({
    date: sql<string>`date(${schema.clicks.createdAt}, 'unixepoch')`.as('date'),
    count: count(),
  })
    .from(schema.clicks)
    .where(and(
      eq(schema.clicks.linkId, id),
      sql`${schema.clicks.createdAt} >= ${Math.floor(since.getTime() / 1000)}`
    ))
    .groupBy(sql`date(${schema.clicks.createdAt}, 'unixepoch')`)
    .orderBy(sql`date(${schema.clicks.createdAt}, 'unixepoch')`)

  return c.json({
    totalClicks: totalClicks[0].count,
    days,
    byCountry,
    byDevice,
    byBrowser,
    byOS,
    byReferer,
    clicksOverTime,
  })
})

// ─── Global Stats ───────────────────────────────────────

api.get('/stats', async (c) => {
  const db = createDb(c.env.DB)

  const totalLinks = await db.select({ count: count() }).from(schema.links)
  const totalClicks = await db.select({ count: count() }).from(schema.clicks)
  const totalDomains = await db.select({ count: count() }).from(schema.domains)

  // Top links
  const topLinks = await db.select({
    link: schema.links,
    domain: schema.domains,
    clickCount: count(schema.clicks.id),
  })
    .from(schema.links)
    .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .leftJoin(schema.clicks, eq(schema.clicks.linkId, schema.links.id))
    .groupBy(schema.links.id)
    .orderBy(desc(count(schema.clicks.id)))
    .limit(10)

  return c.json({
    totalLinks: totalLinks[0].count,
    totalClicks: totalClicks[0].count,
    totalDomains: totalDomains[0].count,
    topLinks: topLinks.map(r => ({
      id: r.link.id,
      slug: r.link.slug,
      url: r.link.url,
      shortUrl: `https://${r.domain.domain}/${r.link.slug}`,
      clickCount: r.clickCount,
    })),
  })
})

export default api
