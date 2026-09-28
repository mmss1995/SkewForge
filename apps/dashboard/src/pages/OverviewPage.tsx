import { HardDrive, LifeBuoy, MonitorSmartphone, Radio, ShieldAlert, Undo2 } from 'lucide-react'
import { Activity } from '../components/Activity'
import { DeploymentsTable } from '../components/DeploymentsTable'
import { GcPanel } from '../components/GcPanel'
import { TrafficChart } from '../components/TrafficChart'
import { Button, Card, Mono, StatTile } from '../components/ui'
import { compact, dedupeRatio, formatBytes, timeAgo } from '../lib/format'
import { useAction, useOverview } from '../lib/queries'
import { useApi } from '../lib/session'

export function OverviewPage() {
  const api = useApi()
  const { data: overview, error, isPending } = useOverview()
  const rollback = useAction(() => api.rollback())

  if (isPending) return <p className="text-sm text-zinc-500">Loading…</p>
  if (!overview) return <p className="text-sm text-red-700 dark:text-red-400">Could not reach the gateway: {error?.message}</p>

  const live = overview.deployments.find((deployment) => deployment.current)
  const tabs = overview.deployments.reduce((sum, deployment) => sum + deployment.activeSessions, 0)
  const staleTabs = tabs - (live?.activeSessions ?? 0)
  const logical = overview.deployments.reduce((sum, deployment) => sum + deployment.totalBytes, 0)
  const { totals } = overview.telemetry

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Live deployment</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Radio className="size-5 text-emerald-600" />
            <span className="font-mono">{overview.current ?? 'none'}</span>
          </h1>
          {live && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              promoted {live.promotedAt ? timeAgo(live.promotedAt) : '—'}
              {live.meta.message && <> · {live.meta.message}</>}
            </p>
          )}
        </div>
        <Button
          variant="danger"
          disabled={!overview.current || rollback.isPending}
          onClick={() => {
            if (confirm('Roll back to the previous deployment? Tabs on the current one will be told to reload.')) rollback.mutate(undefined)
          }}
        >
          <Undo2 className="size-3.5" /> Roll back
        </Button>
      </div>
      {rollback.error && <p className="text-xs text-red-700 dark:text-red-400">{rollback.error.message}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<LifeBuoy className="size-3.5" />} label="Requests rescued" value={compact(totals.rescued)} hint={`would have been 404s · since ${timeAgo(overview.telemetry.since)}`} />
        <StatTile icon={<MonitorSmartphone className="size-3.5" />} label="Live tabs" value={compact(tabs)} hint={staleTabs > 0 ? `${staleTabs} still on an older deployment` : `${overview.liveStreams} listening for updates`} />
        <StatTile
          icon={<ShieldAlert className="size-3.5" />}
          label="Lost requests"
          value={compact(totals.misses)}
          tone={totals.misses > 0 ? 'critical' : undefined}
          hint={totals.misses > 0 ? 'files no retained deployment has' : 'nothing lost'}
        />
        <StatTile
          icon={<HardDrive className="size-3.5" />}
          label="Stored"
          value={formatBytes(overview.storage.bytes)}
          hint={`${overview.deployments.length} deployments · ${dedupeRatio(logical, overview.storage.bytes).toFixed(1)}× dedupe`}
        />
      </div>

      <Card title="Traffic, last 60 minutes">
        <TrafficChart timeline={overview.telemetry.timeline} />
      </Card>

      <Card title="Deployments">
        <DeploymentsTable overview={overview} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <GcPanel overview={overview} />
        <Activity overview={overview} />
      </div>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
        Promotions are logged: {overview.promotions.slice(0, 5).map((promotion) => (
          <span key={`${promotion.id}-${promotion.at}`} className="mx-1">
            <Mono>{promotion.id}</Mono> ({promotion.reason}, {timeAgo(promotion.at)})
          </span>
        ))}
      </p>
    </div>
  )
}
