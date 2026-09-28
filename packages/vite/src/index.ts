import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { DEPLOYMENT_META, deploymentIdSchema } from '@skewforge/core'

export interface SkewForgePluginOptions {
  /**
   * Unique id for this build. Defaults to `SKEWFORGE_DEPLOYMENT_ID`, then to
   * `<short git sha>-<build time>` (rebuilding one commit twice must not reuse an id).
   */
  deploymentId?: string
}

/** Where the CLI looks for the id; kept out of the upload. */
export const BUILD_INFO_FILE = '.skewforge.json'

function gitSha(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

export function defaultDeploymentId(root: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): string {
  if (env.SKEWFORGE_DEPLOYMENT_ID) return env.SKEWFORGE_DEPLOYMENT_ID
  return `${gitSha(root) ?? 'build'}-${now.toString(36)}`
}

/**
 * Stamps a deployment id into the build:
 * - `<meta name="skewforge-deployment">` in index.html (the gateway rewrites it anyway, so the
 *   page also works behind a gateway that deployed it under another id);
 * - `__SKEWFORGE_DEPLOYMENT__` as a compile-time constant for your own code;
 * - `.skewforge.json` next to the output, which `skewforge deploy` reads.
 */
export function skewforge(options: SkewForgePluginOptions = {}): Plugin {
  let config: ResolvedConfig
  let id = 'dev'

  return {
    name: 'skewforge',
    config(_user, { command }) {
      if (command === 'build') {
        id = options.deploymentId ?? defaultDeploymentId(process.cwd())
        const parsed = deploymentIdSchema.safeParse(id)
        if (!parsed.success) throw new Error(`[skewforge] invalid deployment id "${id}": ${parsed.error.issues[0]?.message}`)
      }
      const literal = JSON.stringify(id)
      return { define: { __SKEWFORGE_DEPLOYMENT__: literal, 'globalThis.__SKEWFORGE_DEPLOYMENT__': literal } }
    },
    configResolved(resolved) {
      config = resolved
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: DEPLOYMENT_META, content: id }, injectTo: 'head-prepend' }]
    },
    async writeBundle() {
      if (config.command !== 'build' || config.build.ssr) return
      const info = { deploymentId: id, builtAt: new Date().toISOString() }
      await writeFile(resolve(config.root, config.build.outDir, BUILD_INFO_FILE), `${JSON.stringify(info, null, 2)}\n`)
    },
  }
}

export default skewforge
