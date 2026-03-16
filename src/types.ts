export type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  ANALYTICS: AnalyticsEngineDataset
  API_KEY: string
}

export type Variables = {
  // Add any per-request variables here
}

export type AppEnv = {
  Bindings: Bindings
  Variables: Variables
}
