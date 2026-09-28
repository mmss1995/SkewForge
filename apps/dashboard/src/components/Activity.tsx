import type { Overview } from '../lib/api'
import { timeAgo } from '../lib/format'
import { Card, Mono } from './ui'

export function Activity({ overview }: { overview: Overview }) {
  const { recentRescues, recentMisses } = overview.telemetry
  return (
    <Card title="Recent rescues">
      {recentRescues.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">None yet. They appear when a tab opened before a deploy asks for a file the live deployment no longer has.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {recentRescues.slice(0, 8).map((event) => (
            <li key={`${event.at}-${event.path}`} className="flex justify-between gap-3">
              <span className="truncate"><Mono>/{event.path}</Mono></span>
              <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                from <Mono>{event.deployment}</Mono> · {timeAgo(event.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recentMisses.length > 0 && (
        <>
          <h3 className="mt-4 mb-1.5 text-xs font-semibold text-red-700 dark:text-red-400">Lost — no retained deployment had these</h3>
          <ul className="space-y-1 text-xs">
            {recentMisses.slice(0, 5).map((event) => (
              <li key={`${event.at}-${event.path}`} className="flex justify-between gap-3">
                <span className="truncate"><Mono>/{event.path}</Mono></span>
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{timeAgo(event.at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
