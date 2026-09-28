import { Recycle } from 'lucide-react'
import type { GcResult, Overview } from '../lib/api'
import { duration, formatBytes } from '../lib/format'
import { useAction } from '../lib/queries'
import { useApi } from '../lib/session'
import { Button, Card } from './ui'

export function GcPanel({ overview }: { overview: Overview }) {
  const api = useApi()
  const run = useAction(() => api.gc(false))
  const doomed = overview.gcPlan.filter((decision) => !decision.keep)
  const { retention } = overview
  const result: GcResult | undefined = run.data

  return (
    <Card
      title="Retention"
      action={
        <Button disabled={run.isPending || doomed.length === 0} onClick={() => run.mutate(undefined)}>
          <Recycle className="size-3.5" /> Run GC now
        </Button>
      }
    >
      <p className="text-xs text-zinc-600 dark:text-zinc-300">
        Keeps the newest <strong>{retention.keepLast}</strong>, anything retired less than <strong>{duration(retention.minAgeMs)}</strong> ago
        {retention.protectActiveSessions && <>, and anything with live tabs</>}.
      </p>
      <p className="mt-3 text-sm">
        {doomed.length === 0 ? (
          'Nothing to collect.'
        ) : (
          <>
            Next run deletes <strong>{doomed.map((decision) => decision.id).join(', ')}</strong>.
          </>
        )}
      </p>
      {result && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Last run removed {result.removedDeployments.length} deployment(s) and {result.removedBlobs} blob(s), freeing {formatBytes(result.freedBytes)}.
        </p>
      )}
      {run.error && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{run.error.message}</p>}
    </Card>
  )
}
