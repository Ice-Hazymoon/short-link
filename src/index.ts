import { Hono } from 'hono'
import { cors } from 'hono/cors'
import api from './routes/api'
import redirect from './routes/redirect'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

// Global middleware
app.use('/api/*', cors())

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// API routes
app.route('/api', api)

// Redirect routes (must be last — catches /:slug)
app.route('/', redirect)

export default app
