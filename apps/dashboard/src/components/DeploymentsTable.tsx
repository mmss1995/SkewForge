import { AlertTriangle, ArrowUpCircle, Ban, Eye, Radio, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Overview } from '../lib/api'
import { compact, formatBytes, timeAgo } from '../lib/format'
import { useAction } from '../lib/queries'
import { useApi } from '../lib/session'
import { Badge, Button, Mono } from './ui'

type Row = Overview['deployments'][number]

export function StatusBadges({ deployment }: { deployment: Row | (Omit<Row, 'activeSessions'> & { activeSessions?: number }) }) {
  return (
    <span className="flex flex-wrap gap-1">
      {deployment.current && <Badge tone="live" icon={<Radio className="size-3" />}>live</Badge>}
      {!deployment.promotedAt && <Badge tone="info">staged</Badge>}
      {deployment.mandatory && <Badge tone="warning" icon={<AlertTriangle className="size-3" />}>mandatory</Badge>}
      {deployment.revoked && <Badge tone="critical" icon={<Ban className="size-3" />}>revoked</Badge>}
      {!deployment.entry && <Badge>assets only</Badge>}
    </span>
  )
}

export function DeploymentsTable({ overview }: { overview: Overview }) {
  const api = useApi()
  const promote = useAction((id: string) => api.promote(id))
  const toggleMandatory = useAction((row: Row) => api.update(row.id, { mandatory: !row.mandatory }))
  const remove = useAction((id: string) => api.remove(id))
  const maxSessions = Math.max(1, ...overview.deployments.map((row) => row.activeSessions))
  const keepReason = new Map(overview.gcPlan.map((decision) => [decision.id, decision]))
  const error = promote.error ?? toggleMandatory.error ?? remove.error

  if (overview.deployments.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No deployments yet. Ship one with <Mono>skewforge deploy dist --promote</Mono>.
      </p>
    )
  }

  return (
    <div className="-mx-5 overflow-x-auto">
      {error && <p className="mx-5 mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error.message}</p>}
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-xs text-zinc-500 dark:text-zinc-400">
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className="px-5 pb-2 font-medium">Deployment</th>
            <th className="pb-2 font-medium">Live tabs</th>
            <th className="pb-2 font-medium">Requests</th>
            <th className="pb-2 font-medium">Size</th>
            <th className="pb-2 font-medium">Retention</th>
            <th className="px-5 pb-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {overview.deployments.map((row) => {
            const traffic = overview.telemetry.byDeployment[row.id]
            const decision = keepReason.get(row.id)
            return (
              <tr key={row.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800/60">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Link to={`/deployments/${encodeURIComponent(row.id)}`} className="font-mono text-[13px] font-medium hover:text-forge-600">
                      {row.id}
                    </Link>
                    <StatusBadges deployment={row} />
                  </div>
                  <p className="mt-0.5 max-w-sm truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {row.meta.message ?? 'no commit message'}
                    {row.meta.commit && <> · <Mono>{row.meta.commit.slice(0, 7)}</Mono></>} · {timeAgo(row.createdAt)}
                  </p>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 tabular-nums">{row.activeSessions}</span>
                    <span className="h-1.5 w-20 rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <span className="block h-1.5 rounded-full bg-[var(--series-1)]" style={{ width: `${(row.activeSessions / maxSessions) * 100}%` }} />
                    </span>
                  </div>
                </td>
                <td className="py-3 tabular-nums">
                  {compact(traffic?.requests ?? 0)}
                  {traffic?.rescued ? <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">({compact(traffic.rescued)} rescued)</span> : null}
                </td>
                <td className="py-3 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                  {formatBytes(row.totalBytes)}
                  <span className="block text-zinc-500 dark:text-zinc-400">+{formatBytes(row.newBytes)} new · {row.fileCount} files</span>
                </td>
                <td className="py-3 text-xs">
                  {decision && (decision.keep ? <span className="text-zinc-600 dark:text-zinc-300">kept: {decision.reason}</span> : <Badge tone="warning">next GC deletes</Badge>)}
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1.5">
                    {!row.current && (
                      <Button variant="primary" disabled={promote.isPending} onClick={() => promote.mutate(row.id)} title="Make this the live deployment">
                        <ArrowUpCircle className="size-3.5" /> Promote
                      </Button>
                    )}
                    {row.entry && !row.promotedAt && (
                      <Link to={`/deployments/${encodeURIComponent(row.id)}`}>
                        <Button><Eye className="size-3.5" /> Preview</Button>
                      </Link>
                    )}
                    <Button onClick={() => toggleMandatory.mutate(row)} title="Mandatory releases make older tabs reload immediately">
                      {row.mandatory ? 'Unmark' : 'Mandatory'}
                    </Button>
                    {!row.current && (
                      <Button
                        variant="danger"
                        aria-label={`Delete ${row.id}`}
                        onClick={() => {
                          if (confirm(`Delete ${row.id}? Tabs still running it will lose their chunks.`)) remove.mutate(row.id)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
