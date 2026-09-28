import { useLayoutEffect, useRef, useState } from 'react'
import type { Overview } from '../lib/api'
import { compact } from '../lib/format'

type Point = Overview['telemetry']['timeline'][number]

const HEIGHT = 160
const TOP = 10
const AXIS = 32
const GAP = 2

/** Renders in real pixels so labels keep their size and the plot keeps its height at any width. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry!.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function niceMax(value: number): number {
  if (value <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate * 4 >= value)!
  return step * 4
}

const clock = (minute: number) => new Date(minute).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * Requests per minute over the last hour, stacked: served normally (series 1) under
 * rescued from an older deployment (series 2). Rescued requests are the ones a plain static
 * server would have answered with a 404.
 */
export function TrafficChart({ timeline }: { timeline: Point[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [container, WIDTH] = useWidth<HTMLDivElement>(720)
  const max = niceMax(Math.max(...timeline.map((point) => point.requests)))
  const plotWidth = WIDTH - AXIS
  const slot = plotWidth / timeline.length
  const barWidth = Math.max(2, slot - GAP)
  const y = (value: number) => TOP + HEIGHT - (value / max) * HEIGHT
  const ticks = [0, max / 2, max]
  const active = hover === null ? null : timeline[hover]

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--series-1)]" /> Served normally
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--series-2)]" /> Rescued from an older deployment
        </span>
      </div>
      <div className="relative" ref={container}>
        <svg width={WIDTH} height={TOP + HEIGHT + 20} viewBox={`0 0 ${WIDTH} ${TOP + HEIGHT + 20}`} className="block" role="img" aria-label="Requests per minute over the last hour" onMouseLeave={() => setHover(null)}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={AXIS} x2={WIDTH} y1={y(tick)} y2={y(tick)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
              <text x={AXIS - 6} y={y(tick) + 3} textAnchor="end" className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
                {compact(tick)}
              </text>
            </g>
          ))}
          {timeline.map((point, index) => {
            const x = AXIS + index * slot + GAP / 2
            const normal = point.requests - point.rescued
            const normalTop = y(normal)
            const rescuedTop = y(point.requests)
            return (
              <g key={point.minute}>
                {normal > 0 && <rect x={x} y={normalTop} width={barWidth} height={TOP + HEIGHT - normalTop} rx={point.rescued > 0 ? 0 : 1.5} fill="var(--series-1)" opacity={hover === null || hover === index ? 1 : 0.45} />}
                {point.rescued > 0 && (
                  <rect x={x} y={rescuedTop} width={barWidth} height={Math.max(1, normalTop - rescuedTop - (normal > 0 ? GAP : 0))} rx={1.5} fill="var(--series-2)" opacity={hover === null || hover === index ? 1 : 0.45} />
                )}
                {/* Hit target: the full column, wider than the mark. */}
                <rect x={AXIS + index * slot} y={0} width={slot} height={TOP + HEIGHT} fill="transparent" onMouseEnter={() => setHover(index)} />
              </g>
            )
          })}
          <text x={AXIS} y={TOP + HEIGHT + 14} className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
            {timeline[0] ? clock(timeline[0].minute) : ''}
          </text>
          <text x={WIDTH} y={TOP + HEIGHT + 14} textAnchor="end" className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
            now
          </text>
        </svg>
        {active && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-44 rounded-md border border-zinc-200 bg-white p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
            style={{ left: `clamp(0px, calc(${((AXIS + hover * slot) / WIDTH) * 100}% - 88px), calc(100% - 176px))` }}
          >
            <p className="mb-1 font-medium">{clock(active.minute)}</p>
            <p className="flex justify-between"><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[var(--series-1)]" />Served</span><span className="tabular-nums">{active.requests - active.rescued}</span></p>
            <p className="flex justify-between"><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[var(--series-2)]" />Rescued</span><span className="tabular-nums">{active.rescued}</span></p>
            <p className="flex justify-between text-zinc-500 dark:text-zinc-400"><span>Lost (404)</span><span className="tabular-nums">{active.misses}</span></p>
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr><th className="font-medium">Minute</th><th className="font-medium">Served</th><th className="font-medium">Rescued</th><th className="font-medium">Lost</th></tr>
          </thead>
          <tbody>
            {timeline.filter((point) => point.requests || point.misses).map((point) => (
              <tr key={point.minute}><td>{clock(point.minute)}</td><td>{point.requests - point.rescued}</td><td>{point.rescued}</td><td>{point.misses}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
