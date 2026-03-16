import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const domains = sqliteTable('domains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const links = sqliteTable('links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  url: text('url').notNull(),
  domainId: integer('domain_id').notNull().references(() => domains.id),
  password: text('password'), // PBKDF2 hash, null = no password
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  maxClicks: integer('max_clicks'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_links_slug_domain').on(table.slug, table.domainId),
  index('idx_links_domain').on(table.domainId),
])

export const clicks = sqliteTable('clicks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  linkId: integer('link_id').notNull().references(() => links.id, { onDelete: 'cascade' }),
  country: text('country'),
  city: text('city'),
  device: text('device'), // mobile, desktop, tablet
  browser: text('browser'),
  os: text('os'),
  referer: text('referer'),
  ip: text('ip'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('idx_clicks_link').on(table.linkId),
  index('idx_clicks_created').on(table.createdAt),
])
