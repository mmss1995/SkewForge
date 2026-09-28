import { expect, test, type Page } from '@playwright/test'
import { releaseDir, startGateway, startNaiveServer, type GatewayProcess } from './harness'

/** Keeps a tab from learning about new releases, like one that has not heard back yet. */
async function deafen(page: Page) {
  await page.route('**/__skewforge/stream**', (route) => route.abort())
  await page.route('**/__skewforge/version**', (route) => route.abort())
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test.describe('without SkewForge', () => {
  test('an open tab breaks on its next lazy route after a deploy', async ({ page }) => {
    const naive = await startNaiveServer(18_090)
    try {
      naive.serve(releaseDir('react-app', 1))
      const errors = collectErrors(page)
      await page.goto(naive.url)
      await expect(page.getByRole('heading', { name: 'Try to break it' })).toBeVisible()

      naive.serve(releaseDir('react-app', 2))
      await page.getByRole('link', { name: 'Catalog' }).click()

      await expect.poll(() => errors.join('\n')).toMatch(/Failed to fetch dynamically imported module|MIME type/)
      await expect(page.getByTestId('route')).toHaveCount(0)
    } finally {
      naive.stop()
    }
  })
})

// Every test gets fresh ports so a gateway still shutting down can never answer for the next one.
let nextPort = 18_100

for (const app of ['react-app', 'vue-app']) {
  test.describe(`${app} behind SkewForge`, () => {
    let gateway: GatewayProcess
    test.beforeEach(async () => {
      gateway = await startGateway(nextPort)
      nextPort += 2
      gateway.cli('deploy', releaseDir(app, 1), '--promote')
    })
    test.afterEach(() => gateway.stop())

    test('a tab that missed the deploy keeps loading its own chunks', async ({ page }) => {
      await deafen(page)
      const errors = collectErrors(page)
      await page.goto(gateway.edge)
      await expect(page.getByTestId('badge')).toContainText(`${app}-v1`)

      gateway.cli('deploy', releaseDir(app, 2), '--promote')
      await page.getByRole('link', { name: 'Catalog' }).click()

      await expect(page.getByTestId('release')).toHaveText('1')
      await expect(page.getByTestId('badge')).toContainText(`${app}-v1`)
      // The only failures are the update checks `deafen` aborts on purpose.
      expect(errors.filter((error) => !error.includes('net::ERR_FAILED'))).toEqual([])
    })

    test('a connected tab is told about the release and moves on at the next click', async ({ page }) => {
      await page.goto(gateway.edge)
      await expect(page.getByTestId('badge')).toContainText('live')

      gateway.cli('deploy', releaseDir(app, 2), '--promote')
      await expect(page.getByRole('status')).toContainText('A new version of the shop is live')

      await page.getByRole('link', { name: 'Checkout' }).click()
      await expect(page.getByTestId('release')).toHaveText('2')
      await expect(page.getByTestId('badge')).toContainText(`${app}-v2`)
      await expect(page.getByRole('status')).toHaveCount(0)
    })

    test('a rollback pulls tabs off the bad release immediately', async ({ page }) => {
      gateway.cli('deploy', releaseDir(app, 2), '--promote')
      await page.goto(`${gateway.edge}/catalog`)
      await expect(page.getByTestId('release')).toHaveText('2')
      await expect(page.getByTestId('badge')).toContainText('live')

      gateway.cli('rollback')
      await expect(page.getByTestId('badge')).toContainText(`${app}-v1`)
      await expect(page.getByTestId('release')).toHaveText('1')
    })
  })
}
