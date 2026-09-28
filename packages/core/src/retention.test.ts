import { describe, expect, it } from 'vitest'
import { planRetention, referencedBlobs, type RetentionPolicy } from './retention'
import { fakeDeployment, fakeHistory } from './testing'

const DAY = 24 * 60 * 60 * 1000
const policy: RetentionPolicy = { keepLast: 2, minAgeMs: DAY, protectActiveSessions: true }
const now = 10 * DAY

function registry() {
  return fakeHistory(
    fakeDeployment('v1', ['index.html=11'], { createdAt: 1 * DAY, retiredAt: 2 * DAY }),
    fakeDeployment('v2', ['index.html=22'], { createdAt: 2 * DAY, retiredAt: 3 * DAY }),
    fakeDeployment('v3', ['index.html=33'], { createdAt: 3 * DAY, retiredAt: 9.5 * DAY }),
    fakeDeployment('v4', ['index.html=44'], { createdAt: 4 * DAY, retiredAt: 9.6 * DAY }),
    fakeDeployment('v5', ['index.html=55', 'shared.js=ff'], { createdAt: 9.6 * DAY }),
  )
}

const byId = (decisions: ReturnType<typeof planRetention>) => Object.fromEntries(decisions.map((decision) => [decision.id, decision.reason]))

describe('planRetention', () => {
  it('keeps current, recent and recently retired deployments', () => {
    expect(byId(planRetention(registry(), new Map(), policy, now))).toEqual({
      v5: 'current',
      v4: 'recent',
      v3: 'grace-period',
      v2: 'expired',
      v1: 'expired',
    })
  })

  it('protects deployments with live sessions unless told otherwise', () => {
    const sessions = new Map([['v1', 3]])
    const decisions = planRetention(registry(), sessions, policy, now)
    expect(decisions.find((decision) => decision.id === 'v1')).toMatchObject({ keep: true, reason: 'active-sessions', activeSessions: 3 })
    expect(byId(planRetention(registry(), sessions, { ...policy, protectActiveSessions: false }, now)).v1).toBe('expired')
  })

  it('counts the grace period from creation for never-promoted deployments', () => {
    const r = registry()
    r.deployments.unshift(fakeDeployment('staged', ['index.html=99'], { createdAt: 3.5 * DAY }))
    expect(byId(planRetention(r, new Map(), policy, now)).staged).toBe('expired')
    r.deployments[0]!.createdAt = 9.9 * DAY
    // Now the newest deployment by creation date, so it takes one of the keepLast slots.
    expect(byId(planRetention(r, new Map(), policy, now)).staged).toBe('recent')
  })
})

describe('referencedBlobs', () => {
  it('collects hashes of kept deployments only', () => {
    const hashes = referencedBlobs(registry(), new Set(['v5']))
    expect(hashes.size).toBe(2)
  })
})
