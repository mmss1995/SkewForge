import { describe, expect, it } from 'vitest'
import { loadConfig, parseDuration } from './config'

describe('config', () => {
  it('parses durations', () => {
    expect(parseDuration('90s')).toBe(90_000)
    expect(parseDuration('7d')).toBe(604_800_000)
    expect(parseDuration('1.5h')).toBe(5_400_000)
    expect(parseDuration('250')).toBe(250)
    expect(() => parseDuration('soon')).toThrow(/invalid duration/)
  })

  it('has development defaults but demands a real token in production', () => {
    expect(loadConfig({})).toMatchObject({ port: 8080, adminPort: 8081, adminToken: 'dev-admin-token', spaFallback: true, publicUrl: null })
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ADMIN_TOKEN/)
    expect(loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: 'x'.repeat(32), PUBLIC_URL: 'https://shop.example/' }).publicUrl).toBe('https://shop.example')
  })

  it('reads retention settings', () => {
    expect(loadConfig({ RETENTION_KEEP_LAST: '3', RETENTION_MIN_AGE: '2d', RETENTION_PROTECT_ACTIVE: 'false' }).retention).toEqual({
      keepLast: 3,
      minAgeMs: 172_800_000,
      protectActiveSessions: false,
    })
    expect(() => loadConfig({ PORT: '-1' })).toThrow(/PORT/)
  })
})
