import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { contentTypeFor, isFingerprinted, normalizeAssetPath, type FileEntry } from '@skewforge/core'

/** Written by `@skewforge/vite` next to the build output; never uploaded. */
export const BUILD_INFO_FILE = '.skewforge.json'

export interface BuildInfo {
  deploymentId?: string
}

export interface LocalFile extends FileEntry {
  /** Manifest path, with the prefix applied. */
  path: string
  absolute: string
}

export interface ScanOptions {
  /** Published under this path, e.g. `_next/static` for a Next.js asset-only deploy. */
  prefix?: string
  /** Extra path prefixes (after `prefix`) whose files are content-addressed even without a hash in the name. */
  immutable?: string[]
}

const IGNORED = new Set([BUILD_INFO_FILE, '.DS_Store', 'Thumbs.db'])

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(absolute)
    else if (entry.isFile()) yield absolute
  }
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => digest.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(digest.digest('hex')))
  })
}

/** Hashes every file of a build directory into manifest entries, sorted by path. */
export async function scanBuild(dir: string, options: ScanOptions = {}): Promise<LocalFile[]> {
  const prefix = options.prefix ? normalizeAssetPath(options.prefix) : ''
  if (prefix === null) throw new Error(`invalid prefix "${options.prefix}"`)
  const immutablePrefixes = (options.immutable ?? []).map((value) => normalizeAssetPath(value) ?? value)

  const files: LocalFile[] = []
  for await (const absolute of walk(dir)) {
    const local = relative(dir, absolute).split(sep).join('/')
    const path = normalizeAssetPath(prefix ? `${prefix}/${local}` : local)
    if (!path) throw new Error(`cannot publish "${local}": not a valid URL path`)
    const [hash, info] = await Promise.all([hashFile(absolute), stat(absolute)])
    files.push({
      path,
      absolute,
      hash,
      size: info.size,
      type: contentTypeFor(path),
      immutable: isFingerprinted(path) || immutablePrefixes.some((immutable) => path.startsWith(`${immutable}/`)),
    })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function readBuildInfo(dir: string): Promise<BuildInfo> {
  try {
    return JSON.parse(await readFile(join(dir, BUILD_INFO_FILE), 'utf8')) as BuildInfo
  } catch {
    return {}
  }
}
