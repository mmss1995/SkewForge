import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Overview } from '../lib/api'
import { SessionProvider } from '../lib/session'
import { DeploymentsTable } from './DeploymentsTable'
import { TrafficChart } from './TrafficChart'

const minute = 60_000
const timeline = Array.from({ length: 60 }, (_, index) => ({ minute: index * minute, requests: index === 59 ? 12 : 0, rescued: index === 59 ? 5 : 0, misses: 0 }))

const deployment = (id: string, overrides: Partial<Overview['deployments'][number]> = {}): Overview['deployments'][number] => ({
  id,
  createdAt: Date.now() - 5 * minute,
  entry: 'index.html',
  meta: { message: `release ${id}` },
  mandatory: false,
  revoked: false,
  promotedAt: Date.now() - minute,
  retiredAt: null,
  fileCount: 5,
  totalBytes: 2048,
  newBytes: 1024,
  current: false,
  activeSessions: 0,
  ...overrides,
})

const overview = {
  current: 'v2',
  publicUrl: null,
  deployments: [deployment('v2', { current: true, activeSessions: 3 }), deployment('v1', { activeSessions: 1, revoked: true }), deployment('v3', { promotedAt: null })],
  promotions: [],
  retention: { keepLast: 5, minAgeMs: 86_400_000, protectActiveSessions: true },
  gcPlan: [
    { id: 'v2', keep: true, reason: 'current', activeSessions: 3 },
    { id: 'v1', keep: false, reason: 'expired', activeSessions: 0 },
  ],
  storage: { blobs: 7, bytes: 3000 },
  liveStreams: 4,
  telemetry: { since: 0, totals: { requests: 12, skewed: 5, rescued: 5, misses: 0 }, byDeployment: { v1: { requests: 5, skewed: 5, rescued: 5 } }, timeline, recentRescues: [], recentMisses: [] },
} satisfies Overview

function wrap(children: React.ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}

describe('TrafficChart', () => {
  it('shows a legend, a hover tooltip and a table view', () => {
    const { container } = render(<TrafficChart timeline={timeline} />)
    expect(screen.getByText('Rescued from an older deployment')).toBeTruthy()
    const hitTargets = container.querySelectorAll('rect[fill="transparent"]')
    expect(hitTargets).toHaveLength(60)
    fireEvent.mouseEnter(hitTargets[59]!)
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Served7')).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })
})

describe('DeploymentsTable', () => {
  it('lists deployments with status, live tabs and retention', () => {
    sessionStorage.setItem('skewforge:admin-token', 'token')
    render(wrap(<DeploymentsTable overview={overview} />))
    expect(screen.getByText('live')).toBeTruthy()
    expect(screen.getByText('revoked')).toBeTruthy()
    expect(screen.getByText('staged')).toBeTruthy()
    expect(screen.getByText('next GC deletes')).toBeTruthy()
    expect(screen.getByText('(5 rescued)')).toBeTruthy()
    // The live deployment can be neither promoted nor deleted.
    expect(screen.getAllByRole('button', { name: /Promote/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Delete v2' })).toBeNull()
  })
})
