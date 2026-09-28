import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultDeploymentId, skewforge } from './index'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skewforge-vite-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><title>t</title></head><body><script type="module" src="/main.js"></script></body></html>')
  await writeFile(join(root, 'main.js'), 'document.title = __SKEWFORGE_DEPLOYMENT__; import("./lazy.js")')
  await writeFile(join(root, 'lazy.js'), 'export default 1')
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('skewforge vite plugin', () => {
  it('stamps the id into html, code and build info', async () => {
    await build({ root, logLevel: 'silent', plugins: [skewforge({ deploymentId: 'abc123' })] })
    const dist = join(root, 'dist')
    const html = await readFile(join(dist, 'index.html'), 'utf8')
    expect(html).toContain('<meta name="skewforge-deployment" content="abc123">')
    const info = JSON.parse(await readFile(join(dist, '.skewforge.json'), 'utf8'))
    expect(info.deploymentId).toBe('abc123')
    const assets = await readdir(join(dist, 'assets'))
    const entry = assets.find((name) => name.startsWith('index-'))!
    expect(await readFile(join(dist, 'assets', entry), 'utf8')).toContain('abc123')
  })

  it('rejects ids the gateway would refuse', async () => {
    await expect(build({ root, logLevel: 'silent', plugins: [skewforge({ deploymentId: 'not valid!' })] })).rejects.toThrow(/invalid deployment id/)
  })

  it('derives unique ids per build', () => {
    expect(defaultDeploymentId(root, { SKEWFORGE_DEPLOYMENT_ID: 'from-ci' })).toBe('from-ci')
    expect(defaultDeploymentId(root, {}, 1000)).toMatch(/^[a-z0-9]+-rs$/)
  })
})
