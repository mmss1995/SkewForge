import { inject, onScopeDispose, readonly, shallowRef, type App, type InjectionKey, type Ref } from 'vue'
import { SkewClient, type SkewClientOptions, type SkewState } from '@skewforge/client'

export const SKEW_CLIENT: InjectionKey<SkewClient> = Symbol('skewforge')

/**
 * Vue plugin: `app.use(createSkewForge({ ... }))`. The client starts when installed (in the
 * browser) and is destroyed when the app unmounts.
 */
export function createSkewForge(options: SkewClientOptions | SkewClient = {}) {
  const client = options instanceof SkewClient ? options : new SkewClient(options)
  return {
    client,
    install(app: App) {
      app.provide(SKEW_CLIENT, client)
      if (typeof window !== 'undefined') client.start()
      app.onUnmount?.(() => client.destroy())
    },
  }
}

export function useSkewClient(): SkewClient {
  const client = inject(SKEW_CLIENT, null)
  if (!client) throw new Error('useSkew() needs app.use(createSkewForge())')
  return client
}

/** Reactive, read-only SkewForge state plus a `reload()` helper. */
export function useSkew(): { state: Readonly<Ref<SkewState>>; reload: () => void } {
  const client = useSkewClient()
  const state = shallowRef(client.getSnapshot())
  const unsubscribe = client.subscribe((next) => {
    state.value = next
  })
  onScopeDispose(unsubscribe)
  return { state: readonly(state) as Readonly<Ref<SkewState>>, reload: () => client.reload() }
}

/** The subset of Vue Router this guard needs, so vue-router stays an optional peer. */
interface RouterLike {
  beforeEach(guard: (to: { fullPath: string }, from: { fullPath: string }) => boolean | void): () => void
  resolve(to: string): { href: string }
}

/**
 * Programmatic `router.push()` calls do not go through a link click, so the client cannot
 * intercept them. This guard does: when an update is waiting, the navigation becomes a full
 * page load of the target URL on the new deployment.
 */
export function installSkewRouterGuard(router: RouterLike, client: SkewClient): () => void {
  return router.beforeEach((to, from) => {
    if (to.fullPath === from.fullPath) return
    if (client.hardNavigateIfUpdated(router.resolve(to.fullPath).href)) return false
  })
}

export { SkewClient, createSkewClient, isChunkLoadError, type SkewClientOptions, type SkewState } from '@skewforge/client'
