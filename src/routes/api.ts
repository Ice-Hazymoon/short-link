import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq, and, desc, sql, count } from 'drizzle-orm'
import { createDb, schema } from '../db'
import { generateSlug } from '../lib/slug'
import { hashPassword } from '../lib/password'
import { apiKeyAuth } from '../middleware/auth'
import type { AppEnv } from '../types'

const api = new Hono<AppEnv>()

// All API routes require auth
api.use('/*', apiKeyAuth)

// Validation error hook: return consistent error format
const validationHook = (result: { success: boolean; data?: any; error?: z.ZodError }, c: any) => {
  if (!result.success) {
    const issues = result.error!.issues.map(i => ({
      path: i.path.join('.'),
      message: i.message,
    }))
    return c.json({ success: false, error: { message: 'Validation failed', issues } }, 400)
  }
}

// ─── Helpers ────────────────────────────────────────────

function serializeLink(link: typeof schema.links.$inferSelect, domain: string) {
  const { password: _, ...data } = link
  return {
    ...data,
    domain,
    shortUrl: `https://${domain}/${link.slug}`,
    hasPassword: !!link.password,
  }
}

// ─── Schemas ────────────────────────────────────────────

const createDomainSchema = z.object({
  domain: z.string().min(1, 'Domain is required').regex(
    /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/,
    'Invalid domain format'
  ),
})

const createLinkSchema = z.object({
  url: z.url('Invalid URL format'),
  domainId: z.number().int().positive('domainId must be a positive integer'),
  slug: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Slug can only contain letters, numbers, hyphens, and underscores').min(1).max(128).optional(),
  password: z.string().min(1).optional(),
  expiresAt: z.iso.datetime('Invalid datetime format, use ISO 8601').optional(),
  maxClicks: z.number().int().min(0).optional(),
})

const updateLinkSchema = z.object({
  url: z.url('Invalid URL format').optional(),
  slug: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Slug can only contain letters, numbers, hyphens, and underscores').min(1).max(128).optional(),
  password: z.string().min(1).nullable().optional(),
  expiresAt: z.iso.datetime('Invalid datetime format').nullable().optional(),
  maxClicks: z.number().int().min(0).nullable().optional(),
  enabled: z.boolean().optional(),
})

const listLinksSchema = z.object({
  domainId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
})

// ─── Domains ────────────────────────────────────────────

api.get('/domains', async (c) => {
  const db = createDb(c.env.DB)
  const result = await db.select().from(schema.domains).orderBy(desc(schema.domains.createdAt))
  return c.json({ success: true, data: result })
})

api.post('/domains',
  zValidator('json', createDomainSchema, validationHook),
  async (c) => {
    const { domain } = c.req.valid('json')
    const db = createDb(c.env.DB)

    const existing = await db.select().from(schema.domains).where(eq(schema.domains.domain, domain)).limit(1)
    if (existing.length) {
      return c.json({ success: false, error: { message: 'Domain already exists' } }, 409)
    }

    const [result] = await db.insert(schema.domains).values({ domain }).returning()
    return c.json({ success: true, data: result }, 201)
  }
)

api.delete('/domains/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ success: false, error: { message: 'Invalid domain ID' } }, 400)

  const db = createDb(c.env.DB)

  const linkCount = await db.select({ count: count() }).from(schema.links).where(eq(schema.links.domainId, id))
  if (linkCount[0].count > 0) {
    return c.json({ success: false, error: { message: 'Domain has links, delete them first' } }, 400)
  }

  const deleted = await db.delete(schema.domains).where(eq(schema.domains.id, id)).returning()
  if (!deleted.length) {
    return c.json({ success: false, error: { message: 'Domain not found' } }, 404)
  }

  return c.json({ success: true })
})

// ─── Links ──────────────────────────────────────────────

api.get('/links',
  zValidator('query', listLinksSchema, validationHook),
  async (c) => {
    const { domainId, page, limit } = c.req.valid('query')
    const db = createDb(c.env.DB)
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
      query = query.where(eq(schema.links.domainId, domainId)) as typeof query
    }

    const result = await query
    const data = result.map(r => ({
      ...serializeLink(r.link, r.domain.domain),
      clickCount: r.clickCount,
    }))

    return c.json({ success: true, data, pagination: { page, limit } })
  }
)

api.post('/links',
  zValidator('json', createLinkSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json')
    const db = createDb(c.env.DB)

    // Verify domain exists
    const domain = await db.select().from(schema.domains).where(eq(schema.domains.id, body.domainId)).limit(1)
    if (!domain.length) {
      return c.json({ success: false, error: { message: 'Domain not found' } }, 404)
    }

    const slug = body.slug || generateSlug()

    // Check slug uniqueness within domain
    const existing = await db.select().from(schema.links)
      .where(and(eq(schema.links.slug, slug), eq(schema.links.domainId, body.domainId)))
      .limit(1)
    if (existing.length) {
      return c.json({ success: false, error: { message: 'Slug already taken' } }, 409)
    }

    const passwordHash = body.password ? await hashPassword(body.password) : null

    const [link] = await db.insert(schema.links).values({
      slug,
      url: body.url,
      domainId: body.domainId,
      password: passwordHash,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      maxClicks: body.maxClicks ?? null,
    }).returning()

    await c.env.CACHE.delete(`link:${domain[0].domain}:${slug}`)

    return c.json({ success: true, data: serializeLink(link, domain[0].domain) }, 201)
  }
)

api.get('/links/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ success: false, error: { message: 'Invalid link ID' } }, 400)

  const db = createDb(c.env.DB)

  const result = await db.select({
    link: schema.links,
    domain: schema.domains,
  })
    .from(schema.links)
    .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.links.id, id))
    .limit(1)

  if (!result.length) {
    return c.json({ success: false, error: { message: 'Link not found' } }, 404)
  }

  return c.json({ success: true, data: serializeLink(result[0].link, result[0].domain.domain) })
})

