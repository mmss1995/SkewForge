import { describe, expect, it } from 'vitest'
import { contentTypeFor, isFingerprinted, looksLikeRoute, normalizeAssetPath } from './paths'

describe('normalizeAssetPath', () => {
  it('strips slashes and empty segments', () => {
    expect(normalizeAssetPath('/assets//index-abc.js')).toBe('assets/index-abc.js')
    expect(normalizeAssetPath('/')).toBe('')
    expect(normalizeAssetPath('/about/')).toBe('about')
  })

  it('decodes percent-encoding', () => {
    expect(normalizeAssetPath('/fonts/My%20Font.woff2')).toBe('fonts/My Font.woff2')
  })

  it.each(['/../etc/passwd', '/assets/%2e%2e/secret', '/a/./b', '/a\\b', '/%00', '/%E0%A4%A'])('rejects %s', (path) => {
    expect(normalizeAssetPath(path)).toBeNull()
  })
})

describe('isFingerprinted', () => {
  it.each(['assets/index-B3kq1_Za.js', 'assets/style.4f3c1a2b.css', '_next/static/chunks/page-4f3c1a2b9d0e.js', 'logo-DsB9vEeA.svg'])(
    'recognises %s',
    (path) => expect(isFingerprinted(path)).toBe(true),
  )

  it.each(['index.html', 'remoteEntry.js', 'lib/component-registry.js', 'favicon.ico', 'assets/index-legacy.js'])('rejects %s', (path) =>
    expect(isFingerprinted(path)).toBe(false),
  )
})

describe('contentTypeFor / looksLikeRoute', () => {
  it('maps common web extensions', () => {
    expect(contentTypeFor('a/b.JS')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('x.woff2')).toBe('font/woff2')
    expect(contentTypeFor('LICENSE')).toBe('application/octet-stream')
  })

  it('treats extensionless paths and html as routes', () => {
    expect(looksLikeRoute('users/42')).toBe(true)
    expect(looksLikeRoute('')).toBe(true)
    expect(looksLikeRoute('docs/index.html')).toBe(true)
    expect(looksLikeRoute('assets/app.js')).toBe(false)
  })
})
