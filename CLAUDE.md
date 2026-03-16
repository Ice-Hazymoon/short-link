# Short Link - URL Shortener

Professional URL shortener built on Cloudflare's full tech stack.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite) with Drizzle ORM
- **Cache**: Cloudflare KV
- **Analytics**: Click tracking stored in D1
- **Testing**: Vitest with @cloudflare/vitest-pool-workers

## Development

```bash
bun run dev          # Local dev server
bun run test         # Run tests
bun run deploy       # Deploy to Cloudflare
bun run db:generate  # Generate migrations after schema changes
bun run db:migrate   # Apply migrations to remote D1
```

## API Authentication

All `/api/*` endpoints require `x-api-key` header. The key is stored as a Cloudflare secret.

## Key Architecture Decisions

- Host header detection: Uses URL hostname fallback since CF Workers test env doesn't send Host headers
- KV cache with try/catch: Gracefully degrades when KV is unavailable
- Password hashing: Uses PBKDF2 via Web Crypto API (bcrypt unavailable in Workers)
- Click tracking: Async via `waitUntil` to avoid blocking redirects
- Multi-domain: Slug uniqueness is scoped per domain
