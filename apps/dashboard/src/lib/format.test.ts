import { describe, expect, it } from 'vitest'
import { compact, dedupeRatio, duration, formatBytes, timeAgo } from './format'

describe('format', () => {
  it('formats bytes, counts and durations', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 kB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(compact(1284)).toBe('1,284')
    expect(compact(12_900)).toBe('12.9K')
    expect(duration(7 * 86_400_000)).toBe('7 d')
    expect(duration(90_000)).toBe('90 s')
  })

  it('describes relative times', () => {
    expect(timeAgo(1000, 1000)).toBe('just now')
    expect(timeAgo(0, 5 * 60_000)).toBe('5 min ago')
    expect(timeAgo(0, 3 * 3_600_000)).toBe('3 h ago')
    expect(timeAgo(0, 2 * 86_400_000)).toBe('2 d ago')
  })

  it('computes the dedupe ratio', () => {
    expect(dedupeRatio(300, 100)).toBe(3)
    expect(dedupeRatio(0, 0)).toBe(1)
  })
})
