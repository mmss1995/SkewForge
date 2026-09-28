import { resolve } from 'node:path'
import { DEFAULT_RETENTION, type RetentionPolicy } from '@skewforge/core'

export interface Config {
  port: number
  adminPort: number
  host: string
  dataDir: string
  adminToken: string
  retention: RetentionPolicy
  /** How often garbage collection runs on its own; 0 disables it. */
  gcIntervalMs: number
  /** A browser session counts as live while its last beacon is younger than this. */
  sessionTtlMs: number
  /** Answer unknown extensionless paths with the entry HTML (client-side routing). */
  spaFallback: boolean
  maxBlobBytes: number
  dashboardDir: string | null
  /** Public origin of the edge listener, used for preview links in the dashboard and CLI. */
  publicUrl: string | null
}

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `90s`, `15m`, `7d`, or a bare number of milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(value.trim())
  if (!match) throw new Error(`invalid duration "${value}" (expected e.g. 90s, 15m, 7d)`)
  return Math.round(Number(match[1]) * UNITS[match[2] ?? 'ms']!)
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer, got "${value}"`)
  return parsed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  const adminToken = env.ADMIN_TOKEN ?? (production ? '' : 'dev-admin-token')
  if (adminToken.length < 12) {
    throw new Error('ADMIN_TOKEN must be set to at least 12 characters (it guards deploys, promotions and deletes)')
  }
  return {
    port: integer(env.PORT, 8080, 'PORT'),
    adminPort: integer(env.ADMIN_PORT, 8081, 'ADMIN_PORT'),
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? '.skewforge-data'),
    adminToken,
    retention: {
      keepLast: integer(env.RETENTION_KEEP_LAST, DEFAULT_RETENTION.keepLast, 'RETENTION_KEEP_LAST'),
      minAgeMs: env.RETENTION_MIN_AGE ? parseDuration(env.RETENTION_MIN_AGE) : DEFAULT_RETENTION.minAgeMs,
      protectActiveSessions: env.RETENTION_PROTECT_ACTIVE !== 'false',
    },
    gcIntervalMs: env.GC_INTERVAL ? parseDuration(env.GC_INTERVAL) : 3_600_000,
    sessionTtlMs: env.SESSION_TTL ? parseDuration(env.SESSION_TTL) : 180_000,
    spaFallback: env.SPA_FALLBACK !== 'false',
    maxBlobBytes: integer(env.MAX_BLOB_BYTES, 64 * 1024 * 1024, 'MAX_BLOB_BYTES'),
    dashboardDir: env.DASHBOARD_DIR ? resolve(env.DASHBOARD_DIR) : null,
    publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : null,
  }
}
