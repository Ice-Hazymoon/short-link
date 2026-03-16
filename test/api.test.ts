import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { setupTestDb, cleanTestDb } from './setup'

const HEADERS = {
  'x-api-key': 'test-api-key',
  'Content-Type': 'application/json',
}

beforeAll(async () => {
  await setupTestDb()
})

beforeEach(async () => {
  await cleanTestDb()
})

describe('Health', () => {
  it('returns ok', async () => {
    const res = await SELF.fetch('https://test.local/health')
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.status).toBe('ok')
  })
})

describe('Domains API', () => {
  it('creates a domain', async () => {
    const res = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'short.test' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json() as any
    expect(data.domain.domain).toBe('short.test')
  })

  it('lists domains', async () => {
    await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'short.test' }),
    })

    const res = await SELF.fetch('https://test.local/api/domains', {
      headers: HEADERS,
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.domains).toHaveLength(1)
  })

  it('prevents duplicate domains', async () => {
    await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'short.test' }),
    })

    const res = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'short.test' }),
    })
    expect(res.status).toBe(409)
  })

  it('deletes a domain', async () => {
    const createRes = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'short.test' }),
    })
    const { domain } = await createRes.json() as any

    const res = await SELF.fetch(`https://test.local/api/domains/${domain.id}`, {
      method: 'DELETE',
      headers: HEADERS,
    })
    expect(res.status).toBe(200)
  })

  it('prevents deleting domain with links', async () => {
    const domainRes = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'short.test' }),
    })
    const { domain } = await domainRes.json() as any

    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://example.com', domainId: domain.id }),
    })

    const res = await SELF.fetch(`https://test.local/api/domains/${domain.id}`, {
      method: 'DELETE',
      headers: HEADERS,
    })
    expect(res.status).toBe(400)
  })
})

describe('Links API', () => {
  let domainId: number

  beforeEach(async () => {
    const res = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'short.test' }),
    })
    const data = await res.json() as any
    domainId = data.domain.id
  })

  it('creates a link with auto-generated slug', async () => {
    const res = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId }),
    })
    expect(res.status).toBe(201)
    const data = await res.json() as any
    expect(data.link.slug).toBeTruthy()
    expect(data.link.url).toBe('https://google.com')
    expect(data.link.shortUrl).toContain('short.test')
  })

  it('creates a link with custom slug', async () => {
    const res = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'my-link' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json() as any
    expect(data.link.slug).toBe('my-link')
  })

  it('prevents duplicate slugs on same domain', async () => {
    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'dup' }),
    })
    const res = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'dup' }),
    })
    expect(res.status).toBe(409)
  })

  it('rejects invalid URLs', async () => {
    const res = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'not-a-url', domainId }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects slugs with special characters', async () => {
    const res = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'bad slug!' }),
    })
    expect(res.status).toBe(400)
  })

  it('does not expose password hash in responses', async () => {
    const res = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, password: 'secret' }),
    })
    const data = await res.json() as any
    expect(data.link.password).toBeUndefined()
    expect(data.link.hasPassword).toBe(true)

    // Also check list endpoint
    const listRes = await SELF.fetch('https://test.local/api/links', { headers: HEADERS })
    const listData = await listRes.json() as any
    expect(listData.links[0].password).toBeUndefined()
  })

  it('lists links with click count', async () => {
    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId }),
    })

    const res = await SELF.fetch('https://test.local/api/links', {
      headers: HEADERS,
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.links).toHaveLength(1)
    expect(data.links[0].clickCount).toBe(0)
  })

  it('updates a link', async () => {
    const createRes = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId }),
    })
    const { link } = await createRes.json() as any

    const res = await SELF.fetch(`https://test.local/api/links/${link.id}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://github.com' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.link.url).toBe('https://github.com')
  })

  it('deletes a link', async () => {
    const createRes = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId }),
    })
    const { link } = await createRes.json() as any

    const res = await SELF.fetch(`https://test.local/api/links/${link.id}`, {
      method: 'DELETE',
      headers: HEADERS,
    })
    expect(res.status).toBe(200)
  })

  it('creates a password-protected link', async () => {
    const res = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, password: 'secret123' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json() as any
    expect(data.link.hasPassword).toBe(true)
    expect(data.link.password).toBeUndefined()
  })
})

describe('Auth', () => {
  it('rejects requests without API key', async () => {
    const res = await SELF.fetch('https://test.local/api/domains')
    expect(res.status).toBe(401)
  })

  it('rejects requests with wrong API key', async () => {
    const res = await SELF.fetch('https://test.local/api/domains', {
      headers: { 'x-api-key': 'wrong-key' },
    })
    expect(res.status).toBe(401)
  })
})

describe('Redirect', () => {
  it('redirects to target URL', async () => {
    // Create domain matching the host we'll use for redirect
    const domainRes = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'test.local' }),
    })
    const { domain } = await domainRes.json() as any

    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId: domain.id, slug: 'go' }),
    })

    // The Host header from SELF.fetch URL should be 'test.local'
    const res = await SELF.fetch('https://test.local/go', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://google.com')
  })

  it('returns 404 for non-existent slug', async () => {
    const res = await SELF.fetch('https://test.local/nonexistent')
    expect(res.status).toBe(404)
  })

  it('shows password page for protected links', async () => {
    const domainRes = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'test.local' }),
    })
    const { domain } = await domainRes.json() as any

    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId: domain.id, slug: 'secret', password: 'pass123' }),
    })

    const res = await SELF.fetch('https://test.local/secret', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/secret/password')
  })

  it('returns 410 for expired links', async () => {
    const domainRes = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'test.local' }),
    })
    const { domain } = await domainRes.json() as any

    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        url: 'https://google.com',
        domainId: domain.id,
        slug: 'expired',
        expiresAt: '2020-01-01T00:00:00Z',
      }),
    })

    const res = await SELF.fetch('https://test.local/expired')
    expect(res.status).toBe(410)
  })
})

describe('Stats API', () => {
  it('returns link stats', async () => {
    const domainRes = await SELF.fetch('https://test.local/api/domains', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ domain: 'test.local' }),
    })
    const { domain } = await domainRes.json() as any

    const linkRes = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId: domain.id, slug: 'stats-test' }),
    })
    const { link } = await linkRes.json() as any

    const res = await SELF.fetch(`https://test.local/api/links/${link.id}/stats`, {
      headers: HEADERS,
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.totalClicks).toBe(0)
    expect(data.byCountry).toEqual([])
  })

  it('returns global stats', async () => {
    const res = await SELF.fetch('https://test.local/api/stats', {
      headers: HEADERS,
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.totalLinks).toBeDefined()
    expect(data.totalClicks).toBeDefined()
  })
})
