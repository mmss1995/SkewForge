import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256 } from '../test/harness'
import { BlobError, FsBlobStore } from './blobs'

let root: string
let store: FsBlobStore
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skewforge-blobs-'))
  store = new FsBlobStore(root)
  await store.init()
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('FsBlobStore', () => {
  it('round-trips content and lists it', async () => {
    const hash = sha256('hello')
    expect(await store.put(hash, Readable.from([Buffer.from('hel'), Buffer.from('lo')]), 100)).toBe(5)
    expect(await store.has(hash)).toBe(true)
    expect(await store.readText(hash)).toBe('hello')
    expect(await store.list()).toEqual([expect.objectContaining({ hash, size: 5 })])
    await store.delete(hash)
    expect(await store.has(hash)).toBe(false)
  })

  it('aborts streams over the size limit without leaving temp files', async () => {
    const body = 'x'.repeat(50)
    await expect(store.put(sha256(body), Readable.from([Buffer.from(body)]), 10)).rejects.toBeInstanceOf(BlobError)
    expect(await readdir(join(root, 'tmp'))).toEqual([])
    expect(await store.list()).toEqual([])
  })

  it('rejects digest mismatches', async () => {
    await expect(store.put(sha256('a'), Readable.from([Buffer.from('b')]), 10)).rejects.toMatchObject({ code: 'digest-mismatch' })
  })
})
