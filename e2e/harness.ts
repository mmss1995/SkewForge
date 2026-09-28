import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
export const TOKEN = 'e2e-admin-token-1234'
export const releaseDir = (app: string, release: number) => join(ROOT, '.demo', `${app}-v${release}`)

export interface GatewayProcess {
  edge: string
  admin: string
  cli(...args: string[]): string
  stop(): Promise<void>
}

async function waitFor(url: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`${url} did not come up`)
}

/** Starts the real gateway (tsx, no build step) on its own ports and an empty data dir. */
export async function startGateway(port: number): Promise<GatewayProcess> {
  const dataDir = mkdtempSync(join(tmpdir(), 'skewforge-e2e-'))
  const child: ChildProcess = spawn(join(ROOT, 'node_modules/.bin/tsx'), ['packages/server/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ADMIN_PORT: String(port + 1), HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_TOKEN: TOKEN, GC_INTERVAL: '0' },
    stdio: 'inherit',
  })
  const admin = `http://127.0.0.1:${port + 1}`
  await waitFor(`${admin}/health`)
  return {
    edge: `http://127.0.0.1:${port}`,
    admin,
    cli: (...args) =>
      execFileSync(join(ROOT, 'node_modules/.bin/tsx'), ['packages/cli/src/bin.ts', ...args], {
        cwd: ROOT,
        env: { ...process.env, SKEWFORGE_SERVER: admin, SKEWFORGE_TOKEN: TOKEN },
        encoding: 'utf8',
      }),
    async stop() {
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill('SIGTERM')
      await exited
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

/**
 * What most teams run today: one directory of the latest build behind nginx with
 * `try_files $uri /index.html`. A deploy swaps the directory; old chunks are gone, and a
 * missing chunk gets index.html back, which the browser refuses to execute as a module.
 */
export async function startNaiveServer(port: number): Promise<{ url: string; serve(dir: string): void; stop(): void }> {
  let root = ''
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    let file = join(root, path)
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
    res.end(readFileSync(file))
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${port}`,
    serve: (dir) => {
      root = dir
    },
    stop: () => server.close(),
  }
}
