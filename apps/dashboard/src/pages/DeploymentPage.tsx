import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StatusBadges } from '../components/DeploymentsTable'
import { Card, Mono } from '../components/ui'
import { formatBytes, timeAgo } from '../lib/format'
import { useDeployment, useOverview } from '../lib/queries'

export function DeploymentPage() {
  const { id = '' } = useParams()
  const { data: deployment, error } = useDeployment(id)
  const { data: overview } = useOverview()
  const [filter, setFilter] = useState('')
  const files = useMemo(
    () => Object.entries(deployment?.files ?? {}).filter(([path]) => path.toLowerCase().includes(filter.toLowerCase())),
    [deployment, filter],
  )

  if (error) return <p className="text-sm text-red-700 dark:text-red-400">{error.message}</p>
  if (!deployment) return <p className="text-sm text-zinc-500">Loading…</p>

  const previewHref = deployment.previewUrl ? (deployment.previewUrl.startsWith('http') ? deployment.previewUrl : `${overview?.publicUrl ?? ''}${deployment.previewUrl}`) : null

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-forge-600">
        <ArrowLeft className="size-3.5" /> All deployments
      </Link>
      <div>
        <h1 className="flex flex-wrap items-center gap-2 font-mono text-xl font-semibold">
          {deployment.id} <StatusBadges deployment={{ ...deployment, current: deployment.current }} />
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          created {timeAgo(deployment.createdAt)} · {deployment.fileCount} files · {formatBytes(deployment.totalBytes)} (+{formatBytes(deployment.newBytes)} new)
          {deployment.meta.commit && <> · commit <Mono>{deployment.meta.commit.slice(0, 10)}</Mono></>}
          {deployment.meta.branch && <> on <Mono>{deployment.meta.branch}</Mono></>}
          {deployment.meta.author && <> by {deployment.meta.author}</>}
        </p>
      </div>

      {previewHref && !deployment.current && (
        <Card title="Preview">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This link sets a signed cookie in your browser so every page and asset comes from <Mono>{deployment.id}</Mono>, even before it is promoted.
          </p>
          <a href={previewHref} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-forge-600 hover:underline">
            Open preview <ExternalLink className="size-3.5" />
          </a>
          {!overview?.publicUrl && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Set PUBLIC_URL on the gateway so this link points at the edge listener.</p>}
        </Card>
      )}

      <Card
        title={`Files (${files.length})`}
        action={
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter paths"
            aria-label="Filter paths"
            className="w-48 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
          />
        }
      >
        <div className="-mx-5 max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-5 py-1.5 font-medium">Path</th>
                <th className="py-1.5 font-medium">Size</th>
                <th className="py-1.5 font-medium">Caching</th>
                <th className="px-5 py-1.5 font-medium">Blob</th>
              </tr>
            </thead>
            <tbody>
              {files.map(([path, file]) => (
                <tr key={path} className="border-t border-zinc-100 dark:border-zinc-800/60">
                  <td className="px-5 py-1.5"><Mono>/{path}</Mono>{path === deployment.entry && <span className="ml-2 text-forge-600">entry</span>}</td>
                  <td className="py-1.5 tabular-nums">{formatBytes(file.size)}</td>
                  <td className="py-1.5">{file.immutable ? 'immutable' : 'revalidate'}</td>
                  <td className="px-5 py-1.5 text-zinc-500 dark:text-zinc-400"><Mono>{file.hash.slice(0, 12)}</Mono></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
