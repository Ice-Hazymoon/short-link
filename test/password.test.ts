import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { setupTestDb, cleanTestDb } from './setup'

const HEADERS = {
  'x-api-key': 'test-api-key',
  'Content-Type': 'application/json',
}

let domainId: number

beforeAll(async () => {
  await setupTestDb()
})

beforeEach(async () => {
  await cleanTestDb()
  const res = await SELF.fetch('https://test.local/api/domains', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ domain: 'test.local' }),
  })
  const body = await res.json() as any
  domainId = body.data.id
})

describe('Password Protection', () => {
  it('shows password form page', async () => {
    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'pw', password: 'test123' }),
    })

    const res = await SELF.fetch('https://test.local/pw/password')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Password Required')
    expect(html).toContain('type="password"')
  })

  it('accepts correct password and redirects', async () => {
    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'pw', password: 'test123' }),
    })

    const form = new URLSearchParams()
    form.set('password', 'test123')
    const res = await SELF.fetch('https://test.local/pw/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://google.com')
  })

  it('rejects wrong password', async () => {
    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'pw', password: 'test123' }),
    })

    const form = new URLSearchParams()
    form.set('password', 'wrongpassword')
    const res = await SELF.fetch('https://test.local/pw/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    expect(res.status).toBe(401)
    const html = await res.text()
    expect(html).toContain('Incorrect password')
  })

  it('can remove password from link', async () => {
    const createRes = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'pw', password: 'test123' }),
    })
    const { data: link } = await createRes.json() as any

    // Remove password
    const updateRes = await SELF.fetch(`https://test.local/api/links/${link.id}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ password: null }),
    })
    const updateBody = await updateRes.json() as any
    expect(updateBody.data.hasPassword).toBe(false)

    // Should now redirect directly
    const res = await SELF.fetch('https://test.local/pw', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://google.com')
  })
})

describe('Link Expiration', () => {
  it('allows access before expiration', async () => {
    const future = new Date(Date.now() + 86400000).toISOString() // 24h from now
    await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'future', expiresAt: future }),
    })

    const res = await SELF.fetch('https://test.local/future', { redirect: 'manual' })
    expect(res.status).toBe(302)
  })
})

describe('Disabled Links', () => {
  it('returns 404 for disabled links', async () => {
    const createRes = await SELF.fetch('https://test.local/api/links', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ url: 'https://google.com', domainId, slug: 'off' }),
    })
    const { data: link } = await createRes.json() as any

    // Disable the link
    await SELF.fetch(`https://test.local/api/links/${link.id}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ enabled: false }),
    })

    const res = await SELF.fetch('https://test.local/off')
    expect(res.status).toBe(404)
  })
})
