import { describe, expect, it } from 'vitest'
import { AssetIndex, resolveAsset, resolveDocument } from './resolve'
import { fakeDeployment, fakeHistory } from './testing'

// v1 and v2 share the vendor chunk; each has its own entry and route chunk; remoteEntry.js is
// not fingerprinted, so the same path means different content in each deployment.
const v1 = fakeDeployment('v1', ['index.html', 'assets/index-v1.js', 'assets/About-v1.js', 'assets/vendor-shared.js', 'remoteEntry.js=a1'])
const v2 = fakeDeployment('v2', ['index.html', 'assets/index-v2.js', 'assets/About-v2.js', 'assets/vendor-shared.js', 'remoteEntry.js=b2'])
const index = new AssetIndex(fakeHistory(v1, v2))

describe('resolveAsset', () => {
  it('serves the current deployment by default', () => {
    expect(resolveAsset(index, { path: 'assets/index-v2.js' })).toMatchObject({ deployment: { id: 'v2' }, via: 'current', skewed: false, rescued: false })
  })

  it('rescues files that only an older deployment still has', () => {
    expect(resolveAsset(index, { path: 'assets/About-v1.js' })).toMatchObject({ deployment: { id: 'v1' }, via: 'fallback', skewed: true, rescued: true })
  })

  it('returns null for files no deployment has', () => {
    expect(resolveAsset(index, { path: 'assets/nope.js' })).toBeNull()
  })

  it('honours an explicit pin', () => {
    expect(resolveAsset(index, { path: 'remoteEntry.js', pinned: 'v1' })).toMatchObject({ deployment: { id: 'v1' }, via: 'pinned', skewed: true, rescued: false })
  })

  it('ignores a pin to a deployment without the file', () => {
    expect(resolveAsset(index, { path: 'assets/index-v2.js', pinned: 'v1' })).toMatchObject({ deployment: { id: 'v2' }, via: 'current' })
    expect(resolveAsset(index, { path: 'assets/index-v2.js', pinned: 'ghost' })).toMatchObject({ via: 'current' })
  })

  it('follows the importing module for non-fingerprinted files', () => {
    const fromOldEntry = resolveAsset(index, { path: 'remoteEntry.js', referer: { path: 'assets/index-v1.js', dpl: null } })
    expect(fromOldEntry).toMatchObject({ deployment: { id: 'v1' }, via: 'referer' })
    expect(fromOldEntry?.file.hash.startsWith('a1')).toBe(true)
  })

  it('prefers the current deployment when the importer is shared', () => {
    expect(resolveAsset(index, { path: 'remoteEntry.js', referer: { path: 'assets/vendor-shared.js', dpl: null } })).toMatchObject({ deployment: { id: 'v2' }, via: 'referer' })
  })

  it('uses a dpl carried by the referer', () => {
    expect(resolveAsset(index, { path: 'remoteEntry.js', referer: { path: 'about', dpl: 'v1' } })).toMatchObject({ deployment: { id: 'v1' }, via: 'referer' })
  })

  it('falls through when the referer is a page route', () => {
    expect(resolveAsset(index, { path: 'remoteEntry.js', referer: { path: 'about', dpl: null } })).toMatchObject({ deployment: { id: 'v2' }, via: 'current' })
  })

  it('picks the newest holder when nothing is current', () => {
    const staged = new AssetIndex({ ...fakeHistory(v1, v2), current: null })
    expect(resolveAsset(staged, { path: 'remoteEntry.js' })).toMatchObject({ deployment: { id: 'v2' }, via: 'fallback', rescued: true })
  })
})

describe('resolveDocument', () => {
  it('serves the current entry, or a pinned preview', () => {
    expect(resolveDocument(index, null)?.id).toBe('v2')
    expect(resolveDocument(index, 'v1')?.id).toBe('v1')
    expect(resolveDocument(index, 'ghost')?.id).toBe('v2')
  })

  it('never serves an asset-only deployment as a document', () => {
    const assetsOnly = fakeDeployment('static', ['_next/static/chunks/a-1234abcd.js'])
    const registry = fakeHistory(v1, assetsOnly)
    expect(resolveDocument(new AssetIndex(registry), null)).toBeNull()
    expect(resolveDocument(new AssetIndex(registry), 'static')).toBeNull()
  })
})

describe('visibility', () => {
  it('hides deployments the request may not see, even when pinned', () => {
    const staged = fakeDeployment('v3', ['index.html', 'assets/index-v3.js', 'remoteEntry.js=c3'])
    const registry = fakeHistory(v1, v2)
    registry.deployments.push({ ...staged, createdAt: 9000 })
    const withStaged = new AssetIndex(registry)
    const visible = (deployment: { id: string }) => deployment.id !== 'v3'
    expect(resolveAsset(withStaged, { path: 'assets/index-v3.js', visible })).toBeNull()
    expect(resolveAsset(withStaged, { path: 'remoteEntry.js', pinned: 'v3', visible })).toMatchObject({ deployment: { id: 'v2' } })
    expect(resolveAsset(withStaged, { path: 'remoteEntry.js', pinned: 'v3' })).toMatchObject({ deployment: { id: 'v3' }, via: 'pinned' })
  })
})
