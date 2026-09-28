import { describe, expect, it } from 'vitest'
import { deploymentInputSchema } from './schema'

const file = { hash: 'a'.repeat(64), size: 1, type: 'text/html', immutable: false }

describe('deploymentInputSchema', () => {
  it('applies defaults', () => {
    const parsed = deploymentInputSchema.parse({ id: 'abc123', files: { 'index.html': file } })
    expect(parsed).toMatchObject({ entry: 'index.html', mandatory: false, promote: false, meta: {} })
  })

  it('accepts asset-only deployments', () => {
    expect(deploymentInputSchema.safeParse({ id: 'b1', entry: null, files: { 'a.js': file } }).success).toBe(true)
  })

  it.each([
    ['a bad id', { id: '-oops', files: { 'index.html': file } }],
    ['a missing entry', { id: 'b1', files: { 'a.js': file } }],
    ['no files', { id: 'b1', entry: null, files: {} }],
    ['an unnormalized path', { id: 'b1', entry: null, files: { '/a.js': file } }],
    ['a traversal path', { id: 'b1', entry: null, files: { '../a.js': file } }],
    ['a bad hash', { id: 'b1', entry: null, files: { 'a.js': { ...file, hash: 'xyz' } } }],
  ])('rejects %s', (_label, input) => {
    expect(deploymentInputSchema.safeParse(input).success).toBe(false)
  })
})
