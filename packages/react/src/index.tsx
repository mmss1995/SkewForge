import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { SkewClient, type SkewClientOptions, type SkewState } from '@skewforge/client'

const SkewContext = createContext<SkewClient | null>(null)

export interface SkewProviderProps {
  /** A client you created yourself; otherwise one is created from `options` and started on mount. */
  client?: SkewClient
  options?: SkewClientOptions
  children: ReactNode
}

/**
 * Makes a SkewForge client available to `useSkew()`. Starting happens in an effect, so the
 * provider is safe to render on the server.
 */
export function SkewProvider({ client: given, options, children }: SkewProviderProps) {
  const [client] = useState(() => given ?? new SkewClient(options))
  useEffect(() => {
    if (given) return
    client.start()
    return () => client.destroy()
  }, [client, given])
  return <SkewContext.Provider value={client}>{children}</SkewContext.Provider>
}

export function useSkewClient(): SkewClient {
  const client = useContext(SkewContext)
  if (!client) throw new Error('useSkew() must be used inside <SkewProvider>')
  return client
}

/** The live state: `updateAvailable`, `mandatory`, `current`, `running`, `connection`... */
export function useSkew(): SkewState & { reload: () => void } {
  const client = useSkewClient()
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
  return { ...state, reload: () => client.reload() }
}

export interface UpdateBannerProps {
  /** Rendered instead of the default markup; receives the state and a reload callback. */
  children?: (skew: ReturnType<typeof useSkew>) => ReactNode
  className?: string
  message?: ReactNode
  actionLabel?: ReactNode
}

/**
 * Shows only while a newer deployment is live. Unstyled by default: pass `className`, or a
 * render function as children for full control.
 */
export function UpdateBanner({ children, className, message = 'A new version is available.', actionLabel = 'Reload' }: UpdateBannerProps) {
  const skew = useSkew()
  if (!skew.updateAvailable) return null
  if (children) return <>{children(skew)}</>
  return (
    <div role="status" aria-live="polite" className={className} data-skewforge-banner="">
      <span>{message}</span>{' '}
      <button type="button" onClick={skew.reload}>
        {actionLabel}
      </button>
    </div>
  )
}

export { SkewClient, createSkewClient, isChunkLoadError, type SkewClientOptions, type SkewState } from '@skewforge/client'
