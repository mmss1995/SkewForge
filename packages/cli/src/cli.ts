import { execFileSync } from 'node:child_process'
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util'
import type { DeploymentMeta, DeploymentSummary } from '@skewforge/core'
import { AdminClient } from './client'
import { deploy } from './deploy'

export interface Io {
  out: (line: string) => void
  err: (line: string) => void
  env: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

const HELP = `skewforge — ship builds to a SkewForge gateway

Usage
  skewforge deploy <dir> [--id <id>] [--promote] [--mandatory] [--prefix <path>] [--no-entry]
                          [--entry <file>] [--immutable <path>]... [--concurrency <n>] [--message <text>]
  skewforge promote <id> [--mandatory]
  skewforge rollback [--to <id>] [--no-revoke]
  skewforge list
  skewforge rm <id>
  skewforge gc [--dry-run]

Global options
  --server <url>   admin API (env SKEWFORGE_SERVER, default http://localhost:8081)
  --token <token>  admin token (env SKEWFORGE_TOKEN)
  --json           machine-readable output

The deployment id defaults to SKEWFORGE_DEPLOYMENT_ID, then to the id @skewforge/vite wrote
into the build. Use something unique per build: a commit SHA, a CI run number.`

const OPTIONS = {
  server: { type: 'string' },
  token: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  id: { type: 'string' },
  promote: { type: 'boolean', default: false },
  mandatory: { type: 'boolean' },
  prefix: { type: 'string' },
  entry: { type: 'string' },
  'no-entry': { type: 'boolean', default: false },
  immutable: { type: 'string', multiple: true, default: [] as string[] },
  concurrency: { type: 'string', default: '8' },
  message: { type: 'string' },
  to: { type: 'string' },
  'no-revoke': { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
} satisfies ParseArgsOptionsConfig

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined
  } catch {
    return undefined
  }
}

/** Commit metadata from the usual CI variables, falling back to the local git checkout. */
export function detectMeta(env: NodeJS.ProcessEnv, message?: string): DeploymentMeta {
  const meta: DeploymentMeta = {}
  const commit = env.GITHUB_SHA ?? env.CI_COMMIT_SHA ?? env.VERCEL_GIT_COMMIT_SHA ?? git(['rev-parse', 'HEAD'])
  const branch = env.GITHUB_REF_NAME ?? env.CI_COMMIT_REF_NAME ?? git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const subject = message ?? env.CI_COMMIT_TITLE ?? git(['log', '-1', '--format=%s'])
  const author = env.GITHUB_ACTOR ?? env.GITLAB_USER_LOGIN ?? git(['log', '-1', '--format=%an'])
  if (commit) meta.commit = commit.slice(0, 40)
  if (branch) meta.branch = branch.slice(0, 200)
  if (subject) meta.message = subject.slice(0, 500)
  if (author) meta.author = author.slice(0, 200)
  return meta
}

function table(rows: DeploymentSummary[]): string[] {
  const lines = rows.map((row) => [
    row.current ? '●' : row.revoked ? '✕' : row.promotedAt ? '○' : '◌',
    row.id,
    row.entry ? 'app' : 'assets',
    new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 16),
    `${row.fileCount} files`,
    formatBytes(row.totalBytes),
    [row.mandatory && 'mandatory', row.revoked && 'revoked', !row.promotedAt && 'staged'].filter(Boolean).join(', '),
  ])
  const widths = lines[0]?.map((_, column) => Math.max(...lines.map((line) => String(line[column]).length))) ?? []
  return lines.map((line) => line.map((cell, column) => String(cell).padEnd(widths[column]!)).join('  ').trimEnd())
}

