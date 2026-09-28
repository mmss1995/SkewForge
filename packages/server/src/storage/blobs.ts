import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

export interface StoredBlob {
  hash: string
  size: number
  modifiedAt: number
}

/**
 * Content-addressed file storage. A file that did not change between two builds has the same
 * hash, so it is uploaded and stored once however many deployments reference it.
 * Only the filesystem implementation exists today; the interface is what an S3 one would fill.
 */
export interface BlobStore {
  has(hash: string): Promise<boolean>
  /** Streams `body` in, verifying it hashes to `hash`. Resolves to the stored size. */
  put(hash: string, body: Readable, maxBytes: number): Promise<number>
  read(hash: string): ReadStream
  readText(hash: string): Promise<string>
  list(): Promise<StoredBlob[]>
  delete(hash: string): Promise<void>
}

export class BlobError extends Error {
  constructor(
    message: string,
    readonly code: 'digest-mismatch' | 'too-large',
  ) {
    super(message)
  }
}

export class FsBlobStore implements BlobStore {
  private readonly tmpDir: string

  constructor(private readonly root: string) {
    this.tmpDir = join(root, 'tmp')
  }

  async init(): Promise<void> {
    await mkdir(this.tmpDir, { recursive: true })
    // Half-written uploads from a crash are never referenced; drop them on boot.
    for (const name of await readdir(this.tmpDir)) await rm(join(this.tmpDir, name), { force: true })
  }

  private pathOf(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash)
  }

  async has(hash: string): Promise<boolean> {
    try {
      await stat(this.pathOf(hash))
      return true
    } catch {
      return false
    }
  }

  async put(hash: string, body: Readable, maxBytes: number): Promise<number> {
    const tmp = join(this.tmpDir, randomUUID())
    const digest = createHash('sha256')
    let size = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > maxBytes) return callback(new BlobError(`blob exceeds ${maxBytes} bytes`, 'too-large'))
        digest.update(chunk)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(body, meter, createWriteStream(tmp))
      const actual = digest.digest('hex')
      if (actual !== hash) throw new BlobError(`content hashes to ${actual}, not ${hash}`, 'digest-mismatch')
      const target = this.pathOf(hash)
      await mkdir(join(this.root, hash.slice(0, 2)), { recursive: true })
      // Same hash means same bytes: a concurrent upload of the same blob landing first is fine.
      await rename(tmp, target)
      return size
    } finally {
      await rm(tmp, { force: true })
    }
  }

  read(hash: string): ReadStream {
    return createReadStream(this.pathOf(hash))
  }

  readText(hash: string): Promise<string> {
    return readFile(this.pathOf(hash), 'utf8')
  }

  async list(): Promise<StoredBlob[]> {
    const blobs: StoredBlob[] = []
    for (const shard of await readdir(this.root)) {
      if (!/^[a-f0-9]{2}$/.test(shard)) continue
      for (const hash of await readdir(join(this.root, shard))) {
        const info = await stat(join(this.root, shard, hash))
        blobs.push({ hash, size: info.size, modifiedAt: info.mtimeMs })
      }
    }
    return blobs
  }

  async delete(hash: string): Promise<void> {
    await rm(this.pathOf(hash), { force: true })
  }
}