api.patch('/links/:id',
  zValidator('json', updateLinkSchema, validationHook),
  async (c) => {
    const id = parseInt(c.req.param('id'))
    if (isNaN(id)) return c.json({ success: false, error: { message: 'Invalid link ID' } }, 400)

    const body = c.req.valid('json')
    const db = createDb(c.env.DB)

    const existing = await db.select({
      link: schema.links,
      domain: schema.domains,
    })
      .from(schema.links)
      .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
      .where(eq(schema.links.id, id))
      .limit(1)

    if (!existing.length) {
      return c.json({ success: false, error: { message: 'Link not found' } }, 404)
    }

    const oldLink = existing[0]

    // If slug changed, check uniqueness
    if (body.slug && body.slug !== oldLink.link.slug) {
      const slugExists = await db.select().from(schema.links)
        .where(and(eq(schema.links.slug, body.slug), eq(schema.links.domainId, oldLink.link.domainId)))
        .limit(1)
      if (slugExists.length) {
        return c.json({ success: false, error: { message: 'Slug already taken' } }, 409)
      }
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

    await c.env.CACHE.delete(`link:${oldLink.domain.domain}:${oldLink.link.slug}`)
    if (body.slug) await c.env.CACHE.delete(`link:${oldLink.domain.domain}:${body.slug}`)

    return c.json({ success: true, data: serializeLink(updated, oldLink.domain.domain) })
  }
)

api.delete('/links/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ success: false, error: { message: 'Invalid link ID' } }, 400)

  const db = createDb(c.env.DB)

  const existing = await db.select({
    link: schema.links,
    domain: schema.domains,
  })
    .from(schema.links)
    .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.links.id, id))
    .limit(1)

  if (!existing.length) {
    return c.json({ success: false, error: { message: 'Link not found' } }, 404)
  }

  await db.delete(schema.links).where(eq(schema.links.id, id))
  await c.env.CACHE.delete(`link:${existing[0].domain.domain}:${existing[0].link.slug}`)

  return c.json({ success: true })
})

// ─── Analytics ──────────────────────────────────────────

api.get('/links/:id/stats',
  zValidator('query', statsQuerySchema, validationHook),
  async (c) => {
    const id = parseInt(c.req.param('id'))
    if (isNaN(id)) return c.json({ success: false, error: { message: 'Invalid link ID' } }, 400)

    const { days } = c.req.valid('query')
    const db = createDb(c.env.DB)

    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceUnix = Math.floor(since.getTime() / 1000)

    const link = await db.select().from(schema.links).where(eq(schema.links.id, id)).limit(1)
    if (!link.length) {
      return c.json({ success: false, error: { message: 'Link not found' } }, 404)
    }

    const clicksWhere = and(
      eq(schema.clicks.linkId, id),
      sql`${schema.clicks.createdAt} >= ${sinceUnix}`
    )

    const [totalClicks, byCountry, byDevice, byBrowser, byOS, byReferer, clicksOverTime] = await Promise.all([
      db.select({ count: count() }).from(schema.clicks).where(clicksWhere),

      db.select({ country: schema.clicks.country, count: count() })
        .from(schema.clicks).where(clicksWhere)
        .groupBy(schema.clicks.country).orderBy(desc(count())).limit(20),

      db.select({ device: schema.clicks.device, count: count() })
        .from(schema.clicks).where(clicksWhere)
        .groupBy(schema.clicks.device),

      db.select({ browser: schema.clicks.browser, count: count() })
        .from(schema.clicks).where(clicksWhere)
        .groupBy(schema.clicks.browser).orderBy(desc(count())),

      db.select({ os: schema.clicks.os, count: count() })
        .from(schema.clicks).where(clicksWhere)
        .groupBy(schema.clicks.os).orderBy(desc(count())),

      db.select({ referer: schema.clicks.referer, count: count() })
        .from(schema.clicks).where(and(clicksWhere, sql`${schema.clicks.referer} IS NOT NULL`))
        .groupBy(schema.clicks.referer).orderBy(desc(count())).limit(20),

      db.select({
        date: sql<string>`date(${schema.clicks.createdAt}, 'unixepoch')`.as('date'),
        count: count(),
      })
        .from(schema.clicks).where(clicksWhere)
        .groupBy(sql`date(${schema.clicks.createdAt}, 'unixepoch')`)
        .orderBy(sql`date(${schema.clicks.createdAt}, 'unixepoch')`),
    ])

    return c.json({
      success: true,
      data: {
        totalClicks: totalClicks[0].count,
        days,
        byCountry,
        byDevice,
        byBrowser,
        byOS,
        byReferer,
        clicksOverTime,
      },
    })
  }
)

// ─── Global Stats ───────────────────────────────────────

api.get('/stats', async (c) => {
  const db = createDb(c.env.DB)

  const [totalLinks, totalClicks, totalDomains, topLinks] = await Promise.all([
    db.select({ count: count() }).from(schema.links),
    db.select({ count: count() }).from(schema.clicks),
    db.select({ count: count() }).from(schema.domains),
    db.select({
      link: schema.links,
      domain: schema.domains,
      clickCount: count(schema.clicks.id),
    })
      .from(schema.links)
      .innerJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
      .leftJoin(schema.clicks, eq(schema.clicks.linkId, schema.links.id))
      .groupBy(schema.links.id)
      .orderBy(desc(count(schema.clicks.id)))
      .limit(10),
  ])

  return c.json({
    success: true,
    data: {
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
    },
  })
})

export default api
