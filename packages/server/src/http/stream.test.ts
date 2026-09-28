import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, V1, V2, type Harness } from '../test/harness'

let h: Harness
let server: Server
let base: string
beforeEach(async () => {
  h = await createHarness()
  server = h.gateway.edge.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  await h.cleanup()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

/** Reads `event: version` payloads off an SSE response until `count` have arrived. */
async function readEvents(res: Response, count: number): Promise<unknown[]> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  const events: unknown[] = []
  let buffer = ''
  while (events.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let boundary: number
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = frame.split('\n').find((line) => line.startsWith('data: '))
      if (frame.includes('event: version') && data) events.push(JSON.parse(data.slice(6)))
    }
  }
  await reader.cancel()
  return events
}

describe('version stream', () => {
  it('sends the initial status, then pushes a promotion to tabs on the old deployment', async () => {
    await h.deploy('v1', V1)
    const res = await fetch(`${base}/__skewforge/stream?running=v1`)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const events = readEvents(res, 2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await h.deploy('v2', V2, { mandatory: true })
    expect(await events).toEqual([
      { current: 'v1', running: 'v1', updateAvailable: false, mandatory: false, reason: 'up-to-date' },
      { current: 'v2', running: 'v1', updateAvailable: true, mandatory: true, reason: 'mandatory' },
    ])
  })
})
