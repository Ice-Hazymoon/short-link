import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

export const apiKeyAuth = createMiddleware<AppEnv>(async (c, next) => {
  const apiKey = c.env.API_KEY
  if (!apiKey) {
    // No API key configured, skip auth
    return next()
  }

  const provided = c.req.header('x-api-key') || c.req.query('api_key')
  if (!provided || provided !== apiKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return next()
})