/** Runs one CLI invocation; resolves to the process exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    io.err((error as Error).message)
    io.err('Run `skewforge --help` for usage.')
    return 2
  }
  const { values, positionals } = parsed
  const [command, target] = positionals
  if (values.help || !command) {
    io.out(HELP)
    return command || values.help ? 0 : 2
  }

  const server = values.server ?? io.env.SKEWFORGE_SERVER ?? 'http://localhost:8081'
  const token = values.token ?? io.env.SKEWFORGE_TOKEN
  if (!token) {
    io.err('missing admin token: pass --token or set SKEWFORGE_TOKEN')
    return 2
  }
  const client = new AdminClient(server, token, io.fetch)
  const print = (value: unknown, human: () => void) => (values.json ? io.out(JSON.stringify(value, null, 2)) : human())

  try {
    switch (command) {
      case 'deploy': {
        if (!target) throw new UsageError('deploy needs a build directory, e.g. `skewforge deploy dist`')
        const concurrency = Number(values.concurrency)
        if (!Number.isInteger(concurrency) || concurrency < 1) throw new UsageError('--concurrency must be a positive integer')
        const result = await deploy(client, {
          dir: target,
          id: values.id ?? io.env.SKEWFORGE_DEPLOYMENT_ID,
          entry: values['no-entry'] ? null : values.entry,
          promote: values.promote,
          mandatory: values.mandatory ?? false,
          meta: detectMeta(io.env, values.message),
          concurrency,
          ...(values.prefix ? { prefix: values.prefix } : {}),
          immutable: values.immutable,
          onProgress: values.json
            ? undefined
            : (event) => {
                if (event.type === 'scanned') io.out(`scanned ${event.files} files (${formatBytes(event.bytes)})`)
                if (event.type === 'missing') io.out(`uploading ${event.blobs} new blob(s) (${formatBytes(event.bytes)}); the rest are already stored`)
              },
        })
        print(result, () => {
          const { deployment } = result
          io.out(`✔ deployment ${deployment.id}: ${result.files} files, ${result.uploadedBlobs} uploaded, ${result.skippedBlobs} reused`)
          if (deployment.current) io.out(`✔ promoted: ${deployment.id} is now live`)
          else if (deployment.previewUrl) io.out(`  staged — preview it at <edge>${deployment.previewUrl}, then \`skewforge promote ${deployment.id}\``)
        })
        return 0
      }
      case 'promote': {
        if (!target) throw new UsageError('promote needs a deployment id')
        const deployment = await client.promote(target, values.mandatory)
        print(deployment, () => io.out(`✔ ${deployment.id} is now live${deployment.mandatory ? ' (mandatory: older tabs reload now)' : ''}`))
        return 0
      }
      case 'rollback': {
        const deployment = await client.rollback(values.to, !values['no-revoke'])
        print(deployment, () => io.out(`✔ rolled back: ${deployment.id} is live again${values['no-revoke'] ? '' : '; tabs on the bad build will reload'}`))
        return 0
      }
      case 'list': {
        const deployments = await client.list()
        print(deployments, () => {
          if (deployments.length === 0) io.out('no deployments yet')
          for (const line of table(deployments)) io.out(line)
        })
        return 0
      }
      case 'rm': {
        if (!target) throw new UsageError('rm needs a deployment id')
        await client.remove(target)
        print({ removed: target }, () => io.out(`✔ removed ${target}`))
        return 0
      }
      case 'gc': {
        const result = await client.gc(values['dry-run'])
        print(result, () => {
          for (const decision of result.decisions) {
            io.out(`${decision.keep ? 'keep  ' : result.dryRun ? 'would delete' : 'delete'}  ${decision.id}  (${decision.reason}${decision.activeSessions ? `, ${decision.activeSessions} live tabs` : ''})`)
          }
          if (!result.dryRun) io.out(`✔ freed ${formatBytes(result.freedBytes)} across ${result.removedBlobs} blob(s)`)
        })
        return 0
      }
      default:
        throw new UsageError(`unknown command "${command}"`)
    }
  } catch (error) {
    io.err(`✖ ${(error as Error).message}`)
    return error instanceof UsageError ? 2 : 1
  }
}

class UsageError extends Error {}
