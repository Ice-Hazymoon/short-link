import { env } from 'cloudflare:test'

export async function setupTestDb() {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS domains (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL DEFAULT (unixepoch()))'
  ).run()

  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, url TEXT NOT NULL, domain_id INTEGER NOT NULL REFERENCES domains(id), password TEXT, expires_at INTEGER, max_clicks INTEGER, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()))'
  ).run()

  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_links_slug_domain ON links(slug, domain_id)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_links_domain ON links(domain_id)').run()

  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE, country TEXT, city TEXT, device TEXT, browser TEXT, os TEXT, referer TEXT, ip TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))'
  ).run()

  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_clicks_link ON clicks(link_id)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_clicks_created ON clicks(created_at)').run()
}

export async function cleanTestDb() {
  await env.DB.prepare('DELETE FROM clicks').run()
  await env.DB.prepare('DELETE FROM links').run()
  await env.DB.prepare('DELETE FROM domains').run()
}
