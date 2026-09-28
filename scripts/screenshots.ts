// Regenerates docs/screenshots: a gateway with three releases, tabs on two of them, some rescued
// and some lost requests, then the dashboard and the example app with its update banner.
//   npm run build -w @skewforge/dashboard && npx tsx scripts/screenshots.ts
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const token = 'screenshot-token-1234'
const dataDir = mkdtempSync(join(tmpdir(), 'skewforge-shots-'))
const edge = 'http://127.0.0.1:19080'
const admin = 'http://127.0.0.1:19081'

const gateway = spawn(join(root, 'node_modules/.bin/tsx'), ['packages/server/src/index.ts'], {
  cwd: root,
  env: { ...process.env, PORT: '19080', ADMIN_PORT: '19081', HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_TOKEN: token, DASHBOARD_DIR: 'apps/dashboard/dist', PUBLIC_URL: edge, GC_INTERVAL: '0' },
  stdio: 'inherit',
})

const cli = (...args: string[]) =>
  execFileSync(join(root, 'node_modules/.bin/tsx'), ['packages/cli/src/bin.ts', ...args], { cwd: root, env: { ...process.env, SKEWFORGE_SERVER: admin, SKEWFORGE_TOKEN: token }, encoding: 'utf8' })

try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${admin}/health`)).ok) break
    } catch {
      if (attempt > 100) throw new Error('gateway did not start')
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  for (const release of [1, 2, 3]) execFileSync('bash', ['scripts/build-release.sh', 'react-app', String(release)], { cwd: root, stdio: 'ignore' })

  const messages = ['feat: catalog filters', 'fix: checkout rounding', 'feat: product reviews']
  const browser = await chromium.launch()
  const tabs = []
  for (const release of [1, 2]) {
    cli('deploy', join(root, '.demo', `react-app-v${release}`), '--id', `shop-${release}`, '--promote', '--message', messages[release - 1]!)
    // Tabs opened on this release stay open (and keep beaconing) through the next deploy.
    for (let tab = 0; tab < (release === 1 ? 2 : 3); tab++) {
      const page = await (await browser.newContext()).newPage()
      // Two release-1 tabs never hear about the update (a sleeping laptop, a dropped stream):
      // their next clicks load release-1 chunks the live deployment no longer has.
      if (release === 1) await page.route('**/__skewforge/{stream,version}**', (route) => route.abort())
      await page.goto(edge)
      tabs.push(page)
    }
  }
  cli('deploy', join(root, '.demo', 'react-app-v3'), '--id', 'shop-3', '--message', messages[2]!)

  // The release-1 tabs, blocked from hearing about the update, navigate into lazy routes: rescues.
  for (const page of tabs.slice(0, 2)) {
    await page.getByRole('link', { name: 'Catalog' }).click()
    await page.getByTestId('release').waitFor()
    await page.getByRole('link', { name: 'Product' }).click()
    await page.getByTestId('release').waitFor()
  }
  await fetch(`${edge}/assets/Checkout-GoneAway.js`)
  for (let i = 0; i < 25; i++) await fetch(`${edge}/`)

  const appShot = tabs[2]!
  await appShot.setViewportSize({ width: 900, height: 560 })
  cli('promote', 'shop-3')
  await appShot.getByRole('status').waitFor()
  await appShot.screenshot({ path: 'docs/screenshots/app-update-banner.png' })

  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 })
    const dashboard = await context.newPage()
    await dashboard.goto(admin)
    await dashboard.getByLabel('Admin token').fill(token)
    await dashboard.getByRole('button', { name: 'Sign in' }).click()
    await dashboard.getByText('Traffic, last 60 minutes').waitFor()
    await dashboard.waitForTimeout(500)
    await dashboard.screenshot({ path: `docs/screenshots/dashboard-${scheme}.png`, fullPage: true })
  }
  await browser.close()
  console.log('screenshots written to docs/screenshots')
} finally {
  gateway.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
