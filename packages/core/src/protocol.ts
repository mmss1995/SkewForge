// Wire names shared by the gateway, the browser client and the build plugins. This module has no
// dependencies so browser code can import `@skewforge/core/protocol` without pulling in Zod.

/** Query parameter that pins a request to a deployment, as Vercel's `?dpl=`. */
export const DEPLOYMENT_QUERY = 'dpl'
/** Request header with the same meaning, for fetches the client makes. */
export const DEPLOYMENT_HEADER = 'x-skewforge-deployment'
/** Response header naming the deployment that answered. */
export const SERVED_BY_HEADER = 'x-skewforge-served-by'
/** Response header describing how the deployment was chosen (`current`, `referer`, `fallback`...). */
export const RESOLUTION_HEADER = 'x-skewforge-resolution'
/** Cookie set by `/__skewforge/preview/:id` so every request of that browser sees a staged build. */
export const PREVIEW_COOKIE = 'skewforge_preview'
/** `<meta name=...>` the gateway injects into every HTML document it serves. */
export const DEPLOYMENT_META = 'skewforge-deployment'
/** Public runtime endpoints: version, stream, beacon, preview. */
export const RUNTIME_PREFIX = '/__skewforge'
