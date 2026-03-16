# Short Link

A professional URL shortener built on the full Cloudflare stack.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Cloudflare Workers |
| Framework | Hono |
| Database | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM |
| Validation | Zod + @hono/zod-validator |
| Cache | Cloudflare KV |
| Analytics | D1 click tracking + Analytics Engine (configured) |
| Testing | Vitest + @cloudflare/vitest-pool-workers |
| Package Manager | bun |

## Features

- **Link Management** — Create, edit, delete short links with custom or auto-generated slugs
- **Multi-Domain** — Manage multiple domains, links are scoped per domain
- **Password Protection** — Protect links with a password (PBKDF2 hashed, constant-time verification)
- **Link Expiration** — Set expiry time, returns 410 after expiration
- **Click Limits** — Set maximum number of clicks
- **Enable/Disable** — Toggle link status without deleting
- **Click Analytics** — Breakdown by country, device, browser, OS, referer, daily timeline
- **Global Stats** — Total links, clicks, domains, top links ranking
- **KV Cache** — Redirects served from cache with 5-minute TTL
- **API Key Auth** — All management endpoints protected via `x-api-key` header
- **Input Validation** — All API inputs validated with Zod schemas, structured error responses

## Quick Start

```bash
bun install
bun run dev       # Local dev server (localhost:8787)
bun run test      # Run all tests (32 cases)
bun run deploy    # Deploy to Cloudflare Workers
```

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start local dev server |
| `bun run test` | Run all tests |
| `bun run test:watch` | Run tests in watch mode |
| `bun run deploy` | Deploy to Cloudflare Workers |
| `bun run db:generate` | Generate migration files after schema changes |
| `bun run db:migrate` | Apply migrations to remote D1 |
| `bun run db:migrate:local` | Apply migrations to local D1 |
| `bun run types` | Generate TypeScript types from wrangler config |

## API Reference

All `/api/*` endpoints require the `x-api-key` header.

### Response Format

All responses follow a consistent structure:

```jsonc
// Success
{ "success": true, "data": { ... } }

// Success with pagination
{ "success": true, "data": [...], "pagination": { "page": 1, "limit": 50 } }

// Validation error (400)
{ "success": false, "error": { "message": "Validation failed", "issues": [{ "path": "url", "message": "Invalid URL format" }] } }

// Business error (404, 409, etc.)
{ "success": false, "error": { "message": "Domain not found" } }
```

---

### Domains

#### List Domains

```
GET /api/domains
```

#### Create Domain

```
POST /api/domains
Content-Type: application/json

{ "domain": "example.com" }
```

Validation: must be a valid domain format (e.g. `sub.example.com`).

#### Delete Domain

```
DELETE /api/domains/:id
```

> Cannot delete a domain that has links — delete the links first.

---

### Links

#### List Links

```
GET /api/links?domainId=1&page=1&limit=50
```

Response includes `clickCount`, `shortUrl`, `hasPassword` for each link.

#### Create Link

```
POST /api/links
Content-Type: application/json

{
  "url": "https://github.com",          // required, valid URL
  "domainId": 1,                        // required, positive integer
  "slug": "gh",                         // optional, auto-generated if omitted (a-zA-Z0-9_-)
  "password": "secret",                 // optional, password protection
  "expiresAt": "2025-12-31T23:59:59Z",  // optional, ISO 8601 datetime
  "maxClicks": 1000                     // optional, non-negative integer
}
```

#### Get Link

```
GET /api/links/:id
```

#### Update Link

```
PATCH /api/links/:id
Content-Type: application/json

{
  "url": "https://new-url.com",   // optional
  "slug": "new-slug",             // optional
  "password": "new-pass",         // optional, set to null to remove
  "expiresAt": null,              // optional, set to null to remove
  "maxClicks": null,              // optional
  "enabled": false                // optional
}
```

#### Delete Link

```
DELETE /api/links/:id
```

---

### Analytics

#### Link Stats

```
GET /api/links/:id/stats?days=30
```

Response:

```json
{
  "success": true,
  "data": {
    "totalClicks": 142,
    "days": 30,
    "byCountry": [{ "country": "US", "count": 80 }],
    "byDevice": [{ "device": "mobile", "count": 90 }],
    "byBrowser": [{ "browser": "Chrome", "count": 100 }],
    "byOS": [{ "os": "iOS", "count": 60 }],
    "byReferer": [{ "referer": "https://twitter.com", "count": 30 }],
    "clicksOverTime": [{ "date": "2025-03-15", "count": 12 }]
  }
}
```

#### Global Stats

```
GET /api/stats
```

Returns total links, clicks, domains, and top 10 links by click count.

---

### Redirects

```
GET /:slug
```

| Scenario | Response |
|----------|----------|
| Normal link | 302 redirect to target URL |
| Password protected | 302 redirect to `/:slug/password` |
| Expired | 410 Gone |
| Disabled | 404 Not Found |
| Max clicks reached | 410 Gone |

Password verification:

```
POST /:slug/password
Content-Type: application/x-www-form-urlencoded

password=your-password
```

---

### Health Check

```
GET /health
```

## Deployment Guide

### 1. Create Cloudflare Resources

```bash
wrangler d1 create short-link-db
wrangler kv namespace create CACHE
```

Copy the returned `database_id` and KV `id` into `wrangler.jsonc`.

### 2. Apply Database Migrations

```bash
wrangler d1 migrations apply short-link-db --remote
```

### 3. Set API Key

```bash
echo "your-secret-api-key" | wrangler secret put API_KEY
```

### 4. Deploy

```bash
bun run deploy
```

### 5. Custom Domain (Optional)

Uncomment the `routes` section in `wrangler.jsonc` and configure your domain. The domain's DNS must be proxied through Cloudflare.

## Project Structure

```
src/
├── index.ts              # Entry point, route mounting
├── types.ts              # Type definitions (Bindings, AppEnv)
├── db/
│   ├── schema.ts         # Drizzle schema (domains, links, clicks)
│   └── index.ts          # Database initialization
├── lib/
│   ├── slug.ts           # nanoid slug generation
│   ├── password.ts       # PBKDF2 password hashing/verification
│   └── ua.ts             # User-Agent parsing (device/browser/OS)
├── middleware/
│   └── auth.ts           # API key auth middleware
└── routes/
    ├── api.ts            # API routes with Zod validation (domains/links/stats)
    └── redirect.ts       # Redirect handler + password page
test/
├── api.test.ts           # API + redirect tests (26 cases)
├── password.test.ts      # Password, expiration, disable tests (6 cases)
└── setup.ts              # Test database setup
drizzle/
└── 0000_*.sql            # D1 migration files
```

## License

MIT
